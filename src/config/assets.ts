/**
 * Registre des actifs suivis par GEX Terminal.
 *
 * Règle : aucune donnée n'est codée en dur ailleurs que dans les providers.
 * Chaque actif déclare ses sources (options + prix), son multiplicateur de
 * contrat, la latence nominale annoncée et, le cas échéant, un proxy.
 *
 * Latences (delayMs) :
 *  - 0        : temps réel (Deribit REST/WS)
 *  - 900_000  : différé 15 min (CBOE delayed quotes, Yahoo)
 *  - 604_800_000 : hebdomadaire (FINRA ATS)
 */

export type AssetClass = "crypto" | "index" | "etf" | "future";
export type ChainSource = "deribit" | "cboe" | "proxy";
export type PriceSourceName = "deribit" | "yahoo" | "binance" | "bybit";

export interface ProxyConfig {
  /** Actif dont on dérive les niveaux (id du registre). */
  underlyingId: string;
  /** Pas de cotation (tick) du contrat, pour l'affichage arrondi. */
  tick: number;
}

export interface AssetConfig {
  /** Identifiant technique utilisé dans les URLs et les snapshots. */
  id: string;
  /** Symbole affiché (ex. "BTC", "NQ"). */
  symbol: string;
  /** Libellé long en français. */
  label: string;
  assetClass: AssetClass;
  /** Source de la chaîne d'options. */
  chainSource: ChainSource;
  /** Symbole attendu par le provider d'options (deribit: BTC ; cboe: _SPX). */
  chainSymbol: string;
  /** Symbole prix principal (provider natif si chainSource=deribit, sinon Yahoo). */
  priceSymbol: string;
  /** Multiplicateur de contrat pour le calcul du GEX (100 CBOE, 1 Deribit). */
  multiplier: number;
  /** Latence nominale annoncée à l'utilisateur. */
  delayMs: number;
  /** Devise d'affichage. */
  currency: "USD";
  /** Actif mis en avant sur l'accueil. */
  primary: boolean;
  /** Nombre de décimales pour l'affichage du prix. */
  priceDecimals: number;
  /** Proxy : les niveaux proviennent d'un autre actif, mis à l'échelle. */
  proxy?: ProxyConfig;
}

export const ASSETS: readonly AssetConfig[] = [
  {
    id: "BTC",
    symbol: "BTC",
    label: "Bitcoin",
    assetClass: "crypto",
    chainSource: "deribit",
    chainSymbol: "BTC",
    priceSymbol: "BTC",
    multiplier: 1,
    delayMs: 0,
    currency: "USD",
    primary: true,
    priceDecimals: 2,
  },
  {
    id: "ETH",
    symbol: "ETH",
    label: "Ethereum",
    assetClass: "crypto",
    chainSource: "deribit",
    chainSymbol: "ETH",
    priceSymbol: "ETH",
    multiplier: 1,
    delayMs: 0,
    currency: "USD",
    primary: true,
    priceDecimals: 2,
  },
  {
    id: "SPX",
    symbol: "SPX",
    label: "S&P 500",
    assetClass: "index",
    chainSource: "cboe",
    chainSymbol: "_SPX",
    priceSymbol: "^GSPC",
    multiplier: 100,
    delayMs: 900_000,
    currency: "USD",
    primary: true,
    priceDecimals: 2,
  },
  {
    id: "NDX",
    symbol: "NDX",
    label: "Nasdaq 100",
    assetClass: "index",
    chainSource: "cboe",
    chainSymbol: "_NDX",
    priceSymbol: "^NDX",
    multiplier: 100,
    delayMs: 900_000,
    currency: "USD",
    primary: false,
    priceDecimals: 2,
  },
  {
    id: "SPY",
    symbol: "SPY",
    label: "SPDR S&P 500 ETF",
    assetClass: "etf",
    chainSource: "cboe",
    chainSymbol: "SPY",
    priceSymbol: "SPY",
    multiplier: 100,
    delayMs: 900_000,
    currency: "USD",
    primary: false,
    priceDecimals: 2,
  },
  {
    id: "QQQ",
    symbol: "QQQ",
    label: "Invesco QQQ Trust",
    assetClass: "etf",
    chainSource: "cboe",
    chainSymbol: "QQQ",
    priceSymbol: "QQQ",
    multiplier: 100,
    delayMs: 900_000,
    currency: "USD",
    primary: false,
    priceDecimals: 2,
  },
  {
    id: "GLD",
    symbol: "GLD",
    label: "SPDR Gold Shares",
    assetClass: "etf",
    chainSource: "cboe",
    chainSymbol: "GLD",
    priceSymbol: "GLD",
    multiplier: 100,
    delayMs: 900_000,
    currency: "USD",
    primary: false,
    priceDecimals: 2,
  },
  {
    id: "NQ",
    symbol: "NQ",
    label: "Nasdaq 100 E-mini (proxy NDX)",
    assetClass: "future",
    chainSource: "proxy",
    chainSymbol: "NDX",
    priceSymbol: "NQ=F",
    multiplier: 20,
    delayMs: 900_000,
    currency: "USD",
    primary: true,
    priceDecimals: 2,
    proxy: { underlyingId: "NDX", tick: 0.25 },
  },
  {
    id: "GC",
    symbol: "GC",
    label: "Or E-mini (proxy GLD)",
    assetClass: "future",
    chainSource: "proxy",
    chainSymbol: "GLD",
    priceSymbol: "GC=F",
    multiplier: 100,
    delayMs: 900_000,
    currency: "USD",
    primary: true,
    priceDecimals: 1,
    proxy: { underlyingId: "GLD", tick: 0.1 },
  },
] as const;

export const ASSET_IDS = ASSETS.map((a) => a.id);

/** Filtres d'échéance disponibles dans l'interface. */
export type ExpiryFilter = "ALL" | "0DTE" | "7D" | "35D";

export const EXPIRY_FILTERS: readonly {
  id: ExpiryFilter;
  label: string;
  /** Nombre de jours calendaires max, null = pas de limite. */
  maxDays: number | null;
}[] = [
  { id: "ALL", label: "Toutes", maxDays: null },
  { id: "0DTE", label: "0DTE", maxDays: 0 },
  { id: "7D", label: "≤ 7 j", maxDays: 7 },
  { id: "35D", label: "≤ 35 j", maxDays: 35 },
];

export function getAsset(id: string): AssetConfig | undefined {
  const upper = id.toUpperCase();
  return ASSETS.find((a) => a.id === upper || a.symbol === upper);
}

/** Actifs dont la chaîne d'options est réellement disponible (pas les proxies). */
export function chainAssets(): AssetConfig[] {
  return ASSETS.filter((a) => a.chainSource !== "proxy");
}

/** Toutes les clés d'URL valides pour /graphique/[symbol] et /gamma/[symbol]. */
export function assetParams(): { symbol: string }[] {
  return ASSETS.map((a) => ({ symbol: a.id }));
}

export function symbolLabel(id: string): string {
  return getAsset(id)?.symbol ?? id.toUpperCase();
}

/** Arrondit un niveau au tick du contrat (affichage uniquement). */
export function roundToTick(value: number, tick: number): number {
  if (!tick) return value;
  return Math.round(value / tick) * tick;
}
