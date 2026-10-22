/**
 * Registre serveur : point d'entrée unique pour toutes les données.
 *
 * Les pages et les routes API ne parlent jamais directement à un provider :
 * elles demandent un snapshot typé + sa provenance. Le registre choisit la
 * source selon la configuration (`DATA_MODE`), met en cache, gère les proxies
 * et retombe sur les fixtures quand tout échoue — en le signalant (`demo`).
 *
 * DATA_MODE :
 *   - "auto" (défaut) : source réelle, repli sur fixtures en cas d'échec ;
 *   - "live" : source réelle uniquement, l'erreur remonte ;
 *   - "mock" : fixtures uniquement (développement hors ligne).
 */

import {
  getAsset,
  roundToTick,
  type AssetConfig,
  type ExpiryFilter,
} from "@/config/assets";
import {
  aggregateByStrikeExpiry,
  computeGexCore,
  filterContracts,
  frontExpiries as frontExpiriesOf,
  type StrikeExpiryMatrix,
} from "@/features/gex/compute";
import { computeSession } from "@/features/gex/session-levels";
import type {
  GexSnapshot,
  SessionLevel,
  SessionProfileBucket,
} from "@/features/gex/types";
import { computeRatio } from "@/lib/ratios";
import { cached, TTL } from "./cache";
import {
  mockChainProvider,
  mockDarkPool,
  mockFlow,
  mockPriceProvider,
} from "./providers/mock";
import { cboeChainProvider } from "./providers/cboe";
import { deribitChainProvider, deribitPriceProvider, fetchDeribitFlow } from "./providers/deribit";
import { fetchFinraDarkPool } from "./providers/finra";
import { yahooPriceProvider } from "./providers/yahoo";
import {
  ProviderError,
  type CandleInterval,
  type CandleSeries,
  type ChainProvider,
  type ChainSnapshot,
  type DarkPoolSnapshot,
  type FlowTrade,
  type PriceProvider,
  type PriceQuote,
  type ProviderResult,
  type Provenance,
} from "./providers/types";

/** Providers disponibles, par ordre de préférence. */
export const chainProviders: ChainProvider[] = [
  deribitChainProvider,
  cboeChainProvider,
  mockChainProvider,
];
export const priceProviders: PriceProvider[] = [
  deribitPriceProvider,
  yahooPriceProvider,
  mockPriceProvider,
];

export type DataMode = "live" | "mock" | "auto";

export function dataMode(): DataMode {
  const raw = process.env.DATA_MODE?.toLowerCase();
  if (raw === "live" || raw === "mock") return raw;
  return "auto";
}


function pickChainProvider(asset: AssetConfig, mode: DataMode): ChainProvider {
  if (mode !== "mock") {
    const live = chainProviders.find((p) => p.id !== "mock" && p.supports(asset));
    if (live) return live;
  }
  return mockChainProvider;
}

function pickPriceProvider(asset: AssetConfig, mode: DataMode): PriceProvider {
  if (mode !== "mock") {
    const live = priceProviders.find((p) => p.id !== "mock" && p.supports(asset));
    if (live) return live;
  }
  return mockPriceProvider;
}

function chainTtl(provider: ChainProvider): number {
  if (provider.id === "cboe") return TTL.cboeChain;
  if (provider.id === "deribit") return TTL.deribitChain;
  return 2_000;
}

function mockProvenance(asset: AssetConfig, reason: string): Provenance {
  const now = Date.now();
  return {
    source: `Fixtures de démonstration (${reason})`,
    provider: "mock",
    asOf: now,
    fetchedAt: now,
    delayMs: asset.delayMs,
    derived: asset.proxy !== undefined,
    stale: false,
    demo: true,
  };
}

function staleOf(provenance: Provenance, stale: boolean): Provenance {
  if (!stale) return provenance;
  return {
    ...provenance,
    stale: true,
    source: `${provenance.source} · dernier cache`,
  };
}

/* ------------------------------------------------------------- providers -- */

export async function getChainResult(
  asset: AssetConfig,
): Promise<ProviderResult<ChainSnapshot>> {
  const mode = dataMode();
  const provider = pickChainProvider(asset, mode);
  try {
    const result = await cached(
      `chain:${provider.id}:${asset.id}`,
      chainTtl(provider),
      () => provider.getChain(asset),
      { staleWhileError: true },
    );
    return {
      data: result.value.data,
      provenance: staleOf({ ...result.value.provenance }, result.stale),
    };
  } catch (error) {
    if (mode === "live") throw error;
    const fallback = await mockChainProvider.getChain(asset);
    return {
      data: fallback.data,
      provenance: mockProvenance(asset, `source ${provider.name} indisponible`),
    };
  }
}

