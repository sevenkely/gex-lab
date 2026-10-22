import type { CSSProperties } from "react";

/**
 * Marque d'actif : identité visuelle courte, lisible à 18 px comme à 32 px.
 *
 * Aucune image distante ni police d'icônes : les crypto ont un glyphe dessiné
 * (cercle ₿, losange ETH), les futures et ETF un monogramme sur teinte propre.
 * La teinte de la marque est fixe — elle ne suit pas le régime, sinon deux
 * pastilles voisines changeraient de couleur avec le marché et perdraient leur
 * rôle de repère.
 */

interface MarkStyle {
  /** Glyphe affiché (monogramme) sauf pour les crypto dessinées. */
  glyph: string;
  /** Couleur de la marque. */
  color: string;
  /** Forme dessinée en SVG, prioritaire sur le glyphe. */
  shape?: "bitcoin" | "ethereum";
}

const MARKS: Record<string, MarkStyle> = {
  BTC: { glyph: "B", color: "#f7931a", shape: "bitcoin" },
  ETH: { glyph: "E", color: "#8a9ff5", shape: "ethereum" },
  ES: { glyph: "ES", color: "#4f8ff7" },
  NQ: { glyph: "NQ", color: "#a78bfa" },
  GC: { glyph: "GC", color: "#e0b341" },
  SPX: { glyph: "SP", color: "#5ea2f0" },
  NDX: { glyph: "ND", color: "#9b8cf5" },
  SPY: { glyph: "SY", color: "#38bdf8" },
  QQQ: { glyph: "QQ", color: "#b48cf2" },
  GLD: { glyph: "GL", color: "#d9a53a" },
};

const FALLBACK: MarkStyle = { glyph: "?", color: "#8b97ad" };

export function AssetMark({
  assetId,
  size = 22,
  className = "",
}: {
  assetId: string;
  size?: number;
  className?: string;
}) {
  const mark = MARKS[assetId.toUpperCase()] ?? FALLBACK;
  const style: CSSProperties = {
    width: size,
    height: size,
    color: mark.color,
    borderColor: `color-mix(in srgb, ${mark.color} 42%, transparent)`,
    background: `color-mix(in srgb, ${mark.color} 13%, transparent)`,
    borderRadius: Math.max(5, Math.round(size * 0.26)),
  };

  return (
    <span
      aria-hidden="true"
      style={style}
      className={`inline-grid flex-none place-items-center border ${className}`}
    >
      {mark.shape === "bitcoin" ? (
        <svg viewBox="0 0 24 24" width={size * 0.64} height={size * 0.64} aria-hidden="true">
          <path
            d="M12 3.2a8.8 8.8 0 1 0 0 17.6 8.8 8.8 0 0 0 0-17.6Z"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.5"
          />
          <path
            d="M9.9 7.9h3.2c1.5 0 2.4.8 2.4 2 0 .9-.5 1.5-1.3 1.8.9.3 1.5 1 1.5 2 0 1.4-1.1 2.3-2.7 2.3H9.9V7.9Zm1.8 1.4v1.9h1.2c.6 0 1-.3 1-.9 0-.6-.4-.9-1-.9h-1.2Zm0 3.3v2.1h1.4c.7 0 1.1-.4 1.1-1s-.4-1.1-1.1-1.1h-1.4Z"
            fill="currentColor"
          />
          <path d="M11.3 6.2v1.2M13 6.2v1.2M11.3 16.6v1.2M13 16.6v1.2" stroke="currentColor" strokeWidth="1.1" strokeLinecap="round" />
        </svg>
      ) : mark.shape === "ethereum" ? (
        <svg viewBox="0 0 24 24" width={size * 0.62} height={size * 0.62} aria-hidden="true">
          <path d="M12 2.8 6.6 12 12 15.3 17.4 12 12 2.8Z" fill="currentColor" opacity="0.9" />
          <path d="M12 16.7 6.6 13.2 12 21.2l5.4-8-5.4 3.5Z" fill="currentColor" opacity="0.55" />
        </svg>
      ) : (
        <span
          className="num font-semibold tracking-[-0.03em]"
          style={{ fontSize: Math.max(7, Math.round(size * 0.42)), lineHeight: 1 }}
        >
          {mark.glyph}
        </span>
      )}
    </span>
  );
}
