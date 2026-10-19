import { fmt } from "@/lib/format";
import { t } from "@/lib/i18n";
import type { StrikeGex } from "@/features/gex/types";

/**
 * Gamma par strike : puts à gauche, calls à droite, spot surligné.
 * Fenêtre glissante de ± `window` strikes autour du spot courant.
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

  return (
    <div className="flex flex-col gap-1.5">
      {slice.map((row, index) => {
        const isSpot = row.strike === rows[spotIndex].strike;
        const callPct = (Math.abs(row.callGex) / maxAbs) * 100;
        const putPct = (Math.abs(row.putGex) / maxAbs) * 100;
        return (
          <div
            key={row.strike}
            className={`grid h-[23px] grid-cols-[1fr_78px_1fr] items-center gap-1.5 ${
              isSpot ? "rounded bg-white/6" : ""
            }`}
          >
            <div className="relative h-[13px]">
              <i
                aria-hidden="true"
                className="fill absolute top-0 right-0 bottom-0 origin-right rounded-[3px] bg-[rgba(var(--put),.75)]"
                style={{ width: `${putPct}%`, animationDelay: `${index * 35}ms` }}
              />
            </div>
            <span
              className={`num text-center text-[11px] ${
                isSpot ? "font-bold text-tx" : "text-tx2"
              }`}
            >
              {fmt(row.strike, decimals)}
            </span>
            <div className="relative h-[13px]">
              <i
                aria-hidden="true"
                className="fill absolute top-0 bottom-0 left-0 origin-left rounded-[3px] bg-[rgba(var(--call),.75)]"
                style={{ width: `${callPct}%`, animationDelay: `${index * 35}ms` }}
              />
            </div>
          </div>
        );
      })}
    </div>
  );
}
