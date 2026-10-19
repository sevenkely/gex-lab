/**
 * Halo : calque fixe derrière l'application. Deux calques superposés — turquoise
 * (long gamma) et braise (short gamma) — dont l'opacité se croise quand le
 * régime change (les dégradés eux-mêmes ne sont pas interpolables).
 * Purement décoratif : `aria-hidden`, dérive lente désactivée sous
 * prefers-reduced-motion.
 */
export function Glow() {
  return (
    <div id="glow" aria-hidden="true">
      <span className="glow-long" />
      <span className="glow-short" />
    </div>
  );
}
