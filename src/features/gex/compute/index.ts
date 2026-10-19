/**
 * Calcul du gamma exposure (GEX) — TypeScript pur, sans I/O, testé.
 *
 * ── Convention (documentée et assumée) ────────────────────────────────────
 *   GEX_contrat = ± Γ × OI × multiplicateur × S² × 0,01
 *   (calls positifs, puts négatifs ; Γ par unité d'actif, S = spot)
 *
 *   Le facteur S² × 0,01 exprime le « dollar gamma » : la variation du delta
 *   dollar pour un mouvement de +1 % du sous-jacent. Le GEX affiché est donc
 *   en dollars par +1 % de spot (convention SqueezeMetrics).
 *
 *   Hypothèse : les dealers sont vendeurs nets d'options — ils sont longs le
 *   gamma des calls achetés par les clients et courts le gamma des puts
 *   achetés comme couverture. C'est une CONVENTION de marché, pas du
 *   positionnement dealer observé. Toute conclusion doit être lue comme
 *   « si les dealers sont couverts ainsi, alors… ».
 *
 *   Un Net GEX > 0 (régime long gamma) signifie que la couverture dealer
 *   amortit les mouvements ; < 0 (short gamma), elle les amplifie.
 * ──────────────────────────────────────────────────────────────────────────
 */

import type { ExpiryFilter } from "@/config/assets";
import { bsGamma } from "@/lib/black-scholes";
import { daysUntil, nyMidnightUtc, timeToExpiryYears } from "@/lib/time";
import type { OptionContract } from "@/server/providers/types";
import type { ExpectedMove, GexLevel, GexLevelKind, StrikeGex } from "../types";

/** Facteur « par 1 % de mouvement ». */
export const GEX_PCT = 0.01;

/** Fenêtre de recherche des murs et du flip, en % du spot. */
export const WALL_WINDOW_PCT = 0.15;

/** Grille du zero gamma : ±10 % du spot, au moins 81 points. */
export const ZERO_GAMMA_SPAN_PCT = 0.1;
export const ZERO_GAMMA_MIN_POINTS = 81;

export interface ComputeOptions {
  spot: number;
  multiplier: number;
  filter: ExpiryFilter;
  now?: number;
  wallWindowPct?: number;
}

/** IV de repli si la source ne fournit ni gamma ni IV exploitables. */
export const FALLBACK_IV = 0.5;

export function filterContracts(
  contracts: readonly OptionContract[],
  filter: ExpiryFilter,
  now: number,
): OptionContract[] {
  const maxDays =
    filter === "0DTE" ? 0 : filter === "7D" ? 7 : filter === "35D" ? 35 : null;
  const startOfToday = nyMidnightUtc(now);
  return contracts.filter((c) => {
    if (!(c.oi > 0)) return false;
    if (!(c.strike > 0)) return false;
    if (c.expiry < startOfToday) return false; // échéance dépassée
    if (maxDays === null) return true;
    return daysUntil(c.expiry, now) <= maxDays;
  });
}

/** Gamma par unité d'actif du contrat : fourni par la source, sinon BS. */
export function gammaOf(contract: OptionContract, spot: number, now: number): number {
  if (contract.gamma !== undefined && Number.isFinite(contract.gamma)) {
    return contract.gamma;
  }
  const iv = contract.iv && contract.iv > 0 ? contract.iv : FALLBACK_IV;
  const T = timeToExpiryYears(contract.expiry, now);
  return bsGamma(spot, contract.strike, T, iv);
}

/**
 * GEX signé d'un contrat, en dollars par +1 % de mouvement du spot.
 * (peut être négatif : puts)
 */
export function contractGex(
  contract: OptionContract,
  spot: number,
  multiplier: number,
  now: number,
): number {
  const gamma = gammaOf(contract, spot, now);
  const sign = contract.type === "call" ? 1 : -1;
  return sign * gamma * contract.oi * multiplier * spot * spot * GEX_PCT;
}

/** Agrégation par strike (calls / puts / net). */
export function aggregateByStrike(
  contracts: readonly OptionContract[],
  spot: number,
  multiplier: number,
  now: number,
): StrikeGex[] {
  const map = new Map<number, StrikeGex>();
  for (const c of contracts) {
    const gex = contractGex(c, spot, multiplier, now);
    const key = c.strike;
    const row = map.get(key) ?? {
      strike: key,
      callGex: 0,
      putGex: 0,
      netGex: 0,
      oi: 0,
      volume: 0,
    };
    if (c.type === "call") row.callGex += gex;
    else row.putGex += gex;
    row.netGex = row.callGex + row.putGex;
    row.oi += c.oi;
    row.volume += c.volume;
    map.set(key, row);
  }
  return [...map.values()].sort((a, b) => a.strike - b.strike);
}

