import { t } from "@/lib/i18n";
import type { GexRegime } from "../types";

/** Pastille de régime : long gamma (turquoise) / short gamma (braise). */
export function RegimeBadge({
  regime,
  className = "",
}: {
  regime: GexRegime;
  className?: string;
}) {
  const label = regime === "long" ? t().regime.long : t().regime.short;
  return (
    <div
      className={`panel flex items-center gap-2 bg-surf px-3 py-2 ${className}`}
      data-regime-badge={regime}
    >
      <i
        aria-hidden="true"
        className="accent size-1.5 animate-[pulse_2s_ease-in-out_infinite] rounded-full bg-ac"
      />
      <span className="text-xs text-tx">{label}</span>
    </div>
  );
}
