import type { ExpiryFilter } from "@/config/assets";
import type { Provenance } from "@/server/providers/types";

export type GexLevelKind = "callWall" | "putWall" | "zeroGamma" | "maxGamma";

export interface GexLevel {
  kind: GexLevelKind;
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
  oi: number;
  volume: number;
}

/** Régime de couverture estimé. */
export type GexRegime = "long" | "short";

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
  /** Gross GEX (somme des |GEX|) — mesure la densité de gamma, pas sa direction. */
  grossGex: number;
  regime: GexRegime;
  zeroGamma: number | null;
  levels: GexLevel[];
  byStrike: StrikeGex[];
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