export function netGexOf(byStrike: readonly StrikeGex[]): number {
  return byStrike.reduce((acc, s) => acc + s.netGex, 0);
}

export interface Walls {
  callWall: { strike: number; gex: number } | null;
  putWall: { strike: number; gex: number } | null;
  maxGamma: { strike: number; gex: number } | null;
}

/**
 * Murs d'options : plus gros GEX call et plus gros |GEX| put dans une fenêtre
 * de ±`windowPct` autour du spot (les strikes lointains à OI résiduel ne
 * doivent pas devenir « murs »).
 */
export function findWalls(
  byStrike: readonly StrikeGex[],
  spot: number,
  windowPct = WALL_WINDOW_PCT,
): Walls {
  const lo = spot * (1 - windowPct);
  const hi = spot * (1 + windowPct);
  const inWindow = byStrike.filter((s) => s.strike >= lo && s.strike <= hi);
  let callWall: Walls["callWall"] = null;
  let putWall: Walls["putWall"] = null;
  let maxGamma: Walls["maxGamma"] = null;
  for (const s of inWindow) {
    if (s.callGex > 0 && (!callWall || s.callGex > callWall.gex)) {
      callWall = { strike: s.strike, gex: s.callGex };
    }
    if (s.putGex < 0 && (!putWall || Math.abs(s.putGex) > Math.abs(putWall.gex))) {
      putWall = { strike: s.strike, gex: s.putGex };
    }
    if (!maxGamma || Math.abs(s.netGex) > Math.abs(maxGamma.gex)) {
      maxGamma = { strike: s.strike, gex: s.netGex };
    }
  }
  return { callWall, putWall, maxGamma };
}

interface GammaLeg {
  strike: number;
  /** Années jusqu'à l'échéance. */
  t: number;
  iv: number;
  /** OI signé (× multiplicateur) : + pour les calls, − pour les puts. */
  signedOi: number;
}

export interface ZeroGammaOptions {
  gridPoints?: number;
  spanPct?: number;
}

/**
 * Net GEX recalculé sur une grille de spots hypothétiques, IV et T figés.
 * Le zero gamma (flip) est l'interpolation linéaire du changement de signe.
 *
 * Les jambes sont regroupées par (strike, échéance, type, IV arrondie à 0,5 %)
 * pour éviter de recalculer Black-Scholes des dizaines de milliers de fois ;
 * l'écart induit est négligeable devant l'incertitude d'un flip de gamma.
 */
export function computeZeroGamma(
  contracts: readonly OptionContract[],
  spot: number,
  multiplier: number,
  now: number,
  options: ZeroGammaOptions = {},
): number | null {
  const gridPoints = Math.max(ZERO_GAMMA_MIN_POINTS, options.gridPoints ?? 121);
  const spanPct = options.spanPct ?? ZERO_GAMMA_SPAN_PCT;

  const buckets = new Map<string, GammaLeg>();
  for (const c of contracts) {
    if (!(c.oi > 0) || !(c.strike > 0)) continue;
    const T = timeToExpiryYears(c.expiry, now);
    if (!(T > 0)) continue;
    const iv = c.iv && c.iv > 0 ? c.iv : FALLBACK_IV;
    const ivKey = Math.round(iv * 200) / 200;
    const key = `${c.strike}|${c.expiry}|${c.type}|${ivKey}`;
    const existing = buckets.get(key);
    const signedOi = (c.type === "call" ? 1 : -1) * c.oi * multiplier;
    if (existing) existing.signedOi += signedOi;
    else buckets.set(key, { strike: c.strike, t: T, iv: ivKey, signedOi });
  }
  const legs = [...buckets.values()].filter((l) => l.signedOi !== 0);
  if (legs.length === 0) return null;

  const lo = spot * (1 - spanPct);
  const hi = spot * (1 + spanPct);
  const step = (hi - lo) / (gridPoints - 1);

  let prevSpot = lo;
  let prevGex = gridGex(lo);
  for (let i = 1; i < gridPoints; i++) {
    const s = lo + i * step;
    const gex = gridGex(s);
    if (prevGex === 0) return prevSpot;
    if ((prevGex < 0 && gex > 0) || (prevGex > 0 && gex < 0)) {
      // interpolation linéaire du passage par zéro
      const ratio = Math.abs(prevGex) / (Math.abs(prevGex) + Math.abs(gex));
      return prevSpot + ratio * (s - prevSpot);
    }
    prevSpot = s;
    prevGex = gex;
    if (gex === 0) return s;
  }
  return null;

  function gridGex(s: number): number {
    let total = 0;
    for (const leg of legs) {
      total += leg.signedOi * bsGamma(s, leg.strike, leg.t, leg.iv) * s * s * GEX_PCT;
    }
    return total;
  }
}

