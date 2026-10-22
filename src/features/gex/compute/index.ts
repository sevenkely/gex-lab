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
import { bsDelta, bsGamma } from "@/lib/black-scholes";
import { daysUntil, nyMidnightUtc, timeToExpiryYears } from "@/lib/time";
import type { OptionContract } from "@/server/providers/types";
import type { ExpectedMove, GexLevel, GexLevelKind, StrikeGex } from "../types";

/** Facteur « par 1 % de mouvement ». */
export const GEX_PCT = 0.01;

/** Fenêtre de recherche des murs et du flip, en % du spot. */
export const WALL_WINDOW_PCT = 0.15;

/** Fenêtre de recherche du max pain, en % du spot. */
export const MAX_PAIN_WINDOW_PCT = 0.15;

/** Fenêtre par défaut de la matrice strike × échéance, en % du spot. */
export const MATRIX_WINDOW_PCT = 0.08;
/** Nombre d'échéances et de strikes conservés dans la matrice. */
export const MATRIX_MAX_EXPIRIES = 6;
export const MATRIX_MAX_STRIKES = 21;

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

/**
 * Échéances frontales d'une chaîne : la première (0DTE) et la deuxième (1DTE).
 *
 * On ne raisonne pas en jours calendaires : après la clôture, ou le vendredi
 * soir, l'échéance du jour n'existe plus alors que la suivante est cotée. Cette
 * définition reste donc exploitable 24 h/24 et pour les échéances quotidiennes
 * de Deribit comme pour les séances CBOE.
 */
export function frontExpiries(
  contracts: readonly OptionContract[],
  now: number,
  count = 2,
): number[] {
  const expiries = [
    ...new Set(
      contracts
        .filter((c) => c.oi > 0 && c.strike > 0 && c.expiry > now)
        .map((c) => c.expiry),
    ),
  ].sort((a, b) => a - b);
  return expiries.slice(0, count);
}

