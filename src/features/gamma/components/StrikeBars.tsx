import { fmt, fmtGexCompact } from "@/lib/format";
import { t } from "@/lib/i18n";
import type { StrikeGex } from "@/features/gex/types";

/**
 * Gamma par strike : puts à gauche, calls à droite, spot surligné.
 * Fenêtre glissante de ± `window` strikes autour du spot courant.
 *
 * Chaque barre porte sa valeur à son extrémité extérieure (puts tout à gauche,
 * calls tout à droite) : la longueur donne le rapport, le nombre donne la
 * valeur exacte, sans survol obligatoire.
 */
export function StrikeBars({
  rows,
  spot,
  decimals = 2,
  window = 8,
}: {
  rows: readonly StrikeGex[];
  spot: number;
  decimals?: number;
  window?: number;
}) {
  if (rows.length === 0) {
    return <p className="text-xs text-tx2">{t().gamma.empty}</p>;
  }

  // strike le plus proche du spot, puis fenêtre autour de lui
  const spotIndex = rows.reduce(
    (best, row, index) =>
      Math.abs(row.strike - spot) < Math.abs(rows[best].strike - spot) ? index : best,
    0,
  );
  const from = Math.max(0, spotIndex - window);
  const to = Math.min(rows.length, spotIndex + window + 1);
  const slice = rows.slice(from, to);
  const maxAbs = Math.max(
    1e-9,
    ...slice.flatMap((row) => [Math.abs(row.callGex), Math.abs(row.putGex)]),
  );
  const spotStrike = rows[spotIndex].strike;

  return (
    <div className="flex flex-col gap-1.5">
      {slice.map((row, index) => {
        const isSpot = row.strike === spotStrike;
        const callPct = (Math.abs(row.callGex) / maxAbs) * 100;
        const putPct = (Math.abs(row.putGex) / maxAbs) * 100;
        return (
          <div
            key={row.strike}
            style={{ ["--i" as string]: index }}
            className={`group grid h-[23px] grid-cols-[70px_1fr_82px_1fr_70px] items-center gap-1.5 rounded transition-colors ${
              isSpot ? "bg-white/[0.06]" : "hover:bg-white/[0.03]"
            }`}
          >
            <span className="num truncate text-right text-[9px] text-put/80 opacity-70 transition-opacity group-hover:opacity-100">
              {fmtGexCompact(row.putGex)}
            </span>
            <div className="relative h-[13px]">
              <i
                aria-hidden="true"
                className="fill absolute top-0 right-0 bottom-0 origin-right rounded-[3px] bg-put/75"
                style={{ width: `${putPct}%`, ["--d" as string]: `${index * 35}ms` }}
              />
            </div>
            <span
              className={`num text-center text-[11px] ${
                isSpot ? "font-bold text-tx" : "text-tx2"
              }`}
            >
              {fmt(row.strike, decimals)}
              {isSpot && (
                <i
                  aria-hidden="true"
                  className="ml-1 inline-block size-1.5 -translate-y-px rounded-full bg-ac"
                />
              )}
            </span>
            <div className="relative h-[13px]">
              <i
                aria-hidden="true"
                className="fill absolute top-0 bottom-0 left-0 origin-left rounded-[3px] bg-call/75"
                style={{ width: `${callPct}%`, ["--d" as string]: `${index * 35}ms` }}
              />
            </div>
            <span className="num truncate text-[9px] text-call/80 opacity-70 transition-opacity group-hover:opacity-100">
              {fmtGexCompact(row.callGex)}
            </span>
          </div>
        );
      })}
    </div>
  );
}