/**
 * Mouvement attendu 1σ sur une journée : spot × IV ATM × √(1/365).
 * IV ATM = moyenne call/put au strike le plus proche du spot, sur l'échéance
 * la plus proche du filtre courant.
 */
export function computeExpectedMove(
  contracts: readonly OptionContract[],
  spot: number,
  now: number,
): ExpectedMove | null {
  if (!(spot > 0) || contracts.length === 0) return null;
  const startOfToday = nyMidnightUtc(now);
  const candidates = contracts.filter(
    (c) => c.expiry >= startOfToday && c.iv && c.iv > 0,
  );
  if (candidates.length === 0) return null;

  const nearestExpiry = Math.min(...candidates.map((c) => c.expiry));
  const slice = candidates.filter((c) => c.expiry === nearestExpiry);

  // strike ATM : on agrège les IV par strike pour lisser les valeurs aberrantes
  let bestStrike = slice[0].strike;
  let bestDist = Infinity;
  const ivByStrike = new Map<number, { sum: number; n: number }>();
  for (const c of slice) {
    const acc = ivByStrike.get(c.strike) ?? { sum: 0, n: 0 };
    acc.sum += c.iv ?? 0;
    acc.n += 1;
    ivByStrike.set(c.strike, acc);
  }
  for (const strike of ivByStrike.keys()) {
    const dist = Math.abs(strike - spot);
    if (dist < bestDist) {
      bestDist = dist;
      bestStrike = strike;
    }
  }
  const acc = ivByStrike.get(bestStrike);
  if (!acc || acc.n === 0) return null;
  const atmIv = acc.sum / acc.n;
  const points = spot * atmIv * Math.sqrt(1 / 365);
  return { points, pct: (points / spot) * 100, atmIv };
}

export interface GexCore {
  byStrike: StrikeGex[];
  netGex: number;
  zeroGamma: number | null;
  regime: "long" | "short";
  levels: GexLevel[];
  expectedMove: ExpectedMove | null;
  expiries: number[];
  contracts: number;
  totalOi: number;
}

/** Cœur du calcul : du contrat normalisé au bloc de niveaux affichable. */
export function computeGexCore(
  contracts: readonly OptionContract[],
  options: ComputeOptions,
): GexCore {
  const now = options.now ?? Date.now();
  const { spot, multiplier } = options;
  const selected = filterContracts(contracts, options.filter, now);
  const byStrike = aggregateByStrike(selected, spot, multiplier, now);
  const netGex = netGexOf(byStrike);
  const walls = findWalls(byStrike, spot, options.wallWindowPct ?? WALL_WINDOW_PCT);
  const zeroGamma = computeZeroGamma(selected, spot, multiplier, now);
  const expectedMove = computeExpectedMove(selected, spot, now);

  const levels: GexLevel[] = [];
  const push = (kind: GexLevelKind, price: number, gex: number) => {
    levels.push({ kind, price, gex, distancePct: (price / spot - 1) * 100 });
  };
  if (walls.callWall) push("callWall", walls.callWall.strike, walls.callWall.gex);
  if (walls.putWall) push("putWall", walls.putWall.strike, walls.putWall.gex);
  if (zeroGamma !== null) push("zeroGamma", zeroGamma, 0);
  if (walls.maxGamma) push("maxGamma", walls.maxGamma.strike, walls.maxGamma.gex);

  const expiries = [...new Set(selected.map((c) => c.expiry))].sort((a, b) => a - b);

  return {
    byStrike,
    netGex,
    zeroGamma,
    regime:
      zeroGamma === null
        ? netGex >= 0
          ? "long"
          : "short"
        : spot >= zeroGamma
          ? "long"
          : "short",
    levels,
    expectedMove,
    expiries,
    contracts: selected.length,
    totalOi: selected.reduce((acc, c) => acc + c.oi, 0),
  };
}
