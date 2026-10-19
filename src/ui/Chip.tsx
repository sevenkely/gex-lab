import type { ReactNode } from "react";

/** Pastille compacte (badges de source, tags de trade, valeurs clés). */
export function Chip({
  children,
  rgb,
  className = "",
  title,
}: {
  children: ReactNode;
  /** Couleur du point en "r,g,b" (cf. tokens --call / --put / --zero). */
  rgb?: string;
  className?: string;
  title?: string;
}) {
  return (
    <span
      title={title}
      className={`inline-flex items-center gap-1.5 rounded bg-white/5 px-2 py-0.5 text-[11px] text-tx ${className}`}
    >
      {rgb && (
        <i
          aria-hidden="true"
          className="size-1.5 flex-none rounded-full"
          style={{ background: `rgb(${rgb})` }}
        />
      )}
      {children}
    </span>
  );
}
