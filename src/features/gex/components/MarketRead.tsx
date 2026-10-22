/**
 * « Lecture du marché » : trois phrases déterministes sous le régime.
 *
 * Aucune donnée n'est chargée : tout vient du snapshot déjà rendu par le
 * panneau. Le trait de gauche prend la couleur du régime (turquoise en long
 * gamma, braise en short gamma) pour rattacher le texte à la pastille.
 */

import { t } from "@/lib/i18n";
import { narrate } from "../narrator";
import type { GexSnapshot } from "../types";

export function MarketRead({
  snapshot,
  decimals = 2,
}: {
  snapshot: GexSnapshot;
  decimals?: number;
}) {
  const tr = t();
  const read = narrate(snapshot, decimals);

  return (
    <section
      aria-label={tr.narrator.title}
      data-narration-tone={read.tone}
      className="panel mt-3 px-3 py-2.5"
      style={{
        borderLeft: "2px solid rgb(var(--call))",
        borderLeftColor:
          read.tone === "short"
            ? "rgb(var(--put))"
            : read.tone === "neutral"
              ? "rgb(var(--zero))"
              : "rgb(var(--call))",
      }}
    >
      <div className="mb-1.5 flex items-baseline justify-between gap-2">
        <span className="text-[10px] tracking-wide text-tx2 uppercase">
          {tr.narrator.title}
        </span>
        <span className="num text-[9px] text-tx2">{tr.narrator.tag}</span>
      </div>
      <ul className="flex flex-col gap-1.5">
        {read.lines.map((line) => (
          <li key={line.id} className="flex gap-1.5 text-[11px] leading-[1.45] text-tx2">
            <span aria-hidden="true" className="text-ac">
              ›
            </span>
            <span>{line.text}</span>
          </li>
        ))}
      </ul>
    </section>
  );
}
