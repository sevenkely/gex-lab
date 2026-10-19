/**
 * Provider Yahoo Finance — prix et bougies des indices, ETF et futures.
 *
 * Endpoint non officiel, vérifié le 2026-10-19 :
 *   https://query1.finance.yahoo.com/v8/finance/chart/{symbol}?range=5d&interval=15m
 *
 * Contraintes observées :
 *  - un User-Agent navigateur est requis (sinon 429/403) ;
 *  - les intervalles sont en minuscules (`60m`, `1d`, pas `1H` ni `1D`) ;
 *  - `meta.previousClose` et `meta.regularMarketTime` donnent la variation et
 *    l'horodatage réel, ce qui évite de recalculer depuis les bougies.
 *
 * Risque : endpoint non contractuel (CGU Yahoo, changement de schéma possible).
 * Le registre bascule sur le dernier cache puis sur les fixtures en cas
 * d'échec ; l'interface affiche alors « prix indisponible ». Voir
 * docs/DATA-SOURCES.md pour les alternatives (Twelve Data, Finnhub…).
 */

import { z } from "zod";
import type { AssetConfig } from "@/config/assets";
import { ProviderError } from "./types";
import type {
  Candle,
  CandleInterval,
  CandleSeries,
  PriceProvider,
  PriceQuote,
  ProviderResult,
} from "./types";
import { requestJson, validate } from "../http";

const HOST = "https://query1.finance.yahoo.com/v8/finance/chart";

const chartSchema = z.object({
  chart: z.object({
    result: z
      .array(
        z.object({
          meta: z.object({
            symbol: z.string(),
            currency: z.string().nullish(),
            regularMarketPrice: z.number().nullish(),
            previousClose: z.number().nullish(),
            chartPreviousClose: z.number().nullish(),
            regularMarketTime: z.number().nullish(),
            exchangeTimezoneName: z.string().nullish(),
          }),
          timestamp: z.array(z.number()).nullish(),
          indicators: z.object({
            quote: z.array(
              z.object({
                open: z.array(z.number().nullish()).nullish(),
                high: z.array(z.number().nullish()).nullish(),
                low: z.array(z.number().nullish()).nullish(),
                close: z.array(z.number().nullish()).nullish(),
                volume: z.array(z.number().nullish()).nullish(),
              }),
            ),
          }),
        }),
      )
      .nullish(),
    error: z.unknown().nullish(),
  }),
});

const INTERVAL: Record<CandleInterval, string> = {
  "1m": "1m",
  "5m": "5m",
  "15m": "15m",
  "1H": "60m",
  "1D": "1d",
};

function rangeFor(spanMs: number): string {
  const days = spanMs / 86_400_000;
  if (days <= 1) return "1d";
  if (days <= 5) return "5d";
  if (days <= 30) return "1mo";
  if (days <= 90) return "3mo";
  if (days <= 365) return "1y";
  return "5y";
}

async function fetchChart(
  symbol: string,
  query: string,
): Promise<z.infer<typeof chartSchema>["chart"]["result"]> {
  const url = `${HOST}/${encodeURIComponent(symbol)}?${query}`;
  const { json } = await requestJson(url, { label: "Yahoo Finance" });
  const parsed = validate(chartSchema, json, "Yahoo chart");
  if (parsed.chart.error || !parsed.chart.result?.length) {
    throw new ProviderError(
      `Yahoo Finance — ${symbol} indisponible`,
      parsed.chart.error ? "not_found" : "parse",
    );
  }
  return parsed.chart.result;
}

export async function fetchYahooQuote(asset: AssetConfig): Promise<ProviderResult<PriceQuote>> {
  const result = await fetchChart(asset.priceSymbol, "range=1d&interval=5m");
  const first = result?.[0];
  if (!first) throw new ProviderError("Yahoo Finance — réponse vide", "parse");
  const { meta } = first;
  const price = meta.regularMarketPrice;
  if (price === undefined || price === null || !(price > 0)) {
    throw new ProviderError("Yahoo Finance — prix absent", "parse");
  }
  const prevClose = meta.previousClose ?? meta.chartPreviousClose ?? undefined;
  const asOf = meta.regularMarketTime ? meta.regularMarketTime * 1000 : Date.now();

  return {
    data: {
      symbol: meta.symbol,
      price,
      prevClose,
      changePct: prevClose ? (price / prevClose - 1) * 100 : undefined,
      asOf,
    },
    provenance: {
      source: "Yahoo Finance (non officiel)",
      provider: "yahoo",
      asOf,
      fetchedAt: Date.now(),
      delayMs: asset.delayMs,
      derived: false,
      stale: false,
      demo: false,
    },
  };
}

export async function fetchYahooCandles(
  asset: AssetConfig,
  interval: CandleInterval,
  range: { from: number; to: number },
): Promise<ProviderResult<CandleSeries>> {
  const span = Math.max(60_000, range.to - range.from);
  const result = await fetchChart(
    asset.priceSymbol,
    `range=${rangeFor(span)}&interval=${INTERVAL[interval]}`,
  );
  const first = result?.[0];
  if (!first) throw new ProviderError("Yahoo Finance — réponse vide", "parse");

  const quote = first.indicators.quote[0];
  const ticks = first.timestamp ?? [];
  const fromSec = Math.floor(range.from / 1000);
  const toSec = Math.ceil(range.to / 1000);
  const candles: Candle[] = [];

  for (let i = 0; i < ticks.length; i++) {
    if (ticks[i] < fromSec || ticks[i] > toSec) continue;
    const open = quote?.open?.[i];
    const high = quote?.high?.[i];
    const low = quote?.low?.[i];
    const close = quote?.close?.[i];
    if (open == null || high == null || low == null || close == null) continue;
    candles.push({
      time: ticks[i],
      open,
      high,
      low,
      close,
      volume: quote?.volume?.[i] ?? 0,
    });
  }

  if (candles.length === 0) {
    throw new ProviderError("Yahoo Finance — aucune bougie sur la période", "not_found");
  }

  const asOf = first.meta.regularMarketTime ? first.meta.regularMarketTime * 1000 : Date.now();
  return {
    data: { assetId: asset.id, interval, candles },
    provenance: {
      source: "Yahoo Finance (non officiel)",
      provider: "yahoo",
      asOf,
      fetchedAt: Date.now(),
      delayMs: asset.delayMs,
      derived: false,
      stale: false,
      demo: false,
    },
  };
}

export const yahooPriceProvider: PriceProvider = {
  id: "yahoo",
  name: "Yahoo Finance",
  delayMs: 900_000,
  // Crypto : Deribit est prioritaire (temps réel). Yahoo ne sert que les
  // indices, ETF et futures.
  supports: (asset) => asset.assetClass !== "crypto",
  getQuote: fetchYahooQuote,
  getCandles: fetchYahooCandles,
};
