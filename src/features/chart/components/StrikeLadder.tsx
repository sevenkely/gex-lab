"use client";

/**
 * Ladder de strikes : quatre colonnes de lecture (strike, net DEX, net GEX,
 * net OI) plus le strike rappelé au bord droit.
 *
 * Les rangées ont une hauteur fixe, comme un carnet : une grille de prix
 * projetée sur l'échelle du graphique s'effondrait dès que la vue couvrait
 * plusieurs séances — vingt et un strikes se tassaient alors sur deux cents
 * pixels, illisibles. Le tableau garde son pas, la colonne de gauche dit le
 * prix et les barres disent la magnitude, une rangée à la fois.
 *
 * Chaque barre porte désormais sa valeur chiffrée, alignée à droite de la
 * colonne : les barres donnent la comparaison d'un coup d'œil, les chiffres
 * donnent l'ordre de grandeur, et le pied du tableau les additionne sur la
 * fenêtre affichée. Les barres glissent d'une mise à jour à l'autre
 * (transitions sur `width` / `left`) au lieu de sauter.
 *
 * Les niveaux (murs, flip, max pain) sont rappelés par un filet coloré et une
 * pastille abrégée ; leur nom complet reste sur le graphique, une seule fois.
 * Les niveaux de séance (pVAH / pPOC / pVAL / pLO / pHI) ne sont plus affichés :
 * trop de lignes pour ce qu'ils ajoutent à la lecture du gamma.
 */

import type { StrikeGex } from "@/features/gex/types";
import { fmt, fmtGexCompact } from "@/lib/format";
import { t } from "@/lib/i18n";

const BAR_HEIGHT = 10;
const STRIKES_AROUND_SPOT = 21;

/** 78 px de prix de chaque côté, trois colonnes de barres chiffrées au centre. */
const GRID = "grid-cols-[78px_1fr_1fr_1fr_78px]";

type Tone = "dex" | "gex" | "oi";

const TONE_RGB: Record<Tone, string> = {
  dex: "14, 203, 129",
  gex: "14, 203, 129",
  oi: "160, 185, 230",
};

/**
 * Une cellule de barre : rail au centre, barre divergente, valeur à droite.
 *
 * La barre reste dans la moitié qui correspond au signe de la valeur (positives
 * à droite, négatives à gauche) et sa longueur est relative au 85e centile de la
 * colonne. Les chiffres sont alignés à droite sur une pastille opaque : une
 * grande barre passe derrière eux sans les rendre illisibles.
 */
function Metric({
  value,
  max,
  tone,
  text,
}: {
  value: number;
  max: number;
  tone: Tone;
  text: string;
}) {
  const share = max > 0 ? Math.min(1, Math.abs(value) / max) : 0;
  const positive = value >= 0;
  const rgb = tone === "oi" ? TONE_RGB.oi : positive ? TONE_RGB.dex : "246, 70, 93";
  const width = share * 50;
  const zero = Math.abs(value) < 1e-9;

  return (
    <span className="flex h-full w-full items-center gap-1.5">
      {/* Arène de barre : le chiffre a sa propre colonne, la barre ne passe
          jamais dessous — la valeur reste lisible même à saturation. */}
      <span className="relative block h-full flex-1">
        <span
          aria-hidden="true"
          className="absolute inset-y-0 left-1/2 w-px bg-white/[0.06]"
        />
        <span
          aria-hidden="true"
          className="absolute top-1/2 -translate-y-1/2 rounded-full transition-[width,left,background] duration-[420ms] ease-[var(--ease)]"
          style={{
            left: positive ? "50%" : `${50 - width}%`,
            width: `${zero ? 0 : Math.max(1, width)}%`,
            height: BAR_HEIGHT,
            background: positive
              ? `linear-gradient(90deg, rgba(${rgb},.9), rgba(${rgb},.5))`
              : `linear-gradient(270deg, rgba(${rgb},.9), rgba(${rgb},.5))`,
            boxShadow: `0 0 12px rgba(${rgb},.2)`,
          }}
        />
      </span>
      <span
        className="num w-[46px] shrink-0 text-right text-[9.5px] leading-none whitespace-nowrap tabular-nums transition-opacity duration-150 group-hover:opacity-100"
        style={{ color: zero ? "rgba(139,151,173,.72)" : `rgba(${rgb}, .95)`, opacity: 0.92 }}
      >
        {text}
      </span>
    </span>
  );
}

