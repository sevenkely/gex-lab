import { fmtGexCompact } from "@/lib/format";

/**
 * Barres divergentes du Net GEX (positives à droite, négatives à gauche).
 * L'échelle est relative au plus grand |GEX| de la liste : on compare les
 * actifs entre eux, pas à une valeur absolue.
 */
export function GexBars({
  rows,
  unit = "$",
}: {
  rows: readonly { symbol: string; value: number; href?: string }[];
  unit?: string;
}) {
  const max = Math.max(1e-9, ...rows.map((r) => Math.abs(r.value)));
  return (
    <div className="flex flex-col gap-1.5">
      {rows.map((row, index) => {
        const width = Math.max(1.5, (Math.abs(row.value) / max) * 50);
        const positive = row.value >= 0;
        return (
          <div
            key={row.symbol}
            className="grid h-7 grid-cols-[44px_1fr_64px] items-center gap-2.5"
          >
            <b className="text-xs font-semibold">{row.symbol}</b>
            <span className="relative h-2 rounded bg-white/4">
              <i
                aria-hidden="true"
                className="fill absolute top-0 bottom-0 origin-left rounded"
                style={{
                  [positive ? "left" : "right"]: "50%",
                  width: `${width}%`,
                  background: positive ? "rgba(var(--call),.75)" : "rgba(var(--put),.75)",
                  animationDelay: `${index * 60}ms`,
                  transformOrigin: positive ? "left" : "right",
                }}
              />
            </span>
            <span
              className={`num text-right text-xs ${positive ? "text-call" : "text-put"}`}
            >
              {fmtGexCompact(row.value)}
              {unit === "$" ? "" : unit}
            </span>
          </div>
        );
      })}
    </div>
  );
}
