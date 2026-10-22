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
 * Les niveaux (murs, flip, max pain, séance) sont rappelés par un filet coloré
 * et un prix en gras ; leur nom reste sur la pastille du graphique, une seule
 * fois.
 */

import type { SessionLevelKind, StrikeGex } from "@/features/gex/types";
import { fmt, fmtGexCompact, fmtMoney } from "@/lib/format";
import { t } from "@/lib/i18n";

const BAR_HEIGHT = 9;
const STRIKES_AROUND_SPOT = 21;

/** 74 px de prix de chaque côté, trois colonnes de barres au centre. */
const GRID = "grid-cols-[74px_1fr_1fr_1fr_74px]";

const SESSION_RGB: Record<SessionLevelKind, string> = {
  pVAH: "174, 188, 208",
  pPOC: "180, 160, 229",
  pVAL: "174, 188, 208",
  pLO: "230, 236, 245",
  pHI: "230, 236, 245",
};

export function sessionRgb(kind: SessionLevelKind): string {
  return SESSION_RGB[kind];
}

/**
 * Barre divergente : positives à droite du rail, négatives à gauche, longueur
 * proportionnelle à la plus grande valeur de la colonne. Le rail est le zéro de
 * la colonne — c'est lui qui rend les trois métriques comparables d'une rangée
 * à l'autre, sans écrire un seul chiffre.
 */
function Bar({
  value,
  max,
  neutral = false,
}: {
  value: number;
  max: number;
  neutral?: boolean;
}) {
  const share = max > 0 ? Math.min(1, Math.abs(value) / max) : 0;
  const positive = value >= 0;
  const rgb = neutral ? "160, 185, 230" : positive ? "14, 203, 129" : "246, 70, 93";
  const width = share * 50;
  return (
    <span className="relative block h-full w-full">
      <span
        aria-hidden="true"
        className="absolute inset-y-0 left-1/2 w-px bg-white/[0.07]"
      />
      <span
        aria-hidden="true"
        className="absolute top-1/2 -translate-y-1/2 rounded-[2px]"
        style={{
          left: positive ? "50%" : `${50 - width}%`,
          width: `${Math.max(share > 0 ? 0.8 : 0, width)}%`,
          height: BAR_HEIGHT,
          background: `rgba(${rgb}, ${neutral ? 0.42 : 0.8})`,
          boxShadow: `0 0 10px rgba(${rgb}, .16)`,
        }}
      />
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
        <span className="text-center">{tr.chart.ladder.dex}</span>
        <span className="text-center">{tr.chart.ladder.gex}</span>
        <span className="text-center">{tr.chart.ladder.oi}</span>
        <span className="border-l border-white/12 pl-2 text-left">
          {tr.chart.ladder.strike}
        </span>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain">
        <div className="grid h-full"          style={{ gridAutoRows: "minmax(20px, 1fr)" }}>
          {rows.map((row) => {
            const level = levelAt(row.strike);
            const isSpot = row.strike === atSpot;
            return (
              <div
                key={row.strike}
                className={`relative grid ${GRID} items-center gap-1 px-1.5 transition-colors duration-150 hover:bg-white/[0.05] ${
                  level
                    ? "bg-white/[0.045]"
                    : row.strike === highlightStrike
                      ? "bg-white/5"
                      : isSpot
                        ? "bg-white/[0.035]"
                        : ""
                }`}
                title={`${fmt(row.strike, strikeSteps)} · DEX ${fmtMoney(row.netDex)} · GEX ${fmtGexCompact(row.netGex)} · OI ${fmt(row.oi, 0)}`}
              >
                {level && (
                  <span
                    aria-hidden="true"
                    className="pointer-events-none absolute inset-x-0 top-0 h-px"
                    style={{ background: `rgba(${level.rgb}, .42)` }}
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
                      isSpot ? "font-semibold text-tx" : "text-tx2"
                    }`}
                  >
                    {fmt(row.strike, strikeSteps)}
                  </span>
                )}
                <Bar value={row.netDex} max={max.dex} />
                <Bar value={row.netGex} max={max.gex} />
                <Bar value={row.oi} max={max.oi} neutral />
                <span
                  className={`num pl-2 text-left text-[11px] tabular-nums ${
                    level ? "text-tx/70" : "text-tx2/70"
                  }`}
                >
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