export function StrikeLadder({
  rows,
  spot,
  decimals,
  highlightPrice,
  levelPrices = [],
}: {
  rows: readonly StrikeGex[];
  spot: number;
  decimals: number;
  highlightPrice?: number | null;
  /**
   * Niveaux : leur rangée reçoit un filet coloré et, à gauche, une pastille
   * abrégée (CW, PW2, ZG…) à la place du prix — le prix reste au bord droit.
   */
  levelPrices?: readonly { price: number; rgb: string; label?: string }[];
}) {
  const tr = t();
  /** Décimales réellement utiles pour écrire un strike de cette grille. */
  const strikeSteps = strikeDecimals(
    rows.map((row) => row.strike),
    decimals,
  );
  const atSpot = nearestStrike(rows, spot);
  const highlightStrike =
    highlightPrice !== null && highlightPrice !== undefined
      ? nearestStrike(rows, highlightPrice)
      : null;

  // Échelle par quantile, pas par maximum : un strike extrême (mur lointain,
  // un milliard de DEX) écrasait toutes les autres barres à un pixel. Les
  // valeurs au-delà du 85e centile saturent à la demi-colonne ; les valeurs
  // courantes restent lisibles.
  const max = {
    dex: quantile(rows.map((row) => Math.abs(row.netDex))),
    gex: quantile(rows.map((row) => Math.abs(row.netGex))),
    oi: quantile(rows.map((row) => row.oi)),
  };

  const totals = rows.reduce(
    (acc, row) => ({
      dex: acc.dex + row.netDex,
      gex: acc.gex + row.netGex,
      oi: acc.oi + row.oi,
    }),
    { dex: 0, gex: 0, oi: 0 },
  );

  const levelAt = (strike: number) =>
    levelPrices.find((level) => Math.abs(level.price - strike) < 1e-6) ?? null;

  return (
    <div className="flex h-full w-[var(--ladder-w)] flex-col border-l border-line bg-bg/55 backdrop-blur-sm">
      <div
        className={`grid h-8 flex-none ${GRID} items-center gap-1 border-b border-line bg-bg/70 px-1.5 text-[9px] font-semibold tracking-[0.08em] text-tx2 uppercase`}
      >
        <span className="border-r border-white/12 pr-2 text-right">
          {tr.chart.ladder.strike}
        </span>
        <span className="pr-1 text-right">{tr.chart.ladder.dex}</span>
        <span className="pr-1 text-right">{tr.chart.ladder.gex}</span>
        <span className="pr-1 text-right">{tr.chart.ladder.oi}</span>
        <span className="border-l border-white/12 px-2 text-left">
          {tr.chart.ladder.strike}
        </span>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain">
        <div className="grid h-full" style={{ gridAutoRows: "minmax(22px, 1fr)" }}>
          {rows.map((row, index) => {
            const level = levelAt(row.strike);
            const isSpot = row.strike === atSpot;
            const isHighlight = row.strike === highlightStrike;
            return (
              <div
                key={row.strike}
                className={`group relative grid ${GRID} items-center gap-1 px-1.5 transition-colors duration-150 ${
                  level
                    ? "bg-white/[0.05]"
                    : isHighlight
                      ? "bg-white/[0.045]"
                      : isSpot
                        ? "bg-ac/[0.06]"
                        : index % 2 === 1
                          ? "bg-white/[0.012]"
                          : ""
                } hover:bg-white/[0.07]`}
                title={`${fmt(row.strike, strikeSteps)} · DEX ${fmtGexCompact(row.netDex)} · GEX ${fmtGexCompact(row.netGex)} · OI ${fmt(row.oi, 0)}`}
              >
                {level && (
                  <span
                    aria-hidden="true"
                    className="pointer-events-none absolute inset-x-0 top-0 h-px"
                    style={{ background: `rgba(${level.rgb}, .42)` }}
                  />
                )}
                {(isSpot || level) && (
                  <span
                    aria-hidden="true"
                    className="pointer-events-none absolute inset-y-0 left-0 w-[2px]"
                    style={{
                      background: level ? `rgb(${level.rgb})` : "var(--ac)",
                      opacity: level ? 0.7 : 0.9,
                    }}
                  />
                )}

                {level?.label ? (
                  <span
                    className="mx-0.5 rounded-[3px] py-0.5 text-center text-[9.5px] leading-none font-semibold tracking-[0.04em] text-[#0b1220] uppercase"
                    style={{ background: `rgb(${level.rgb})` }}
                  >
                    {level.label}
                  </span>
                ) : (
                  <span
                    className={`num pr-2 text-right text-[11px] tabular-nums ${
                      isSpot
                        ? "font-semibold text-tx"
                        : isHighlight
                          ? "text-tx"
                          : "text-tx2"
                    }`}
                  >
                    {fmt(row.strike, strikeSteps)}
                  </span>
                )}

                <Metric
                  value={row.netDex}
                  max={max.dex}
                  tone="dex"
                  text={fmtGexCompact(row.netDex)}
                />
                <Metric
                  value={row.netGex}
                  max={max.gex}
                  tone="gex"
                  text={fmtGexCompact(row.netGex)}
                />
                <Metric
                  value={row.oi}
                  max={max.oi}
                  tone="oi"
                  text={fmt(row.oi, 0)}
                />

                <span
                  className={`num flex items-center gap-1 px-2 text-left text-[11px] tabular-nums ${
                    isSpot ? "font-semibold text-tx" : "text-tx2/75"
                  }`}
                >
                  {isSpot && (
                    <span
                      aria-hidden="true"
                      className="size-1.5 rounded-full bg-ac shadow-[0_0_8px_var(--ac)]"
                    />
                  )}
                  {fmt(row.strike, strikeSteps)}
                </span>
              </div>
            );
          })}

          {rows.length === 0 && (
            <p className="px-3 py-6 text-[11px] text-tx2">{tr.chart.ladder.empty}</p>
          )}
        </div>
      </div>

      {/* Somme de la fenêtre : les barres disent la forme, le pied dit le total. */}
      <div
        className={`grid h-7 flex-none ${GRID} items-center gap-1 border-t border-line bg-bg/70 px-1.5 text-[10px] text-tx2`}
      >
        <span className="pr-2 text-right text-[9px] tracking-[0.08em] uppercase">
          {tr.chart.ladder.total}
        </span>
        <span className="num pr-1 text-right tabular-nums">
          {fmtGexCompact(totals.dex)}
        </span>
        <span className="num pr-1 text-right tabular-nums">
          {fmtGexCompact(totals.gex)}
        </span>
        <span className="num pr-1 text-right tabular-nums">
          {fmt(totals.oi, 0)}
        </span>
        <span className="px-2 text-left text-[9px] tracking-[0.08em] uppercase">
          {rows.length} {tr.chart.ladder.strikes}
        </span>
      </div>
    </div>
  );
}

