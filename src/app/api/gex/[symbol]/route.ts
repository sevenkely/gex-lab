import type { NextRequest } from "next/server";
import { parseExpiryFilter } from "@/lib/params";
import { cachedJson, failure } from "@/server/api";
import { getGexSnapshot } from "@/server/registry";

export const dynamic = "force-dynamic";

// Les chaînes CBOE (jusqu’à 13 Mo) peuvent être lentes à froid : on laisse
// de la marge au rendu serveur plutôt que de couper la requête.
export const maxDuration = 60;

/**
 * GET /api/gex/BTC?filter=ALL|0DTE|7D|35D[&format=json|csv]
 *
 * `format=csv` exporte le profil par strike (strike, GEX calls / puts / net,
 * OI et volume) — le format attendu par un tableur ou un backtest maison.
 */
export async function GET(
  request: NextRequest,
  context: { params: Promise<{ symbol: string }> },
) {
  const { symbol } = await context.params;
  const search = request.nextUrl.searchParams;
  const filter = parseExpiryFilter(search.get("filter") ?? undefined);
  const format = (search.get("format") ?? "json").toLowerCase();
  try {
    const snapshot = await getGexSnapshot(symbol, { filter });

    if (format === "csv") {
      const header =
        "strike,call_gex,put_gex,net_gex,net_dex,open_interest,call_oi,put_oi,volume";
      const lines = snapshot.byStrike.map((row) =>
        [
          row.strike,
          row.callGex.toFixed(2),
          row.putGex.toFixed(2),
          row.netGex.toFixed(2),
          row.netDex.toFixed(2),
          row.oi,
          row.callOi,
          row.putOi,
          row.volume,
        ].join(","),
      );
      const meta = [
        `# ${snapshot.symbol} — filtre ${filter} — spot ${snapshot.spot}`,
        `# source : ${snapshot.provenance.source} — à ${new Date(snapshot.provenance.asOf).toISOString()}`,
        `# GEX en dollars par +1 % de mouvement du spot (calls positifs, puts négatifs)`,
      ];
      return new Response([...meta, header, ...lines].join("\n"), {
        headers: {
          "Content-Type": "text/csv; charset=utf-8",
          "Content-Disposition": `attachment; filename="gex-profile-${snapshot.symbol}-${filter}.csv"`,
          "Cache-Control": "public, s-maxage=60, stale-while-revalidate=120",
          "X-Data-Source": snapshot.provenance.provider,
        },
      });
    }

    return cachedJson(snapshot, snapshot.provenance, 60);
  } catch (error) {
    return failure(error);
  }
}
