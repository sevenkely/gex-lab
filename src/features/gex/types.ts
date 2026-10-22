import type { ExpiryFilter } from "@/config/assets";
import type { Provenance } from "@/server/providers/types";

export type GexLevelKind =
  | "callWall"
  | "putWall"
  | "zeroGamma"
  | "maxGamma"
  | "maxPain";

export interface GexLevel {
  kind: GexLevelKind;
  /**
   * Rang du niveau dans son genre : 1 = niveau principal, 2 = second mur
   * (CW2/PW2 de la référence). Absent = 1.
   */
  rank?: number;
  /** Prix du niveau. */
  price: number;
  /** GEX signé associé (0 pour le zero gamma). */
  gex: number;
  /** Distance au spot en %. */
  distancePct: number;
}

export interface StrikeGex {
  strike: number;
  /** GEX des calls au strike (positif par convention). */
  callGex: number;
  /** GEX des puts au strike (négatif par convention). */
  putGex: number;
  /** callGex + putGex. */
  netGex: number;
  /** Delta exposure signé, en dollars (calls +, puts −). */
  netDex: number;
  oi: number;
  volume: number;
  /** OI des calls au strike (contrats) — sert au max pain. */
  callOi: number;
  /** OI des puts au strike (contrats) — sert au max pain. */
  putOi: number;
}

/** Régime de couverture estimé. */
export type GexRegime = "long" | "short";

/** Niveaux générés par la séance précédente (profil de volume + extrêmes). */
export type SessionLevelKind = "pVAH" | "pPOC" | "pVAL" | "pLO" | "pHI";

export interface SessionLevel {
  kind: SessionLevelKind;
  price: number;
}

/** Bucket du profil de volume de la séance précédente. */
export interface SessionProfileBucket {
  price: number;
  volume: number;
}

export interface ExpectedMove {
  /** Mouvement 1σ journalier en points de l'actif. */
  points: number;
  /** Mouvement 1σ en %. */
  pct: number;
  /** IV ATM annualisée utilisée (fraction). */
  atmIv: number;
}

/** Snapshot GEX complet, calculé côté serveur et mis en cache. */
export interface GexSnapshot {
  assetId: string;
  symbol: string;
  /** Filtre d'échéance appliqué. */
  filter: ExpiryFilter;
  /** Spot utilisé pour le calcul. */
  spot: number;
  prevClose?: number;
  /**
   * Somme des GEX du périmètre, en dollars par +1 % de mouvement du spot
   * (convention : calls positifs, puts négatifs).
   */
  netGex: number;
  /** Somme des DEX du périmètre, en dollars de delta (calls +, puts −). */
  netDex: number;
  /** Gross GEX (somme des |GEX|) — mesure la densité de gamma, pas sa direction. */
  grossGex: number;
  /** Somme des GEX positifs par strike (gamma qui amortit). */
  positiveGex: number;
  /** Somme des GEX négatifs par strike (gamma qui amplifie). */
  negativeGex: number;
  /** Max pain (strike où le paiement total des options est minimal). */
  maxPain: number | null;
  regime: GexRegime;
  zeroGamma: number | null;
  /** Deux échéances frontales de la chaîne (0DTE, 1DTE), en ms epoch. */
  frontExpiries: number[];
  levels: GexLevel[];
  byStrike: StrikeGex[];
  /** Value area / POC / extrêmes de la séance précédente (futures). */
  sessionLevels: SessionLevel[];
  /** Profil de volume de la séance précédente (histogramme prix → volume). */
  sessionProfile: SessionProfileBucket[];
  expectedMove: ExpectedMove | null;
  /** Échéances (ms) incluses dans le calcul. */
  expiries: number[];
  /** Nombre de contrats retenus. */
  contracts: number;
  /** Open interest total du périmètre. */
  totalOi: number;
  /** Provenance de la chaîne d'options. */
  provenance: Provenance;
  /** Provenance du prix (si différente de celle de la chaîne). */
  priceProvenance?: Provenance;
  /** true si les niveaux sont dérivés d'un actif proxy (NQ ← NDX, GC ← GLD). */
  proxy?: {
    underlyingId: string;
    ratio: number;
    tick: number;
    underlyingSpot: number;
  };
}
