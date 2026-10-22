/** Types normalisés échangés entre providers, routes API et UI. */

import type { AssetConfig } from "@/config/assets";

export type OptionType = "call" | "put";

/** Contrat d'option normalisé, indépendant de la source. */
export interface OptionContract {
  /** Identifiant natif (OCC pour CBOE, instrument_name pour Deribit). */
  symbol: string;
  type: OptionType;
  strike: number;
  /** Échéance en ms epoch UTC. */
  expiry: number;
  /** Volatilité implicite en fraction (0.42 = 42 %). */
  iv?: number;
  /** Open interest en contrats. */
  oi: number;
  /** Volume du jour en contrats. */
  volume: number;
  /** Gamma par contrat lorsqu'il est fourni par la source (CBOE). */
  gamma?: number;
  /** Delta par action/unité lorsqu'il est fourni (CBOE) ; sinon estimé BS. */
  delta?: number;
  bid?: number;
  ask?: number;
  last?: number;
}

/** Chaîne d'options + spot, telle que renvoyée par un ChainProvider. */
export interface ChainSnapshot {
  assetId: string;
  /** Prix du sous-jacent au moment du snapshot. */
  spot: number;
  /** Prix de clôture de la veille (variation). */
  prevClose?: number;
  contracts: OptionContract[];
  /** Identifiant natif de la chaîne (ex. "^SPX", "BTC"). */
  nativeSymbol: string;
}

/**
 * Métadonnées de provenance attachées à CHAQUE réponse API.
 * Elles sont affichées telles quelles : l'utilisateur doit savoir d'où vient
 * la donnée, depuis quand, et si elle est calculée/dérivée.
 */
export interface Provenance {
  /** Libellé lisible de la source ("Deribit", "CBOE (différé)", "Yahoo Finance"). */
  source: string;
  /** Identifiant technique du provider. */
  provider: string;
  /** Horodatage de la donnée (ms epoch). */
  asOf: number;
  /** Horodatage de la récupération (ms epoch). */
  fetchedAt: number;
  /** Latence annoncée de la source (ms). */
  delayMs: number;
  /** true si la donnée est calculée ou passe par un proxy. */
  derived: boolean;
  /** true si le cache a servi faute de donnée fraîche. */
  stale: boolean;
  /** true si les données proviennent des fixtures de démonstration. */
  demo: boolean;
}

export interface ProviderResult<T> {
  data: T;
  provenance: Provenance;
}

export interface ChainProvider {
  id: "deribit" | "cboe" | "mock";
  name: string;
  delayMs: number;
  supports(asset: AssetConfig): boolean;
  getChain(asset: AssetConfig): Promise<ProviderResult<ChainSnapshot>>;
}

/** Bougie au format attendu par lightweight-charts (temps en secondes UTC). */
export interface Candle {
  time: number;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}

export type CandleInterval = "1m" | "5m" | "15m" | "1H" | "1D";

export interface CandleSeries {
  assetId: string;
  interval: CandleInterval;
  candles: Candle[];
}

export interface PriceQuote {
  symbol: string;
  price: number;
  prevClose?: number;
  changePct?: number;
  /** Horodatage de la dernière cotation connue. */
  asOf: number;
}

export interface PriceProvider {
  id: "deribit" | "yahoo" | "binance" | "bybit" | "mock";
  name: string;
  /** true si ce provider sait servir ce symbole. */
  supports(asset: AssetConfig): boolean;
  delayMs: number;
  getQuote(asset: AssetConfig): Promise<ProviderResult<PriceQuote>>;
  getCandles(
    asset: AssetConfig,
    interval: CandleInterval,
    range: { from: number; to: number },
  ): Promise<ProviderResult<CandleSeries>>;
}

/** Trade d'options normalisé (Deribit temps réel). */
export interface FlowTrade {
  id: string;
  /** ms epoch. */
  ts: number;
  assetId: string;
  /** Instrument natif ("BTC-27NOV26-72000-C"). */
  instrument: string;
  type: OptionType;
  strike: number;
  expiry: number;
  /** Taille en contrats. */
  amount: number;
  /** Prix de l'option dans la devise de quote (BTC/ETH). */
  price: number;
  /** Indice du sous-jacent au moment du trade. */
  indexPrice: number;
  /** Prime en USD = price × indexPrice × amount (1 contrat = 1 unité). */
  premiumUsd: number;
  /** Côté preneur : achat (au ask), vente (au bid) ou inconnu. */
  side: "buy" | "sell" | "unknown";
  /** Trade de bloc (block_trade_id présent). */
  block: boolean;
}

/** Ligne ATS hebdomadaire FINRA pour un symbole. */
export interface DarkPoolRow {
  symbol: string;
  weekStart: string;
  mpid: string;
  marketParticipantName: string;
  /** Nombre de trades de la semaine (ATS). */
  trades: number;
  /** Actions échangées la semaine. */
  volume: number;
  /** Notionnel en USD. */
  notional: number;
}

export interface DarkPoolSnapshot {
  weekStart: string;
  rows: DarkPoolRow[];
  /** Couverture : "ATS_W_SMBL_FIRM" par participant, "ATS_W_VOL_STATS" agrégé. */
  publishedAt?: number;
}

/** Erreur typée des couches réseau. */
export class ProviderError extends Error {
  constructor(
    message: string,
    readonly code: "timeout" | "http" | "parse" | "not_found" | "not_supported" | "auth",
    readonly status?: number,
  ) {
    super(message);
    this.name = "ProviderError";
  }
}
