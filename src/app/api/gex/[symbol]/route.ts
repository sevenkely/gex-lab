import type { NextRequest } from "next/server";
import { parseExpiryFilter } from "@/lib/params";
import { cachedJson, failure } from "@/server/api";
import { getGexSnapshot } from "@/server/registry";

export const dynamic = "force-dynamic";

// Les chaînes CBOE (jusqu’à 13 Mo) peuvent être lentes à froid : on laisse
// de la marge au rendu serveur plutôt que de couper la requête.
export const maxDuration = 60;

/** GET /api/gex/BTC?filter=ALL|0DTE|7D|35D */
export async function GET(
  request: NextRequest,
  context: { params: Promise<{ symbol: string }> },
) {
  const { symbol } = await context.params;
  const filter = parseExpiryFilter(request.nextUrl.searchParams.get("filter") ?? undefined);
  try {
    const snapshot = await getGexSnapshot(symbol, { filter });
    return cachedJson(snapshot, snapshot.provenance, 60);
  } catch (error) {
    return failure(error);
  }
}
