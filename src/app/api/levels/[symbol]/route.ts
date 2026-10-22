import type { NextRequest } from "next/server";
import { getAsset } from "@/config/assets";
import { parseExpiryFilter } from "@/lib/params";
import { cachedJson, failure } from "@/server/api";
import { ProviderError } from "@/server/providers/types";
import { getGexSnapshot } from "@/server/registry";

export const dynamic = "force-dynamic";

// Les chaînes CBOE (jusqu’à 13 Mo) peuvent être lentes à froid : on laisse
// de la marge au rendu serveur plutôt que de couper la requête.
export const maxDuration = 60;

const KIND_LABEL: Record<string, string> = {
  callWall: "Call Wall",
  putWall: "Put Wall",
  zeroGamma: "Zero Gamma",
  maxGamma: "Max Gamma",
  maxPain: "Max Pain",
};

/**
 * GET /api/levels/NQ?filter=ALL&format=csv
 *
 * Sortie stable, pensée pour être ingérée par ATAS / NinjaTrader :
 *   niveau,type,prix,source
 *   Call Wall,callWall,30112.25,CBOE (différé 15 min)
 */
export async function GET(
  request: NextRequest,
  context: { params: Promise<{ symbol: string }> },
) {
  const { symbol } = await context.params;
  const asset = getAsset(symbol);
  if (!asset) return failure(new ProviderError(`Actif inconnu : ${symbol}`, "not_found"));

  const search = request.nextUrl.searchParams;
  const filter = parseExpiryFilter(search.get("filter") ?? undefined);
  const format = (search.get("format") ?? "json").toLowerCase();

  try {
    const snapshot = await getGexSnapshot(asset.id, { filter });
    const rows = snapshot.levels.map((level) => {
      const base = KIND_LABEL[level.kind] ?? level.kind;
      const rank = level.rank ?? 1;
      return {
        label: rank > 1 ? `${base} ${rank}` : base,
        kind: level.kind,
        rank,
        price: level.price,
        source: snapshot.provenance.source,
      };
    });

    if (format === "csv") {
      const header = "niveau,type,prix,source";
      const lines = rows.map(
        (row) => `${row.label},${row.kind},${row.price},"${row.source.replace(/"/g, '""')}"`,
      );
      return new Response([header, ...lines].join("\n"), {
        headers: {
          "Content-Type": "text/csv; charset=utf-8",
          "Content-Disposition": `inline; filename="gex-levels-${asset.id}.csv"`,
          "Cache-Control": "public, s-maxage=60, stale-while-revalidate=120",
          "X-Data-Source": snapshot.provenance.provider,
        },
      });
    }

    return cachedJson(
      {
        assetId: asset.id,
        symbol: asset.symbol,
        filter,
        spot: snapshot.spot,
        levels: rows,
        proxy: snapshot.proxy ?? null,
      },
      snapshot.provenance,
      60,
    );
  } catch (error) {
    return failure(error);
  }
}
