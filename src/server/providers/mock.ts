/**
 * Providers de démonstration (fixtures déterministes).
 *
 * Ils alimentent la maquette et servent de repli lorsque la source réelle est
 * indisponible. Toute donnée issue de ce fichier porte `demo: true` et l'UI
 * l'affiche explicitement : jamais de données fictives présentées comme réelles.
 *
 * Les chaînes sont générées de façon déterministe (PRNG mulberry32 semé par
 * actif) : même entrée ⇒ même sortie, ce qui rend les tests reproductibles.
 */

import type { AssetConfig } from "@/config/assets";
import { bsDelta, bsGamma } from "@/lib/black-scholes";
import { timeToExpiryYears } from "@/lib/time";
import type {
  Candle,
  CandleInterval,
  CandleSeries,
  ChainProvider,
  ChainSnapshot,
  DarkPoolRow,
  DarkPoolSnapshot,
  FlowTrade,
  OptionContract,
  PriceProvider,
  PriceQuote,
  ProviderResult,
  Provenance,
} from "./types";

/* ------------------------------------------------------------------ PRNG -- */

function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function hashSeed(text: string): number {
  let h = 2166136261;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

function gauss(rng: () => number): number {
  let u = 0;
  for (let i = 0; i < 3; i++) u += rng();
  return (u - 1.5) * 2;
}

/* ------------------------------------------------------- prix de référence */

/** Prix de référence par actif (utilisé uniquement par les fixtures). */
const REFERENCE: Record<string, { spot: number; vol: number; iv: number; skew: number }> =
  {
    ES: { spot: 7704.25, vol: 0.004, iv: 0.154, skew: 0.055 },
    BTC: { spot: 82351, vol: 0.0125, iv: 0.52, skew: 0.09 },
    ETH: { spot: 3042, vol: 0.016, iv: 0.61, skew: 0.1 },
    SPX: { spot: 7659.44, vol: 0.004, iv: 0.156, skew: 0.055 },
    NDX: { spot: 27890.2, vol: 0.005, iv: 0.186, skew: 0.06 },
    SPY: { spot: 763.11, vol: 0.004, iv: 0.152, skew: 0.055 },
    QQQ: { spot: 682.44, vol: 0.005, iv: 0.183, skew: 0.06 },
    GLD: { spot: 421.87, vol: 0.006, iv: 0.143, skew: 0.04 },
    NQ: { spot: 29905.5, vol: 0.005, iv: 0.186, skew: 0.06 },
    GC: { spot: 4294.6, vol: 0.006, iv: 0.143, skew: 0.04 },
  };

const DAY = 86_400_000;

/** Pas de strike réaliste par actif. */
function strikeStep(spot: number): number {
  if (spot > 20_000) return 250;
  if (spot > 8_000) return 25;
  if (spot > 1_000) return 25;
  if (spot > 300) return 5;
  if (spot > 100) return 2.5;
  if (spot > 20) return 1;
  return 25;
}

/** Échéances : 0DTE si crypto (24/7), vendredis + mensuelles sinon. */
function mockExpiries(asset: AssetConfig, now: number): number[] {
  const out: number[] = [];
  const dayMs = DAY;
  if (asset.assetClass === "crypto") {
    // Deribit liste des échéances quotidiennes à 08:00 UTC : le « 0DTE » est
    // donc l'échéance du jour à 08:00 UTC si elle n'est pas déjà passée.
    const today0800 = Math.floor(now / dayMs) * dayMs + 8 * 3_600_000;
    const first = today0800 > now + 3_600_000 ? today0800 : today0800 + dayMs;
    out.push(first);
    for (const d of [1, 2, 3, 7, 14, 21, 28, 35, 60, 90]) out.push(first + d * dayMs);
    return out;
  }
  const d = new Date(now);
  const cursor = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
  // vendredis suivants (trois mois) + 0DTE/vendredi courant
  for (let i = 0; i < 64 && out.length < 12; i++) {
    const day = new Date(cursor.getTime() + i * dayMs);
    if (day.getUTCDay() === 5) {
      out.push(day.getTime() + 20 * 3_600_000); // clôture 16:00 ET ≈ 20:00 UTC
    }
  }
  return out;
}

function spotOf(asset: AssetConfig, now: number): number {
  const ref = REFERENCE[asset.id] ?? { spot: 100, vol: 0.005, iv: 0.2, skew: 0.05 };
  const rng = mulberry32(hashSeed(asset.id));
  const drift = (rng() - 0.5) * 0.02;
  const dayOfYear = Math.floor(now / DAY) % 365;
  return ref.spot * (1 + drift + Math.sin(dayOfYear / 23) * 0.004);
}

/** IV d'une option mock : smile + skew. */
function mockIv(
  ref: { iv: number; skew: number },
  spot: number,
  strike: number,
  days: number,
): number {
  const moneyness = Math.log(strike / spot);
  const smile = 1.1 + 3.2 * moneyness * moneyness;
  const skew = ref.skew * -moneyness * 6;
  const term = 1 + Math.max(0, 0.12 - days / 365) * 1.4; // prime courte échéance
  return Math.max(0.05, ref.iv * smile * term + ref.skew * skew * 20 * 0.01);
}

function mockChain(asset: AssetConfig, now: number): ChainSnapshot {
  const ref = REFERENCE[asset.id] ?? { spot: 100, vol: 0.005, iv: 0.2, skew: 0.05 };
  const spot = spotOf(asset, now);
  const rng = mulberry32(hashSeed(`${asset.id}-chain`));
  const step = strikeStep(spot);
  const contracts: OptionContract[] = [];
  const expiries = mockExpiries(asset, now);
  const isCboe = asset.chainSource === "cboe" || asset.proxy !== undefined;

  for (const expiry of expiries) {
    const days = Math.max(0, Math.round((expiry - now) / DAY));
    const range = Math.max(0.06, Math.min(0.22, 0.06 + days / 365));
    const lo = Math.floor((spot * (1 - range)) / step) * step;
    const hi = Math.ceil((spot * (1 + range)) / step) * step;
    for (let strike = lo; strike <= hi; strike += step) {
      const moneyness = strike / spot - 1;
      const dist = Math.abs(moneyness);
      // OI : cloche large + pics sur les strikes ronds
      const roundBoost = strike % (step * 4) === 0 ? 1.45 : 1;
      const bell = Math.exp(-(dist * dist) / (2 * 0.055 * 0.055));
      const base = 4_000 * bell * roundBoost;
      const callBias = moneyness > 0 ? 1.35 : 0.8; // OI call au-dessus du spot
      const putBias = moneyness < 0 ? 1.5 : 0.7; // OI put sous le spot
      const iv = mockIv(ref, spot, strike, days);
      const callOi = Math.round(base * callBias * (0.65 + rng() * 0.7));
      const putOi = Math.round(base * putBias * (0.65 + rng() * 0.7));
      const build = (type: "call" | "put", oi: number) => {
        const ivSide = iv * (type === "put" ? 1.06 : 0.97);
        const c: OptionContract = {
          symbol: `${asset.chainSymbol}-FIX-${strike}-${type === "call" ? "C" : "P"}-${expiry}`,
          type,
          strike,
          expiry,
          iv: ivSide,
          oi,
          volume: Math.round(oi * (0.05 + rng() * 0.5)),
          bid: Math.max(0, spot * 0.0004 * (1 + rng())),
          ask: Math.max(0, spot * 0.0009 * (1 + rng())),
          last: Math.max(0, spot * 0.0006 * (1 + rng())),
        };
        // Les sources type CBOE fournissent le gamma du contrat ; les sources
        // crypto (Deribit) non — le calcul Black-Scholes prend alors le relais.
        if (isCboe) {
          const T = timeToExpiryYears(expiry, now);
          c.gamma = bsGamma(spot, strike, T, ivSide);
          c.delta = Math.abs(bsDelta(spot, strike, T, ivSide, type));
        }
        contracts.push(c);
      };
      build("call", callOi);
      build("put", putOi);
    }
  }
  return {
    assetId: asset.id,
    spot,
    prevClose: spot * (1 - (rng() - 0.45) * 0.012),
    contracts,
    nativeSymbol: asset.chainSymbol,
  };
}

/* ------------------------------------------------------------- providers -- */

function provenance(asset: AssetConfig, provider: string): Provenance {
  const now = Date.now();
  return {
    source: "Fixtures de démonstration",
    provider,
    asOf: now,
    fetchedAt: now,
    delayMs: asset.delayMs,
    derived: asset.proxy !== undefined,
    stale: false,
    demo: true,
  };
}

export const mockChainProvider: ChainProvider = {
  id: "mock",
  name: "Fixtures de démonstration",
  delayMs: 0,
  supports: () => true,
  async getChain(asset: AssetConfig): Promise<ProviderResult<ChainSnapshot>> {
    return { data: mockChain(asset, Date.now()), provenance: provenance(asset, "mock") };
  },
};

const INTERVAL_MS: Record<CandleInterval, number> = {
  "1m": 60_000,
  "5m": 300_000,
  "15m": 900_000,
  "1H": 3_600_000,
  "1D": DAY,
};

function mockCandles(
  asset: AssetConfig,
  interval: CandleInterval,
  count: number,
  now: number,
): Candle[] {
  const ref = REFERENCE[asset.id] ?? { spot: 100, vol: 0.005, iv: 0.2, skew: 0.05 };
  const rng = mulberry32(hashSeed(`${asset.id}-${interval}`));
  const stepMs = INTERVAL_MS[interval];
  const alignedEnd = Math.floor(now / stepMs) * stepMs;
  const start = alignedEnd - (count - 1) * stepMs;
  const scale = interval === "1D" ? 8 : interval === "1H" ? 3 : 1;
  let price = ref.spot * (1 - (rng() - 0.5) * 0.03);
  const candles: Candle[] = [];
  const anchor = ref.spot;
  for (let i = 0; i < count; i++) {
    const open = price;
    const pull = (anchor - price) * 0.012;
    const shock = gauss(rng) * ref.vol * scale * price * 0.55;
    price = Math.max(0.01, open + pull + shock);
    const close = price;
    const wick = Math.abs(shock) * 0.8 + price * ref.vol * 0.15 * scale;
    candles.push({
      time: Math.floor((start + i * stepMs) / 1000),
      open: round(open, 4),
      high: round(Math.max(open, close) + Math.abs(gauss(rng)) * wick * 0.5, 4),
      low: round(Math.min(open, close) - Math.abs(gauss(rng)) * wick * 0.5, 4),
      close: round(close, 4),
      volume: Math.round((0.4 + rng()) * 1000 * scale),
    });
  }
  return candles;
}

function round(v: number, d: number): number {
  const f = 10 ** d;
  return Math.round(v * f) / f;
}

export const mockPriceProvider: PriceProvider = {
  id: "mock",
  name: "Fixtures de démonstration",
  delayMs: 0,
  supports: () => true,
  async getQuote(asset: AssetConfig): Promise<ProviderResult<PriceQuote>> {
    const now = Date.now();
    const rng = mulberry32(hashSeed(`${asset.id}-quote`) + Math.floor(now / 5000));
    const ref = REFERENCE[asset.id] ?? { spot: 100, vol: 0.005, iv: 0.2, skew: 0.05 };
    const price = ref.spot * (1 + (rng() - 0.5) * 0.004);
    return {
      data: {
        symbol: asset.priceSymbol,
        price,
        prevClose: ref.spot,
        changePct: ((price - ref.spot) / ref.spot) * 100,
        asOf: now,
      },
      provenance: provenance(asset, "mock"),
    };
  },
  async getCandles(
    asset: AssetConfig,
    interval: CandleInterval,
    range: { from: number; to: number },
  ): Promise<ProviderResult<CandleSeries>> {
    const stepMs = INTERVAL_MS[interval];
    const count = Math.min(
      1400,
      Math.max(24, Math.ceil((range.to - range.from) / stepMs)),
    );
    return {
      data: {
        assetId: asset.id,
        interval,
        candles: mockCandles(asset, interval, count, range.to),
      },
      provenance: provenance(asset, "mock"),
    };
  },
};

/* ------------------------------------------------------------------ flux -- */

const OPTION_EXPIRY_CODE = (expiry: number): string => {
  const d = new Date(expiry);
  const months = [
    "JAN",
    "FEB",
    "MAR",
    "APR",
    "MAY",
    "JUN",
    "JUL",
    "AUG",
    "SEP",
    "OCT",
    "NOV",
    "DEC",
  ];
  return `${String(d.getUTCDate()).padStart(2, "0")}${months[d.getUTCMonth()]}${String(
    d.getUTCFullYear() % 100,
  ).padStart(2, "0")}`;
};

/** Derniers trades d'options simulés pour un actif Deribit. */
export function mockFlow(asset: AssetConfig, count = 60, now = Date.now()): FlowTrade[] {
  const rng = mulberry32(hashSeed(`${asset.id}-flow-${Math.floor(now / 30000)}`));
  const spot = spotOf(asset, now);
  const step = strikeStep(spot);
  const trades: FlowTrade[] = [];
  for (let i = 0; i < count; i++) {
    const type: "call" | "put" = rng() < 0.53 ? "call" : "put";
    const moneyness = (rng() - 0.5) * 0.12;
    const strike = Math.round((spot * (1 + moneyness)) / step) * step;
    const expiry = now + Math.ceil(rng() * 40) * DAY + 8 * 3_600_000;
    const amount = round(0.1 + rng() ** 2 * 45, 1);
    const price = round(Math.max(0.0005, spot * 0.002 * (0.2 + rng() ** 2 * 6)), 4);
    const premiumUsd = price * spot * amount;
    trades.push({
      id: `fix-${asset.id}-${i}`,
      ts: now - Math.floor(rng() * 15 * 60_000),
      assetId: asset.id,
      instrument: `${asset.chainSymbol}-${OPTION_EXPIRY_CODE(expiry)}-${strike}-${
        type === "call" ? "C" : "P"
      }`,
      type,
      strike,
      expiry,
      amount,
      price,
      indexPrice: spot,
      premiumUsd,
      side: rng() < 0.58 ? "buy" : rng() < 0.9 ? "sell" : "unknown",
      block: rng() < 0.12,
    });
  }
  return trades.sort((a, b) => b.ts - a.ts);
}

/* ------------------------------------------------------------- dark pool -- */

const ATS = [
  { mpid: "UBSA", name: "UBSA UBS ATS" },
  { mpid: "JPBX", name: "JPBX JPB-X" },
  { mpid: "LATS", name: "LATS Barclays LX" },
  { mpid: "MSPL", name: "MSPL MS Pool" },
  { mpid: "CROS", name: "CROS Cboe CrossX" },
  { mpid: "IEXG", name: "IEXG IEX" },
];

/** Semaine ATS simulée (la publication réelle a plusieurs semaines de retard). */
export function mockDarkPool(
  symbols: readonly string[],
  now = Date.now(),
): DarkPoolSnapshot {
  const weekStartMs = now - 24 * DAY;
  const weekStart = new Date(weekStartMs).toISOString().slice(0, 10);
  const rows: DarkPoolRow[] = [];
  for (const symbol of symbols) {
    const rng = mulberry32(hashSeed(`${symbol}-dp-${weekStart}`));
    const notionalPerShare =
      symbol === "SPY" ? 760 : symbol === "QQQ" ? 680 : symbol === "GLD" ? 420 : 150;
    for (const ats of ATS) {
      const volume = Math.round(
        (0.5e6 + rng() ** 2 * 42e6) * (ats.mpid === "UBSA" ? 1.6 : 1),
      );
      const trades = Math.round(volume / (400 + rng() * 900));
      rows.push({
        symbol,
        weekStart,
        mpid: ats.mpid,
        marketParticipantName: ats.name,
        trades,
        volume,
        notional: volume * notionalPerShare,
      });
    }
  }
  return { weekStart, rows };
}
