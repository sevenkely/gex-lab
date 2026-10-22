/**
 * Sparkline : chemin SVG tracé avec l'animation de dessin (pathLength = 1).
 * Aucune dépendance, aucun état : c'est un rendu pur côté serveur.
 */
export function Spark({
  points,
  up,
  height = 44,
  className = "",
}: {
  points: readonly number[];
  up: boolean;
  height?: number;
  className?: string;
}) {
  const width = 200;
  if (points.length < 2) {
    return <div style={{ height }} className={`w-full bg-white/2 ${className}`} />;
  }
  const min = Math.min(...points);
  const max = Math.max(...points);
  const span = max - min || 1;
  const step = width / (points.length - 1);
  const path = points
    .map((value, index) => {
      const x = index * step;
      const y = height - 4 - ((value - min) / span) * (height - 8);
      return `${index === 0 ? "M" : "L"}${x.toFixed(1)} ${y.toFixed(1)}`;
    })
    .join(" ");

  // Le tracé reprend la convention des bougies : vert pour la hausse, rouge
  // pour la baisse — le sens du prix, pas l'accent du régime de la page.
  const stroke = up ? "var(--candle-up)" : "var(--candle-down)";

  return (
    <svg
      viewBox={`0 0 ${width} ${height}`}
      preserveAspectRatio="none"
      aria-hidden="true"
      className={`spark block w-full ${className}`}
      style={{ height }}
    >
      <path
        pathLength={1}
        d={path}
        fill="none"
        stroke={stroke}
        strokeWidth={1.6}
        strokeLinejoin="round"
        strokeLinecap="round"
      />
    </svg>
  );
}
