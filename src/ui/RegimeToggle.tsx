"use client";

/** Bascule de régime : auto (calculé) → long → short. Le mode forcé est un
 *  outil de démonstration : il change l'accent de toute l'interface. */

import { t } from "@/lib/i18n";
import { useUiStore } from "@/store/ui";

export function RegimeToggle() {
  const mode = useUiStore((s) => s.regimeMode);
  const setMode = useUiStore((s) => s.setRegimeMode);

  const modeLabel = mode === "auto" ? "auto" : mode === "long" ? "long" : "short";
  const label = `${t().regime.label} : ${modeLabel}`;

  const cycle = () =>
    setMode(mode === "auto" ? "long" : mode === "long" ? "short" : "auto");

  return (
    <button
      type="button"
      onClick={cycle}
      aria-label={label}
      title={t().regime.label}
      className="rounded-md border border-line px-2.5 py-1 text-[11px] text-tx2 transition-colors duration-200 hover:bg-white/5 hover:text-tx max-md:hidden"
    >
      {label}
    </button>
  );
}
