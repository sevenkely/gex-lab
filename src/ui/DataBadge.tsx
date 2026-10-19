import { fmtDelay } from "@/lib/format";
import { t } from "@/lib/i18n";
import type { Provenance } from "@/server/providers/types";

/**
 * Badge de provenance : d'où vient la donnée, avec quelle latence, et si elle
 * est calculée (Estimé), dérivée (proxy), périmée ou de démonstration.
 * C'est le garde-fou d'honnêteté du terminal : aucun chiffre n'apparaît sans.
 */
export function DataBadge({
  provenance,
  compact = false,
  estimated,
}: {
  provenance: Provenance;
  compact?: boolean;
  /** true pour les valeurs issues d'un modèle (GEX, niveaux, mouvement 1σ). */
  estimated?: boolean;
}) {
  const tr = t();
  const flags: string[] = [];
  if (provenance.demo) flags.push("DÉMO");
  if (provenance.derived) flags.push(tr.badges.derived);
  if (estimated) flags.push(tr.badges.estimated);
  if (provenance.stale) flags.push(tr.badges.stale);

  // Horodatages absolus uniquement : une durée relative (« il y a 3 s »)
  // diverge entre le rendu serveur et l'hydratation → mismatch React.
  const tooltip = [
    `${tr.common.source} : ${provenance.source}`,
    `${tr.common.latency} : ${fmtDelay(provenance.delayMs)}`,
    `${tr.common.asOf} : ${new Date(provenance.asOf).toISOString()}`,
    `Récupéré : ${new Date(provenance.fetchedAt).toISOString()}`,
  ].join("\n");

  return (
    <span
      title={tooltip}
      className="inline-flex flex-wrap items-center gap-x-1.5 gap-y-1 font-mono text-[10px] text-tx2"
    >
      <span className={provenance.demo ? "text-zero" : ""}>{provenance.source}</span>
      {!compact && <span aria-hidden="true">·</span>}
      {!compact && <span>{fmtDelay(provenance.delayMs)}</span>}
      {flags.map((flag) => (
        <span
          key={flag}
          className={`rounded border border-line px-1.5 py-px tracking-wide whitespace-nowrap uppercase ${
            flag === "DÉMO" ? "text-zero" : provenance.stale ? "text-put" : "text-tx2"
          }`}
        >
          {flag}
        </span>
      ))}
    </span>
  );
}