export async function getQuoteResult(
  asset: AssetConfig,
): Promise<ProviderResult<PriceQuote>> {
  const mode = dataMode();
  const provider = pickPriceProvider(asset, mode);
  try {
    const result = await cached(
      `quote:${provider.id}:${asset.id}`,
      provider.id === "mock" ? 1_000 : TTL.quote,
      () => provider.getQuote(asset),
      { staleWhileError: true },
    );
    return {
      data: result.value.data,
      provenance: staleOf({ ...result.value.provenance }, result.stale),
    };
  } catch (error) {
    if (mode === "live") throw error;
    const now = Date.now();
    // prix indisponible : on renvoie le spot de la chaîne, marqué comme tel
    const chain = await mockChainProvider.getChain(asset);
    return {
      data: {
        symbol: asset.priceSymbol,
        price: chain.data.spot,
        prevClose: chain.data.prevClose,
        asOf: now,
      },
      provenance: mockProvenance(asset, "prix indisponible"),
    };
  }
}

export async function getCandleSeries(
  asset: AssetConfig,
  interval: CandleInterval,
  range: { from: number; to: number },
): Promise<ProviderResult<CandleSeries>> {
  const mode = dataMode();
  const provider = pickPriceProvider(asset, mode);
  try {
    const result = await cached(
      `candles:${provider.id}:${asset.id}:${interval}:${Math.floor(range.from / 60_000)}`,
      provider.id === "mock" ? 2_000 : TTL.candles,
      () => provider.getCandles(asset, interval, range),
      { staleWhileError: true },
    );
    return {
      data: result.value.data,
      provenance: staleOf({ ...result.value.provenance }, result.stale),
    };
  } catch (error) {
    if (mode === "live") throw error;
    const fallback = await mockPriceProvider.getCandles(asset, interval, range);
    return {
      data: fallback.data,
      provenance: mockProvenance(asset, "bougies indisponibles"),
    };
  }
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/* ------------------------------------------------------- snapshot GEX --- */

export interface SnapshotOptions {
  filter?: ExpiryFilter;
  now?: number;
}

export async function getGexSnapshot(
  assetId: string,
  options: SnapshotOptions = {},
): Promise<GexSnapshot> {
  const asset = getAsset(assetId);
  if (!asset) throw new ProviderError(`Actif inconnu : ${assetId}`, "not_found");
  const filter = options.filter ?? "ALL";

  const result = await cached(
    `gex:${asset.id}:${filter}`,
    asset.assetClass === "crypto" ? TTL.deribitChain : TTL.cboeChain,
    () =>
      asset.proxy
        ? buildProxySnapshot(asset, filter)
        : buildDirectSnapshot(asset, filter),
    { staleWhileError: true },
  );

  const snapshot = { ...result.value };
  if (result.stale) {
    snapshot.provenance = {
      ...snapshot.provenance,
      stale: true,
      source: `${snapshot.provenance.source} · dernier cache`,
    };
  }
  return snapshot;
}

/** Assemble un snapshot à partir d'une chaîne déjà chargée. */
function snapshotFromChain(
  asset: AssetConfig,
  filter: ExpiryFilter,
  chain: ChainSnapshot,
  provenance: Provenance,
): GexSnapshot {
  const now = Date.now();
  const core = computeGexCore(chain.contracts, {
    spot: chain.spot,
    multiplier: asset.multiplier,
    filter,
    now,
  });
  return {
    assetId: asset.id,
    symbol: asset.symbol,
    filter,
    spot: chain.spot,
    prevClose: chain.prevClose,
    netGex: core.netGex,
    netDex: core.netDex,
    frontExpiries: frontExpiriesOf(chain.contracts, now),
    grossGex: core.byStrike.reduce(
      (acc, s) => acc + Math.abs(s.callGex) + Math.abs(s.putGex),
      0,
    ),
    positiveGex: core.split.positive,
    negativeGex: core.split.negative,
    maxPain: core.maxPain,
    regime: core.regime,
    zeroGamma: core.zeroGamma,
    levels: core.levels,
    byStrike: core.byStrike,
    sessionLevels: [],
    sessionProfile: [],
    expectedMove: core.expectedMove,
    expiries: core.expiries,
    contracts: core.contracts,
    totalOi: core.totalOi,
    provenance,
  };
}

/**
 * Niveaux de la séance précédente, calculés depuis les bougies 5 min du future.
 *
 * Mis en cache séparément (5 min) : la séance ne change qu'au fil de l'eau,
 * alors que le snapshot GEX est recalculé toutes les 60 s. En cas d'échec ou de
 * fixtures, on renvoie une liste vide : le graphique reste lisible sans elles.
 */
interface SessionData {
  levels: SessionLevel[];
  profile: SessionProfileBucket[];
}

const EMPTY_SESSION: SessionData = { levels: [], profile: [] };

async function sessionLevelsFor(asset: AssetConfig): Promise<SessionData> {
  if (asset.assetClass !== "future") return EMPTY_SESSION;
  try {
    const result = await cached(
      `session:${asset.id}`,
      5 * 60_000,
      async (): Promise<SessionData> => {
        const to = Date.now();
        const from = to - 8 * 86_400_000;
        const series = await getCandleSeries(asset, "5m", { from, to });
        if (series.provenance.demo) return EMPTY_SESSION;
        return computeSession(series.data.candles, to);
      },
      { staleWhileError: true },
    );
    return result.value;
  } catch {
    return EMPTY_SESSION;
  }
}

async function buildDirectSnapshot(
  asset: AssetConfig,
  filter: ExpiryFilter,
): Promise<GexSnapshot> {
  const [chainResult, session] = await Promise.all([
    getChainResult(asset),
    sessionLevelsFor(asset),
  ]);
  return {
    ...snapshotFromChain(asset, filter, chainResult.data, chainResult.provenance),
    sessionLevels: session.levels,
    sessionProfile: session.profile,
  };
}

/**
 * Snapshot d'un actif proxy (NQ ← NDX, GC ← GLD) :
 *  - la chaîne et le calcul viennent du sous-jacent ;
 *  - les niveaux sont mis à l'échelle par le ratio futures / sous-jacent ;
 *  - le spot affiché est celui du futures, et l'interface signale « Dérivé (proxy) ».
 */
async function buildProxySnapshot(
  asset: AssetConfig,
  filter: ExpiryFilter,
): Promise<GexSnapshot> {
  const proxy = asset.proxy;
  const underlying = proxy ? getAsset(proxy.underlyingId) : undefined;
  if (!proxy || !underlying) {
    throw new ProviderError(`Proxy mal configuré pour ${asset.id}`, "not_supported");
  }

  const [chainResult, futuresQuote, underlyingQuote, session] = await Promise.all([
    getChainResult(underlying),
    getQuoteResult(asset),
    getQuoteResult(underlying),
    sessionLevelsFor(asset),
  ]);

  const ratio = computeRatio({
    futuresPrice: futuresQuote.data.price,
    futuresAsOf: futuresQuote.data.asOf,
    underlyingPrice: underlyingQuote.data.price,
    underlyingAsOf: underlyingQuote.data.asOf,
  });
  const tick = proxy.tick;
  const scale = (value: number) => roundToTick(value * ratio.ratio, tick);

  const now = Date.now();
  const core = computeGexCore(chainResult.data.contracts, {
    spot: chainResult.data.spot,
    multiplier: underlying.multiplier,
    filter,
    now,
  });

  const spot = futuresQuote.data.price;
  const levels = core.levels.map((level) => {
    const price = scale(level.price);
    return { ...level, price, distancePct: (price / spot - 1) * 100 };
  });
  const byStrike = core.byStrike.map((row) => ({
    ...row,
    strike: scale(row.strike),
  }));

  return {
    assetId: asset.id,
    symbol: asset.symbol,
    filter,
    spot,
    prevClose: futuresQuote.data.prevClose,
    netGex: core.netGex,
    netDex: core.netDex,
    grossGex: core.byStrike.reduce(
      (acc, s) => acc + Math.abs(s.callGex) + Math.abs(s.putGex),
      0,
    ),
    positiveGex: core.split.positive,
    negativeGex: core.split.negative,
    maxPain: core.maxPain === null ? null : scale(core.maxPain),
    regime: core.regime,
    zeroGamma: core.zeroGamma === null ? null : scale(core.zeroGamma),
    frontExpiries: frontExpiriesOf(chainResult.data.contracts, now),
    levels,
    byStrike,
    sessionLevels: session.levels,
    sessionProfile: session.profile,
    expectedMove: core.expectedMove
      ? { ...core.expectedMove, points: core.expectedMove.points * ratio.ratio }
      : null,
    expiries: core.expiries,
    contracts: core.contracts,
    totalOi: core.totalOi,
    provenance: { ...chainResult.provenance, derived: true },
    priceProvenance: futuresQuote.provenance,
    proxy: {
      underlyingId: underlying.id,
      ratio: ratio.ratio,
      tick,
      underlyingSpot: chainResult.data.spot,
    },
  };
}

/* ---------------------------------------------- matrice strike × échéance -- */

export interface StrikeExpiryMatrixResult {
  assetId: string;
  symbol: string;
  filter: ExpiryFilter;
  /** Spot affiché (futures pour un proxy). */
  spot: number;
  /** Spot utilisé pour le calcul (sous-jacent pour un proxy). */
  underlyingSpot: number;
  /** Horodatage du calcul (ms epoch) — sert à repérer le 0DTE. */
  generatedAt: number;
  matrix: StrikeExpiryMatrix;
  provenance: Provenance;
  proxy?: GexSnapshot["proxy"];
}

async function buildStrikeExpiryMatrix(
  asset: AssetConfig,
  filter: ExpiryFilter,
): Promise<StrikeExpiryMatrixResult> {
  const now = Date.now();
  const proxy = asset.proxy;
  const underlying = proxy ? getAsset(proxy.underlyingId) : undefined;
  if (proxy && !underlying) {
    throw new ProviderError(`Proxy mal configuré pour ${asset.id}`, "not_supported");
  }

  const chainAsset = underlying ?? asset;
  const chainResult = await getChainResult(chainAsset);
  const selected = filterContracts(chainResult.data.contracts, filter, now);
  const matrix = aggregateByStrikeExpiry(
    selected,
    chainResult.data.spot,
    chainAsset.multiplier,
    now,
  );

  if (!proxy || !underlying) {
    return {
      assetId: asset.id,
      symbol: asset.symbol,
      filter,
      spot: chainResult.data.spot,
      underlyingSpot: chainResult.data.spot,
      generatedAt: now,
      matrix,
      provenance: chainResult.provenance,
    };
  }

  // Proxy : mêmes niveaux que le sous-jacent, mis à l'échelle du ratio.
  const [futuresQuote, underlyingQuote] = await Promise.all([
    getQuoteResult(asset),
    getQuoteResult(underlying),
  ]);
  const ratio = computeRatio({
    futuresPrice: futuresQuote.data.price,
    futuresAsOf: futuresQuote.data.asOf,
    underlyingPrice: underlyingQuote.data.price,
    underlyingAsOf: underlyingQuote.data.asOf,
  });
  const scale = (value: number) => roundToTick(value * ratio.ratio, proxy.tick);
  return {
    assetId: asset.id,
    symbol: asset.symbol,
    filter,
    spot: futuresQuote.data.price,
    underlyingSpot: chainResult.data.spot,
    generatedAt: now,
    matrix: {
      ...matrix,
      rows: matrix.rows.map((row) => ({ ...row, strike: scale(row.strike) })),
    },
    provenance: { ...chainResult.provenance, derived: true },
    proxy: {
      underlyingId: underlying.id,
      ratio: ratio.ratio,
      tick: proxy.tick,
      underlyingSpot: chainResult.data.spot,
    },
  };
}

/** Matrice strike × échéance (heatmap) — mise en cache avec la chaîne. */
export async function getStrikeExpiryMatrix(
  assetId: string,
  options: { filter?: ExpiryFilter } = {},
): Promise<StrikeExpiryMatrixResult> {
  const asset = getAsset(assetId);
  if (!asset) throw new ProviderError(`Actif inconnu : ${assetId}`, "not_found");
  const filter = options.filter ?? "ALL";
  const provider = pickChainProvider(asset, dataMode());
  const result = await cached(
    `matrix:${provider.id}:${asset.id}:${filter}`,
    chainTtl(provider),
    () => buildStrikeExpiryMatrix(asset, filter),
    { staleWhileError: true },
  );
  return { ...result.value, provenance: staleOf(result.value.provenance, result.stale) };
}

/* ------------------------------------------------------------- agrégats -- */

export interface BoardRow {
  assetId: string;
  symbol: string;
  label: string;
  primary: boolean;
  price: number;
  priceDecimals: number;
  changePct: number | null;
  netGex: number;
  regime: "long" | "short";
  zeroGamma: number | null;
  expectedMovePct: number | null;
  spark: number[];
  provenance: Provenance;
  derived: boolean;
  error?: string;
}

/** Tableau de bord de l'accueil : un snapshot léger par actif. */
export async function getBoard(assets: readonly AssetConfig[]): Promise<BoardRow[]> {
  const rows = await Promise.all(
    assets.map(async (asset): Promise<BoardRow> => {
      try {
        const [snapshot, candles] = await Promise.all([
          getGexSnapshot(asset.id),
          getCandleSeries(asset, "15m", {
            from: Date.now() - 20 * 3_600_000,
            to: Date.now(),
          }),
        ]);
        const closes = candles.data.candles.slice(-40).map((c) => c.close);
        const changePct =
          snapshot.prevClose && snapshot.spot
            ? (snapshot.spot / snapshot.prevClose - 1) * 100
            : null;
        return {
          assetId: asset.id,
          symbol: asset.symbol,
          label: asset.label,
          primary: asset.primary,
          price: snapshot.spot,
          priceDecimals: asset.priceDecimals,
          changePct,
          netGex: snapshot.netGex,
          regime: snapshot.regime,
          zeroGamma: snapshot.zeroGamma,
          expectedMovePct: snapshot.expectedMove?.pct ?? null,
          spark: closes,
          provenance: snapshot.provenance,
          derived: snapshot.provenance.derived,
        };
      } catch (error) {
        return {
          assetId: asset.id,
          symbol: asset.symbol,
          label: asset.label,
          primary: asset.primary,
          price: 0,
          priceDecimals: asset.priceDecimals,
          changePct: null,
          netGex: 0,
          regime: "long",
          zeroGamma: null,
          expectedMovePct: null,
          spark: [],
          provenance: mockProvenance(asset, "erreur provider"),
          derived: false,
          error: error instanceof Error ? error.message : "indisponible",
        };
      }
    }),
  );
  return rows;
}

/**
 * Flux d'options. Crypto : trades Deribit réels (REST côté serveur, WS côté
 * navigateur). Indices : aucune source de prints gratuite (CBOE ne publie que
 * des snapshots) — l'onglet indices affiche une activité Δvolume, libellée
 * comme telle.
 * `now` est fourni par la couche données : les composants restent purs et
 * calculent leurs libellés d'échéance à partir de cet instant.
 */
export async function getFlow(
  asset: AssetConfig,
  limit = 60,
): Promise<{ trades: FlowTrade[]; provenance: Provenance; now: number }> {
  const now = Date.now();
  const mode = dataMode();

  if (mode !== "mock" && asset.chainSource === "deribit") {
    try {
      const result = await cached(
        `flow:${asset.id}:${limit}`,
        5_000,
        () => fetchDeribitFlow(asset, limit),
        { staleWhileError: true },
      );
      return {
        trades: result.value.data,
        provenance: staleOf({ ...result.value.provenance }, result.stale),
        now,
      };
    } catch (error) {
      if (mode === "live") throw error;
      console.warn("[flow] Deribit indisponible, repli fixtures :", messageOf(error));
    }
  }

  return {
    trades: mockFlow(asset, limit, now),
    provenance: mockProvenance(asset, "flux simulé"),
    now,
  };
}

/** Dark pool ATS hebdomadaire FINRA. */
export async function getDarkPoolSnapshot(
  symbols: readonly string[],
): Promise<{ snapshot: DarkPoolSnapshot; provenance: Provenance }> {
  const mode = dataMode();
  if (mode !== "mock") {
    try {
      const result = await cached(
        `darkpool:${[...symbols].sort().join(",")}`,
        TTL.finra,
        () => fetchFinraDarkPool(symbols),
        { staleWhileError: true },
      );
      return {
        snapshot: result.value.data,
        provenance: staleOf({ ...result.value.provenance }, result.stale),
      };
    } catch (error) {
      if (mode === "live") throw error;
      console.warn("[darkpool] FINRA indisponible, repli fixtures :", messageOf(error));
    }
  }

  const now = Date.now();
  return {
    snapshot: mockDarkPool(symbols, now),
    provenance: {
      source: "Fixtures de démonstration (FINRA ATS non branché)",
      provider: "mock",
      asOf: now,
      fetchedAt: now,
      delayMs: 7 * 24 * 3_600_000,
      derived: false,
      stale: false,
      demo: true,
    },
  };
}
