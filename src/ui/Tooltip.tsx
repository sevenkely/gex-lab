import type { ReactNode } from "react";

/**
 * Info-bulle purement CSS (aucun état React, aucun listener) : coût nul sur
 * les composants à fort rafraîchissement.
 */
export function Tooltip({
  label,
  children,
  side = "top",
  className = "",
}: {
  label: ReactNode;
  children: ReactNode;
  side?: "top" | "bottom";
  className?: string;
}) {
  const position =
    side === "top"
      ? "bottom-full mb-1.5 left-1/2 -translate-x-1/2"
      : "top-full mt-1.5 left-1/2 -translate-x-1/2";
  return (
    <span className={`group/tip relative inline-flex ${className}`}>
      {children}
      <span
        role="tooltip"
        className={`pointer-events-none absolute z-30 max-w-[280px] rounded-md border border-line bg-[#141c2e] px-2 py-1 text-[11px] whitespace-pre-line text-tx opacity-0 shadow-lg transition-opacity duration-150 group-hover/tip:opacity-100 group-focus-within/tip:opacity-100 ${position}`}
      >
        {label}
      </span>
    </span>
  );
}
