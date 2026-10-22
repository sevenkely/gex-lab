import { chainAssets } from "@/config/assets";
import { cachedJson, failure } from "@/server/api";
import { getChainResult } from "@/server/registry";

export const dynamic = "force-dynamic";

// Les chaînes CBOE (jusqu’à 13 Mo) peuvent être lentes à froid : on laisse
// de la marge au rendu serveur plutôt que de couper la requête.
export const maxDuration = 60;

/**
 * Activité d'options des indices — PAS un flux de trades.
 *
 * CBOE ne publie pas les prints gratuits : on ne peut mesurer que la variation
 * du volume cumulé entre deux snapshots successifs (espacés d'au moins un
 * rafraîchissement de la source, ~15 min). L'UI doit l'afficher comme
 * « activité (Δ volume) », jamais comme des trades.
 */

interface VolumeMark {
  /** Timestamp de la source (ms). */
  asOf: number;
  volume: number;
  oi: number;
}

const history = new Map<string, VolumeMark[]>();
const MAX_MARKS = 10;

/** Assets : SPX, NDX, SPY, QQQ, GLD (chaînes CBOE). */
export async function GET() {
  try {
    const assets = chainAssets().filter((asset) => asset.chainSource === "cboe");
    const results = await Promise.all(
      assets.map(async (asset) => {
        const result = await getChainResult(asset);
        let volume = 0;
        let oi = 0;
        const byStrike = new Map<number, { volume: number; oi: number }>();
        for (const contract of result.data.contracts) {
          volume += contract.volume;
          oi += contract.oi;
          const row = byStrike.get(contract.strike) ?? { volume: 0, oi: 0 };
          row.volume += contract.volume;
          row.oi += contract.oi;
          byStrike.set(contract.strike, row);
        }
        const topStrikes = [...byStrike.entries()]
          .map(([strike, row]) => ({ strike, ...row }))
          .sort((a, b) => b.volume - a.volume)
          .slice(0, 6);

        const marks = history.get(asset.id) ?? [];
        const asOf = result.provenance.asOf;
        const previous = marks.at(-1);
        // Nouveau snapshot de la source uniquement (sinon Δ = 0 par définition).
        if (!previous || Math.abs(previous.asOf - asOf) > 1_000) {
          marks.push({ asOf, volume, oi });
          if (marks.length > MAX_MARKS) marks.shift();
          history.set(asset.id, marks);
        }
        const base = marks.at(-2);
        // Pas de mesure précédente = pas de variation (null, pas 0) :
        // afficher « 0 » laisserait croire à une absence de trades.
        const deltaVolume = base ? Math.max(0, volume - base.volume) : null;

        return {
          assetId: asset.id,
          symbol: asset.symbol,
          volume,
          oi,
          deltaVolume,
          /** Volume du jour / open interest : mesure de rotation, pas de flux. */
          volumeOiRatio: oi > 0 ? volume / oi : null,
          contracts: result.data.contracts.length,
          topStrikes,
          asOf,
          delayMs: result.provenance.delayMs,
          source: result.provenance.source,
        };
      }),
    );

    const first = results[0];
    return cachedJson(
      {
        method: "delta-volume" as const,
        note: "Variation du volume cumulé entre deux snapshots CBOE — pas des trades.",
        rows: results,
      },
      {
        source: first?.source ?? "CBOE",
        provider: "cboe",
        asOf: first?.asOf ?? Date.now(),
        fetchedAt: Date.now(),
        delayMs: first?.delayMs ?? 900_000,
        // Mesure calculée, mais pas un proxy d'un autre actif : « derived »
        // reste réservé aux niveaux NQ/GC.
        derived: false,
        stale: false,
        demo: false,
      },
      60,
    );
  } catch (error) {
    return failure(error);
  }
}