/**
 * Décimales réellement nécessaires pour écrire les strikes affichés.
 *
 * Chaque rangée porte son prix exact, mais un strike entier n'a pas besoin de
 * « 7 815.00 » — on garde le plus petit nombre de décimales qui écrit la
 * grille sans arrondi, plafonné à la précision de l'actif.
 */
export function strikeDecimals(strikes: readonly number[], cap = 2): number {
  if (strikes.length === 0) return cap;
  for (let decimals = 0; decimals <= cap; decimals++) {
    const factor = 10 ** decimals;
    if (
      strikes.every(
        (strike) => Math.abs(strike * factor - Math.round(strike * factor)) < 1e-6,
      )
    ) {
      return decimals;
    }
  }
  return cap;
}

/** Strikes retenus : les plus proches du spot, du plus haut au plus bas. */
export function ladderRows(
  rows: readonly StrikeGex[],
  spot: number,
  count = STRIKES_AROUND_SPOT,
): StrikeGex[] {
  return [...rows]
    .sort((a, b) => Math.abs(a.strike - spot) - Math.abs(b.strike - spot))
    .slice(0, count)
    .sort((a, b) => b.strike - a.strike);
}

/** 85e centile des magnitudes : l'échelle d'une colonne de barres. */
function quantile(values: readonly number[]): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const index = Math.min(sorted.length - 1, Math.floor(sorted.length * 0.85));
  return Math.max(sorted[index], 1e-9);
}

function nearestStrike(rows: readonly StrikeGex[], price: number): number | null {
  let best: number | null = null;
  let distance = Infinity;
  for (const row of rows) {
    const next = Math.abs(row.strike - price);
    if (next < distance) {
      distance = next;
      best = row.strike;
    }
  }
  return best;
}
