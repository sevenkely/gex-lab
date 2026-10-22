import type { ReactNode } from "react";

/**
 * Masthead de page : une ligne de contexte, un titre éditorial, une accroche
 * et un emplacement pour la métrique ou la provenance. Le filet inférieur
 * s'illumine de gauche à droite à l'arrivée de la page.
 *
 * Le titre n'est pas le nom de la navigation (déjà dans le header) : il dit ce
 * que la page observe, pour éviter deux fois le même mot à vingt pixels.
 */
export function PageHeader({
  eyebrow,
  title,
  lead,
  aside,
}: {
  eyebrow: ReactNode;
  title: ReactNode;
  lead?: ReactNode;
  aside?: ReactNode;
}) {
  return (
    <header className="relative mb-5 border-b border-line pb-4">
      <div className="flex flex-wrap items-end justify-between gap-x-8 gap-y-4">
        <div className="min-w-0 flex-1">
          <p className="flex items-center gap-2 font-mono text-[10px] tracking-[0.18em] text-tx2 uppercase">
            <span aria-hidden="true" className="h-px w-7 bg-ac/70" />
            {eyebrow}
          </p>
          <h2 className="mt-2.5 text-[clamp(24px,2.4vw,34px)] leading-[1.05] font-semibold tracking-[-0.03em] text-balance">
            {title}
          </h2>
          {lead && (
            <p className="mt-2 max-w-[78ch] text-xs leading-relaxed text-tx2">{lead}</p>
          )}
        </div>
        {aside && (
          <div className="flex shrink-0 flex-col items-start gap-2 sm:items-end">
            {aside}
          </div>
        )}
      </div>
      <span
        aria-hidden="true"
        className="rule-sweep absolute inset-x-0 -bottom-px h-px origin-left bg-gradient-to-r from-ac/80 via-line to-transparent"
      />
    </header>
  );
}

/**
 * Métrique de synthèse : libellé en petites capitales, valeur en mono, note
 * courte. Le liseré coloré est facultatif — il relie la valeur à sa famille
 * (call, put, zero) sans colorer tout le panneau.
 */
export function Stat({
  label,
  value,
  hint,
  rgb,
  index = 0,
}: {
  label: ReactNode;
  value: ReactNode;
  hint?: ReactNode;
  rgb?: string;
  index?: number;
}) {
  return (
    <div
      style={{ ["--i" as string]: index }}
      className="stat-in panel relative overflow-hidden px-3.5 py-3"
    >
      {rgb && (
        <span
          aria-hidden="true"
          className="absolute inset-y-3 left-0 w-px"
          style={{ background: `rgba(${rgb},.8)` }}
        />
      )}
      <div className="text-[10px] tracking-[0.1em] text-tx2 uppercase">{label}</div>
      <div
        className="num mt-1 text-[21px] leading-none font-semibold"
        style={rgb ? { color: `rgb(${rgb})` } : undefined}
      >
        {value}
      </div>
      {hint && <div className="mt-1 text-[10px] text-tx2">{hint}</div>}
    </div>
  );
}