export function filterContracts(
  contracts: readonly OptionContract[],
  filter: ExpiryFilter,
  now: number,
): OptionContract[] {
  if (filter === "0DTE" || filter === "1DTE") {
    const target = frontExpiries(contracts, now, 2)[filter === "0DTE" ? 0 : 1];
    if (target === undefined) return [];
    return contracts.filter((c) => c.oi > 0 && c.strike > 0 && c.expiry === target);
  }

  const maxDays = filter === "7D" ? 7 : filter === "35D" ? 35 : null;
  return contracts.filter((c) => {
    if (!(c.oi > 0)) return false;
    if (!(c.strike > 0)) return false;
    // Comparaison à l'instant présent, pas à minuit : une échéance de 08:00
    // UTC doit disparaître dès 08:00, pas à la fin de la journée de New York.
    if (c.expiry <= now) return false;
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
 * Delta absolu du contrat. CBOE le fournit (par action) ; sinon on l'estime en
 * Black-Scholes depuis l'IV. Le signe dealer est appliqué à l'agrégation
 * (calls +, puts −), donc on ne garde ici que la magnitude.
 */
export function deltaOf(contract: OptionContract, spot: number, now: number): number {
  if (contract.delta !== undefined && Number.isFinite(contract.delta)) {
    return Math.abs(contract.delta);
  }
  const iv = contract.iv && contract.iv > 0 ? contract.iv : FALLBACK_IV;
  const T = timeToExpiryYears(contract.expiry, now);
  return Math.abs(bsDelta(spot, contract.strike, T, iv, contract.type));
}

/**
 * Delta exposure d'un contrat, en dollars de delta (calls +, puts −).
 * DEX = ± Δ × OI × multiplicateur × spot.
 */
export function contractDex(
  contract: OptionContract,
  spot: number,
  multiplier: number,
  now: number,
): number {
  const sign = contract.type === "call" ? 1 : -1;
  return sign * deltaOf(contract, spot, now) * contract.oi * multiplier * spot;
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
    const dex = contractDex(c, spot, multiplier, now);
    const key = c.strike;
    const row = map.get(key) ?? {
      strike: key,
      callGex: 0,
      putGex: 0,
      netGex: 0,
      netDex: 0,
      oi: 0,
      volume: 0,
      callOi: 0,
      putOi: 0,
    };
    if (c.type === "call") {
      row.callGex += gex;
      row.callOi += c.oi;
    } else {
      row.putGex += gex;
      row.putOi += c.oi;
    }
    row.netGex = row.callGex + row.putGex;
    row.netDex += dex;
    row.oi += c.oi;
    row.volume += c.volume;
    map.set(key, row);
  }
  return [...map.values()].sort((a, b) => a.strike - b.strike);
}

export function netGexOf(byStrike: readonly StrikeGex[]): number {
  return byStrike.reduce((acc, s) => acc + s.netGex, 0);
}

export function netDexOf(byStrike: readonly StrikeGex[]): number {
  return byStrike.reduce((acc, s) => acc + s.netDex, 0);
}

export interface GexSplit {
  /** Somme des strikes en GEX positif : la couverture amortit les mouvements. */
  positive: number;
  /** Somme des strikes en GEX négatif : la couverture les amplifie. */
  negative: number;
  /** |positif| / (|positif| + |négatif|), null si tout est nul. */
  positiveShare: number | null;
}

/**
 * Séparation du Net GEX en masse positive (strikes amortisseurs) et négative
 * (strikes amplificateurs). C'est la lecture « support / résistance » du book :
 * un Net GEX proche de zéro peut cacher deux blocs opposés très denses.
 */
export function computeGexSplit(byStrike: readonly StrikeGex[]): GexSplit {
  let positive = 0;
  let negative = 0;
  for (const row of byStrike) {
    if (row.netGex >= 0) positive += row.netGex;
    else negative += row.netGex;
  }
  const total = positive - negative;
  return {
    positive,
    negative,
    positiveShare: total > 0 ? positive / total : null,
  };
}

/**
 * Max pain : strike où la somme des valeurs intrinsèques des options en vie
 * (pondérées par l'OI) est la plus faible. Repère d'attraction classique des
 * échéances à OI dense — ce n'est pas une prévision, seulement un barycentre
 * de paiement.
 */
export function computeMaxPain(
  byStrike: readonly StrikeGex[],
  spot: number,
  windowPct = MAX_PAIN_WINDOW_PCT,
): number | null {
  if (!(spot > 0)) return null;
  const lo = spot * (1 - windowPct);
  const hi = spot * (1 + windowPct);
  const rows = byStrike.filter((row) => row.strike >= lo && row.strike <= hi);
  if (rows.length === 0) return null;

  let best: number | null = null;
  let bestPain = Number.POSITIVE_INFINITY;
  let bestDistance = Number.POSITIVE_INFINITY;
  for (const candidate of rows) {
    let pain = 0;
    for (const row of rows) {
      pain += row.callOi * Math.max(0, candidate.strike - row.strike);
      pain += row.putOi * Math.max(0, row.strike - candidate.strike);
    }
    const distance = Math.abs(candidate.strike - spot);
    // À paiement égal (strikes sans OI), on garde le strike le plus proche du spot.
    if (
      pain < bestPain - 1e-9 ||
      (Math.abs(pain - bestPain) <= 1e-9 && distance < bestDistance)
    ) {
      best = candidate.strike;
      bestPain = pain;
      bestDistance = distance;
    }
  }
  return best;
}

export interface StrikeExpiryMatrix {
  /** Échéances (ms epoch) retenues, triées, les plus proches d'abord. */
  expiries: number[];
  /** Lignes par strike (croissant), `cells` alignées sur `expiries`. */
  rows: { strike: number; cells: number[]; net: number }[];
  /** Net GEX par échéance (colonne de totaux). */
  totals: number[];
  /** Plus grand |GEX| de la matrice (échelle de couleur). */
  peak: number;
  windowPct: number;
}

/**
 * Matrice strike × échéance : le Net GEX de chaque couple, autour du spot.
 * Sert à voir d'un coup d'œil quelle échéance porte la structure (0DTE vs
 * mensuel) au lieu de comparer des onglets.
 */
export function aggregateByStrikeExpiry(
  contracts: readonly OptionContract[],
  spot: number,
  multiplier: number,
  now: number,
  options: {
    windowPct?: number;
    maxExpiries?: number;
    maxStrikes?: number;
  } = {},
): StrikeExpiryMatrix {
  const windowPct = options.windowPct ?? MATRIX_WINDOW_PCT;
  const maxExpiries = options.maxExpiries ?? MATRIX_MAX_EXPIRIES;
  const maxStrikes = options.maxStrikes ?? MATRIX_MAX_STRIKES;
  const lo = spot * (1 - windowPct);
  const hi = spot * (1 + windowPct);

  const usable = contracts.filter(
    (c) => c.oi > 0 && c.strike >= lo && c.strike <= hi && c.expiry >= nyMidnightUtc(now),
  );
  const expiries = [...new Set(usable.map((c) => c.expiry))]
    .sort((a, b) => a - b)
    .slice(0, maxExpiries);
  if (expiries.length === 0) {
    return { expiries: [], rows: [], totals: [], peak: 0, windowPct };
  }
  const expiryIndex = new Map(expiries.map((expiry, index) => [expiry, index]));

  const byStrike = new Map<number, number[]>();
  for (const contract of usable) {
    const index = expiryIndex.get(contract.expiry);
    if (index === undefined) continue;
    const cells = byStrike.get(contract.strike) ?? new Array(expiries.length).fill(0);
    cells[index] += contractGex(contract, spot, multiplier, now);
    byStrike.set(contract.strike, cells);
  }

  const strikes = [...byStrike.keys()].sort((a, b) => a - b);
  // On garde les strikes les plus proches du spot si la fenêtre en contient trop.
  const kept =
    strikes.length > maxStrikes
      ? strikes
          .slice()
          .sort((a, b) => Math.abs(a - spot) - Math.abs(b - spot))
          .slice(0, maxStrikes)
          .sort((a, b) => a - b)
      : strikes;

  const rows = kept.map((strike) => {
    const cells = byStrike.get(strike) ?? [];
    return {
      strike,
      cells: expiries.map((_, index) => cells[index] ?? 0),
      net: cells.reduce((acc, value) => acc + (value ?? 0), 0),
    };
  });
  const totals = expiries.map((_, index) =>
    rows.reduce((acc, row) => acc + row.cells[index], 0),
  );
  const peak = rows.reduce(
    (acc, row) =>
      row.cells.reduce((inner, value) => Math.max(inner, Math.abs(value)), acc),
    0,
  );
  return { expiries, rows, totals, peak, windowPct };
}

export interface WallCandidate {
  strike: number;
  gex: number;
}

export interface Walls {
  /** Murs call, rang 1 d'abord (le plus gros GEX call au-dessus du spot). */
  callWalls: WallCandidate[];
  /** Murs put, rang 1 d'abord (le plus gros |GEX| put sous le spot). */
  putWalls: WallCandidate[];
  /** Raccourcis pour le rang 1. */
  callWall: WallCandidate | null;
  putWall: WallCandidate | null;
  maxGamma: WallCandidate | null;
}

/** Rang maximal publié par côté : CW/CW2, PW/PW2 comme sur la référence. */
export const WALL_RANKS = 2;

/**
 * Bande des murs secondaires, en % du spot. Le rang 1 garde la fenêtre large
 * (±15 %) : c'est le mur que l'on regarde de loin. Les suivants se lisent dans
 * la zone où l'on travaille — sans cette bande, CW2 serait un strike à 12 %
 * qui ne sert à rien sur la séance (même raison que la bande de Gamma Levels).
 */
export const SECONDARY_WALL_BAND_PCT = 0.02;

/**
 * Murs d'options : les `rankCount` plus gros GEX call et |GEX| put de la
 * fenêtre ±`windowPct` autour du spot, avec un filtre de côté (un call wall
 * au-dessus du prix, un put wall en dessous) — un call sous le spot, c'est un
 * niveau déjà franchi, pas un mur.
 */
export function findWalls(
  byStrike: readonly StrikeGex[],
  spot: number,
  windowPct = WALL_WINDOW_PCT,
  rankCount = WALL_RANKS,
): Walls {
  const lo = spot * (1 - windowPct);
  const hi = spot * (1 + windowPct);
  const inWindow = byStrike.filter((s) => s.strike >= lo && s.strike <= hi);
  const calls = inWindow
    .filter((s) => s.callGex > 0)
    .sort((a, b) => b.callGex - a.callGex);
  const puts = inWindow
    .filter((s) => s.putGex < 0)
    .sort((a, b) => Math.abs(b.putGex) - Math.abs(a.putGex));

  // Filtre de côté, avec repli : si aucun strike n'est du bon côté (chaîne
  // entièrement en dedans), on garde le meilleur de la fenêtre plutôt que de
  // publier un niveau absent.
  const callSide = calls.filter((s) => s.strike >= spot);
  const putSide = puts.filter((s) => s.strike <= spot);
  const callWalls = rankWalls(
    callSide.length > 0 ? callSide : calls,
    spot,
    rankCount,
    "call",
  );
  const putWalls = rankWalls(putSide.length > 0 ? putSide : puts, spot, rankCount, "put");

  let maxGamma: Walls["maxGamma"] = null;
  for (const s of inWindow) {
    if (!maxGamma || Math.abs(s.netGex) > Math.abs(maxGamma.gex)) {
      maxGamma = { strike: s.strike, gex: s.netGex };
    }
  }

  return {
    callWalls,
    putWalls,
    callWall: callWalls[0] ?? null,
    putWall: putWalls[0] ?? null,
    maxGamma,
  };
}

/**
 * Rang 1 = meilleur de la liste ; les suivants sont pris dans la bande serrée
 * autour du spot, et à défaut dans l'ordre du classement (jamais de trou : un
 * second mur vaut mieux qu'un rang vide).
 */
function rankWalls(
  pool: readonly StrikeGex[],
  spot: number,
  rankCount: number,
  side: "call" | "put",
): WallCandidate[] {
  if (pool.length === 0) return [];
  const band = spot * SECONDARY_WALL_BAND_PCT;
  const picked: StrikeGex[] = [pool[0]];
  for (const row of pool.slice(1)) {
    if (picked.length >= rankCount) break;
    if (Math.abs(row.strike - spot) <= band) picked.push(row);
  }
  for (const row of pool.slice(1)) {
    if (picked.length >= rankCount) break;
    if (!picked.includes(row)) picked.push(row);
  }
  return picked.map((row) => ({
    strike: row.strike,
    gex: side === "call" ? row.callGex : row.putGex,
  }));
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

  // Constantes par jambe, une seule fois : sur une chaîne de 26 000 contrats
  // (≈ 8 000 jambes après regroupement) la grille fait ~1 M d'évaluations de
  // gamma, et un `Math.log` par jambe et par point y coûtait deux tiers du
  // temps. Le gamma se réécrit
  //   Γ·S²·0,01 = poids · S · exp(−d1²/2),
  //   d1 = (ln S − ln K)/(σ√T) + σ√T/2,
  // avec `poids = OI signé · 0,01 / (√(2π)·σ√T)` : seul ln S reste par point.
  const legsCount = legs.length;
  const logStrike = new Float64Array(legsCount);
  const invVolTime = new Float64Array(legsCount);
  const halfVolTime = new Float64Array(legsCount);
  const weight = new Float64Array(legsCount);
  const SQRT_2PI = Math.sqrt(2 * Math.PI);
  for (let i = 0; i < legsCount; i++) {
    const leg = legs[i];
    const volTime = leg.iv * Math.sqrt(leg.t);
    logStrike[i] = Math.log(leg.strike);
    invVolTime[i] = 1 / volTime;
    halfVolTime[i] = 0.5 * volTime;
    weight[i] = (leg.signedOi / (SQRT_2PI * volTime)) * GEX_PCT;
  }

  const lo = spot * (1 - spanPct);
  const hi = spot * (1 + spanPct);
  const step = (hi - lo) / (gridPoints - 1);

  let prevSpot = lo;
  let prevGex = gridGex(lo);
  let best: number | null = prevGex === 0 ? lo : null;
  let bestDistance = best === null ? Infinity : Math.abs(best - spot);
  for (let i = 1; i < gridPoints; i++) {
    const s = lo + i * step;
    const gex = gridGex(s);
    let crossing: number | null = null;
    if (gex === 0) crossing = s;
    else if ((prevGex < 0 && gex > 0) || (prevGex > 0 && gex < 0)) {
      // interpolation linéaire du passage par zéro
      const ratio = Math.abs(prevGex) / (Math.abs(prevGex) + Math.abs(gex));
      crossing = prevSpot + ratio * (s - prevSpot);
    }
    // Le flip est le zéro le PLUS PROCHE du spot : sur une chaîne à deux
    // changements de signe, le premier croisement depuis le bas désignait la
    // borne du book, pas la frontière de régime.
    if (crossing !== null && Math.abs(crossing - spot) < bestDistance) {
      best = crossing;
      bestDistance = Math.abs(crossing - spot);
    }
    prevSpot = s;
    prevGex = gex;
  }
  return best;

  function gridGex(s: number): number {
    const logSpot = Math.log(s);
    let total = 0;
    for (let i = 0; i < legsCount; i++) {
      const d1 = (logSpot - logStrike[i]) * invVolTime[i] + halfVolTime[i];
      total += weight[i] * Math.exp(-0.5 * d1 * d1);
    }
    return total * s;
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
  netDex: number;
  split: GexSplit;
  maxPain: number | null;
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
  const netDex = netDexOf(byStrike);
  const walls = findWalls(byStrike, spot, options.wallWindowPct ?? WALL_WINDOW_PCT);
  const split = computeGexSplit(byStrike);
  const maxPain = computeMaxPain(byStrike, spot);
  const zeroGamma = computeZeroGamma(selected, spot, multiplier, now);
  const expectedMove = computeExpectedMove(selected, spot, now);

  const levels: GexLevel[] = [];
  const push = (kind: GexLevelKind, price: number, gex: number, rank = 1) => {
    levels.push({ kind, rank, price, gex, distancePct: (price / spot - 1) * 100 });
  };
  if (walls.callWall) push("callWall", walls.callWall.strike, walls.callWall.gex);
  if (walls.putWall) push("putWall", walls.putWall.strike, walls.putWall.gex);
  if (zeroGamma !== null) push("zeroGamma", zeroGamma, 0);
  if (walls.maxGamma) push("maxGamma", walls.maxGamma.strike, walls.maxGamma.gex);
  if (maxPain !== null)
    push("maxPain", maxPain, byStrike.find((s) => s.strike === maxPain)?.netGex ?? 0);
  // Seconds murs publiés en dernier : `levels.find(kind)` reste le rang 1, et
  // les consommateurs qui ne connaissent pas le rang continuent de lire le mur
  // principal (cartes du panneau, narrateur, CSV).
  for (const [index, wall] of walls.callWalls.slice(1).entries()) {
    push("callWall", wall.strike, wall.gex, index + 2);
  }
  for (const [index, wall] of walls.putWalls.slice(1).entries()) {
    push("putWall", wall.strike, wall.gex, index + 2);
  }

  const expiries = [...new Set(selected.map((c) => c.expiry))].sort((a, b) => a - b);

  return {
    byStrike,
    netGex,
    netDex,
    split,
    maxPain,
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
