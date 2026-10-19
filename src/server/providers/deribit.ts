/**
 * Provider Deribit — chaîne d'options BTC/ETH, prix et bougies.
 *
 * Endpoints vérifiés le 2026-10-19 (voir docs/DATA-SOURCES.md) :
 *  - GET /public/get_book_summary_by_currency?currency=BTC&kind=option
 *      → 928 instruments, `open_interest` en contrats (1 contrat = 1 BTC/ETH),
 *        `mark_iv` en POURCENT (84.6 = 84,6 %), `underlying_price` fourni.
 *        Pas de gamma : il est recalculé en Black-Scholes dans le calcul GEX.
 *  - GET /public/ticker?instrument_name=BTC-PERPETUAL
 *      → `index_price`, `last_price`, `stats.price_change` (variation 24 h en %).
 *  - GET /public/get_tradingview_chart_data
 *      → tableaux parallèles ticks/open/high/low/close/volume (ticks en ms).
 *  - GET /public/get_last_trades_by_currency?currency=BTC&kind=option&count=100
 *      → trades avec `block_trade_id` (4/100 dans l'échantillon), `direction`.
 *
 * Ces appels partent du serveur : aucun CORS à gérer. Le navigateur utilise le
 * WebSocket pour le temps réel (/api/gex reste le calcul serveur).
 */

import { z } from "zod";
import type { AssetConfig } from "@/config/assets";
import { parseExpiryCode } from "@/lib/time";
import { requestJson, validate } from "../http";
import type {
  Candle,
  CandleInterval,
  CandleSeries,
  ChainProvider,
  ChainSnapshot,
  FlowTrade,
  OptionContract,
  PriceProvider,
  PriceQuote,
  ProviderResult,
} from "./types";

const BASE = "https://www.deribit.com/api/v2";

/* ------------------------------------------------------------------ schémas */

const bookSummarySchema = z.object({
  result: z.array(
    z.object({
      instrument_name: z.string(),
      open_interest: z.number().nullish(),
      mark_iv: z.number().nullish(),
      underlying_price: z.number().nullish(),
      volume: z.number().nullish(),
      bid_price: z.number().nullish(),
      ask_price: z.number().nullish(),
      mark_price: z.number().nullish(),
      last: z.number().nullish(),
    }),
  ),
});

const tickerSchema = z.object({
  result: z.object({
    index_price: z.number(),
    last_price: z.number().nullish(),
    timestamp: z.number(),
    stats: z
      .object({
        price_change: z.number().nullish(),
        volume: z.number().nullish(),
      })
      .nullish(),
  }),
});

const chartSchema = z.object({
  result: z.object({
    status: z.string(),
    ticks: z.array(z.number()).nullish(),
    open: z.array(z.number().nullish()).nullish(),
    high: z.array(z.number().nullish()).nullish(),
    low: z.array(z.number().nullish()).nullish(),
    close: z.array(z.number().nullish()).nullish(),
    volume: z.array(z.number().nullish()).nullish(),
  }),
});

const tradesSchema = z.object({
  result: z.object({
    trades: z.array(
      z.object({
        timestamp: z.number(),
        price: z.number(),
        amount: z.number(),
        direction: z.enum(["buy", "sell"]),
        index_price: z.number(),
        instrument_name: z.string(),
        trade_id: z.string(),
        block_trade_id: z.string().nullish(),
      }),
    ),
  }),
});

/* --------------------------------------------------------------- utilitaires */

/** "BTC-19OCT26-71000-C" → { code, strike, type }. */
const INSTRUMENT_RE = /^(BTC|ETH)-(\d{2}[A-Z]{3}\d{2})-([\d.]+)-([CP])$/;

export interface ParsedInstrument {
  expiry: number;
  strike: number;
  type: "call" | "put";
}

export function parseInstrument(name: string): ParsedInstrument | null {
  const match = INSTRUMENT_RE.exec(name);
  if (!match) return null;
  const expiry = parseExpiryCode(match[2]);
  const strike = Number(match[3]);
  if (expiry === null || !(strike > 0)) return null;
  return { expiry, strike, type: match[4] === "C" ? "call" : "put" };
}

function median(values: number[]): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.floor(sorted.length / 2)];
}

/* -------------------------------------------------------------------- chaîne */

export async function fetchDeribitChain(
  asset: AssetConfig,
): Promise<ProviderResult<ChainSnapshot>> {
  const started = Date.now();
  const url = `${BASE}/public/get_book_summary_by_currency?currency=${encodeURIComponent(
    asset.chainSymbol,
  )}&kind=option`;
  const { json } = await requestJson(url, { label: "Deribit" });
  const parsed = validate(bookSummarySchema, json, "Deribit book summary");

  const contracts: OptionContract[] = [];
  const underlying: number[] = [];
  const now = Date.now();

  for (const row of parsed.result) {
    const instrument = parseInstrument(row.instrument_name);
    if (!instrument) continue;
    if (row.underlying_price && row.underlying_price > 0) {
      underlying.push(row.underlying_price);
    }
    // Échéance passée : la source garde l'instrument quelques heures.
    if (instrument.expiry < now - 3_600_000) continue;
    const oi = row.open_interest ?? 0;
    if (!(oi > 0)) continue;

    const iv = row.mark_iv !== null && row.mark_iv !== undefined ? row.mark_iv / 100 : undefined;
    contracts.push({
      symbol: row.instrument_name,
      type: instrument.type,
      strike: instrument.strike,
      expiry: instrument.expiry,
      iv: iv && iv > 0 && iv < 5 ? iv : undefined,
      oi,
      volume: row.volume ?? 0,
      bid: row.bid_price ?? undefined,
      ask: row.ask_price ?? undefined,
      last: row.last ?? row.mark_price ?? undefined,
    });
  }

  if (contracts.length === 0) {
    throw new Error("Deribit — aucune option ouverte retournée");
  }

  return {
    data: {
      assetId: asset.id,
      spot: median(underlying),
      contracts,
      nativeSymbol: asset.chainSymbol,
    },
    provenance: {
      source: "Deribit (public REST)",
      provider: "deribit",
      asOf: started,
      fetchedAt: Date.now(),
      delayMs: 0,
      derived: false,
      stale: false,
      demo: false,
    },
  };
}

