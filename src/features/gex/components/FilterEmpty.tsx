/**
 * Filtre sans contrat : on l'explique au lieu d'afficher des zéros.
 *
 * Un snapshot vide (0DTE en crypto après l'expiration quotidienne, 0DTE un
 * jour férié sur les indices, fenêtre trop étroite) ne signifie pas « Net GEX
 * nul » : aucun niveau n'est calculable. Les pages remplacent alors leurs
 * métriques par ce panneau, avec la sortie de secours (« Toutes »).
 */

import { t } from "@/lib/i18n";

export function FilterEmpty({
  symbol,
  filter,
  className = "",
}: {
  symbol: string;
  filter: string;
  className?: string;
}) {
  const tr = t().gex.empty;

  return (
    <div
      className={`panel flex flex-col gap-1.5 px-3.5 py-3 ${className}`}
      data-filter-empty={filter}
      role="status"
    >
      <div className="flex items-center gap-2">
        <i aria-hidden="true" className="size-1.5 rounded-full bg-zero" />
        <span className="text-xs font-semibold text-tx">{tr.title}</span>
      </div>
      <p className="text-[11px] leading-[1.45] text-tx2">
        {tr.body.replace("{symbol}", symbol)}
      </p>
      <p className="text-[10px] leading-[1.4] text-tx2">{tr.hint}</p>
    </div>
  );
}
