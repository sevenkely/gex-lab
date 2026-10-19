import type { NextRequest } from "next/server";
import { getAsset } from "@/config/assets";
import { parseInterval } from "@/lib/params";
import { cachedJson, failure } from "@/server/api";
import { ProviderError, type CandleInterval } from "@/server/providers/types";
import { getCandleSeries } from "@/server/registry";

export const dynamic = "force-dynamic";

// Les chaînes CBOE (jusqu’à 13 Mo) peuvent être lentes à froid : on laisse
// de la marge au rendu serveur plutôt que de couper la requête.
export const maxDuration = 60;

/** Fenêtre par défaut selon l'intervalle (ms). */
const DEFAULT_HOURS: Record<CandleInterval, number> = {
  "1m": 6,
  "5m": 24,
  "15m": 72,
  "1H": 240,
  "1D": 8760,
};

/** GET /api/candles/BTC?interval=5m&hours=24 (ou &from=&to= en ms). */
export async function GET(
  request: NextRequest,
  context: { params: Promise<{ symbol: string }> },
) {
  const { symbol } = await context.params;
  const asset = getAsset(symbol);
  if (!asset) return failure(new ProviderError(`Actif inconnu : ${symbol}`, "not_found"));

  const search = request.nextUrl.searchParams;
  const interval = parseInterval(search.get("interval") ?? undefined);
  const now = Date.now();
  const to = Number(search.get("to")) || now;
  const from =
    Number(search.get("from")) || to - (Number(search.get("hours")) || DEFAULT_HOURS[interval]) * 3_600_000;

  try {
    const result = await getCandleSeries(asset, interval, { from, to });
    return cachedJson(
      {
        assetId: asset.id,
        interval: result.data.interval,
        candles: result.data.candles,
      },
      result.provenance,
      30,
    );
  } catch (error) {
    return failure(error);
  }
}