/* ---------------------------------------------------------------------- prix */

export async function fetchDeribitQuote(asset: AssetConfig): Promise<ProviderResult<PriceQuote>> {
  const instrument = `${asset.chainSymbol}-PERPETUAL`;
  const url = `${BASE}/public/ticker?instrument_name=${encodeURIComponent(instrument)}`;
  const { json } = await requestJson(url, { label: "Deribit ticker" });
  const parsed = validate(tickerSchema, json, "Deribit ticker");
  const { index_price: index, last_price: last, timestamp, stats } = parsed.result;

  const price = last && last > 0 ? last : index;
  const changePct = stats?.price_change ?? undefined;
  const prevClose =
    changePct !== undefined && changePct !== null
      ? price / (1 + changePct / 100)
      : undefined;

  return {
    data: {
      symbol: `${asset.chainSymbol}/USD`,
      price,
      prevClose,
      changePct,
      asOf: timestamp,
    },
    provenance: {
      source: "Deribit (index + perpétuel)",
      provider: "deribit",
      asOf: timestamp,
      fetchedAt: Date.now(),
      delayMs: 0,
      derived: false,
      stale: false,
      demo: false,
    },
  };
}

const RESOLUTION: Record<CandleInterval, string> = {
  "1m": "1",
  "5m": "5",
  "15m": "15",
  "1H": "60",
  "1D": "1D",
};

export async function fetchDeribitCandles(
  asset: AssetConfig,
  interval: CandleInterval,
  range: { from: number; to: number },
): Promise<ProviderResult<CandleSeries>> {
  const instrument = `${asset.chainSymbol}-PERPETUAL`;
  const url =
    `${BASE}/public/get_tradingview_chart_data?instrument_name=${encodeURIComponent(instrument)}` +
    `&start_timestamp=${Math.floor(range.from)}&end_timestamp=${Math.floor(range.to)}` +
    `&resolution=${RESOLUTION[interval]}`;
  const { json } = await requestJson(url, { label: "Deribit chart" });
  const parsed = validate(chartSchema, json, "Deribit chart data");
  const ticks = parsed.result.ticks ?? [];

  const candles: Candle[] = [];
  for (let i = 0; i < ticks.length; i++) {
    const open = parsed.result.open?.[i];
    const high = parsed.result.high?.[i];
    const low = parsed.result.low?.[i];
    const close = parsed.result.close?.[i];
    if (open == null || high == null || low == null || close == null) continue;
    candles.push({
      time: Math.floor(ticks[i] / 1000),
      open,
      high,
      low,
      close,
      volume: parsed.result.volume?.[i] ?? 0,
    });
  }

  return {
    data: { assetId: asset.id, interval, candles },
    provenance: {
      source: "Deribit (bougies)",
      provider: "deribit",
      asOf: Date.now(),
      fetchedAt: Date.now(),
      delayMs: 0,
      derived: false,
      stale: false,
      demo: false,
    },
  };
}

/* ---------------------------------------------------------------------- flux */

/** Trades d'options les plus récents (REST : utilisé pour le flux côté serveur). */
export async function fetchDeribitFlow(
  asset: AssetConfig,
  count = 100,
): Promise<ProviderResult<FlowTrade[]>> {
  const url =
    `${BASE}/public/get_last_trades_by_currency?currency=${encodeURIComponent(asset.chainSymbol)}` +
    `&kind=option&count=${count}`;
  const { json } = await requestJson(url, { label: "Deribit trades" });
  const parsed = validate(tradesSchema, json, "Deribit trades");

  const trades: FlowTrade[] = [];
  for (const trade of parsed.result.trades) {
    const instrument = parseInstrument(trade.instrument_name);
    if (!instrument) continue;
    trades.push({
      id: trade.trade_id,
      ts: trade.timestamp,
      assetId: asset.id,
      instrument: trade.instrument_name,
      type: instrument.type,
      strike: instrument.strike,
      expiry: instrument.expiry,
      amount: trade.amount,
      price: trade.price,
      indexPrice: trade.index_price,
      // 1 contrat = 1 BTC (ou ETH) : prime USD = prix en coin × index × taille.
      premiumUsd: trade.price * trade.index_price * trade.amount,
      side: trade.direction === "buy" ? "buy" : "sell",
      block: Boolean(trade.block_trade_id),
    });
  }

  return {
    data: trades,
    provenance: {
      source: "Deribit (trades REST)",
      provider: "deribit",
      asOf: trades[0]?.ts ?? Date.now(),
      fetchedAt: Date.now(),
      delayMs: 0,
      derived: false,
      stale: false,
      demo: false,
    },
  };
}

/* ------------------------------------------------------------------ providers */

export const deribitChainProvider: ChainProvider = {
  id: "deribit",
  name: "Deribit",
  delayMs: 0,
  supports: (asset) => asset.chainSource === "deribit",
  getChain: fetchDeribitChain,
};

export const deribitPriceProvider: PriceProvider = {
  id: "deribit",
  name: "Deribit",
  delayMs: 0,
  supports: (asset) => asset.chainSource === "deribit",
  getQuote: fetchDeribitQuote,
  getCandles: fetchDeribitCandles,
};
