/**
 * Proxies (NQ ← NDX, GC ← GLD).
 *
 * Les niveaux d'un contrat à terme sans options liquides sont dérivés de la
 * chaîne du sous-jacent suivi : niveau_derive = strike_proxy × ratio, où
 * ratio = prix_futures / prix_sous_jacent, calculé sur des timestamps alignés.
 *
 * Ce qui est affiché est "Dérivé (proxy)" et le ratio est montré à l'utilisateur.
 */

export interface RatioInput {
  /** Prix du contrat à terme (ex. NQ=F). */
  futuresPrice: number;
  /** Horodatage de ce prix (ms). */
  futuresAsOf: number;
  /** Prix du sous-jacent (ex. ^NDX). */
  underlyingPrice: number;
  /** Horodatage de ce prix (ms). */
  underlyingAsOf: number;
}

export interface RatioResult {
  ratio: number;
  /** Décalage temporel entre les deux cotations (ms). */
  skewMs: number;
  /** true si le décalage dépasse le seuil : le ratio est approximatif. */
  approximate: boolean;
  futuresPrice: number;
  underlyingPrice: number;
}

/** Au-delà de 5 minutes d'écart, le ratio est signalé comme approximatif. */
export const RATIO_SKEW_TOLERANCE_MS = 5 * 60_000;

export function computeRatio(input: RatioInput): RatioResult {
  const { futuresPrice, underlyingPrice } = input;
  if (!(futuresPrice > 0) || !(underlyingPrice > 0)) {
    return {
      ratio: 1,
      skewMs: 0,
      approximate: true,
      futuresPrice,
      underlyingPrice,
    };
  }
  const skewMs = Math.abs(input.futuresAsOf - input.underlyingAsOf);
  return {
    ratio: futuresPrice / underlyingPrice,
    skewMs,
    approximate: skewMs > RATIO_SKEW_TOLERANCE_MS,
    futuresPrice,
    underlyingPrice,
  };
}

/** Applique le ratio à des niveaux et arrondit au tick du contrat. */
export function deriveLevels<T extends { price: number }>(
  levels: T[],
  ratio: number,
  tick: number,
): T[] {
  return levels.map((level) => ({
    ...level,
    price: roundToTick(level.price * ratio, tick),
  }));
}

export function roundToTick(value: number, tick: number): number {
  if (!(tick > 0)) return value;
  return Math.round(value / tick) * tick;
}

/** Tolérance d'affichage : décimales imposées par le tick. */
export function tickDecimals(tick: number): number {
  if (!(tick > 0)) return 2;
  const s = tick.toString();
  const dot = s.indexOf(".");
  return dot === -1 ? 0 : Math.min(4, s.length - dot - 1);
}

/**
 * Convertit un prix de futures en nombre de points de l'actif sous-jacent
 * (utile pour l'axe Y quand on superpose les deux).
 */
export function inverseRatio(value: number, ratio: number): number {
  return ratio > 0 ? value / ratio : value;
}
