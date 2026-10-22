/**
 * Pont ATAS — fonctions pures.
 *
 * L'indicateur C# diffuse des bougies sur un WebSocket local. Ce module ne
 * connaît ni le DOM ni la librairie de graphique : il valide les messages,
 * fusionne un snapshot avec l'historique déjà chargé et agrège les unités de
 * temps. Le hook et le graphique restent responsables de la connexion et du
 * rendu, ce qui rend ces règles testables sans navigateur.
 *
 * Protocole (une ligne JSON par message) :
 *   { "s": "NQ", "t": 1760000000, "o": 1, "h": 2, "l": 0.5, "c": 1.5,
 *     "v": 1200, "p": 60, "x": false }
 * - `t` : ouverture de la bougie, secondes epoch UTC ;
 * - `p` : période de la bougie en secondes (60, 300, 900, 3600, 86400) ;
 * - `x` : true quand la bougie est clôturée ;
 * - `v` : volume de la bougie (optionnel).
 *
 * `p` est facultatif pour rester compatible avec l'ancien indicateur : à
 * défaut, la période est déduite des écarts entre bougies du snapshot.
 */

import { MAX_BARS } from "@/lib/candles";
import type { Candle } from "@/server/providers/types";

/** Bougie brute telle que reçue du pont. */
export interface AtasBar {
  s: string;
  t: number;
  o: number;
  h: number;
  l: number;
  c: number;
  v?: number;
  p?: number;
  x?: boolean;
}

export type AggregationPlan =
  | { kind: "direct" }
  | { kind: "aggregate"; from: number }
  | { kind: "mismatch"; reason: "coarser" | "session" | "ratio" };

const KNOWN_PERIODS: Record<number, string> = {
  60: "1m",
  300: "5m",
  900: "15m",
  3_600: "1H",
  86_400: "1D",
};

function finite(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

/** Valide un message JSON du pont ; `null` si le message est inutilisable. */
export function parseAtasBar(raw: unknown): AtasBar | null {
  if (!raw || typeof raw !== "object") return null;
  const message = raw as Record<string, unknown>;
  const symbol = typeof message.s === "string" ? message.s.trim().toUpperCase() : "";
  const t = message.t;
  const o = message.o;
  const h = message.h;
  const l = message.l;
  const c = message.c;
  if (!symbol || !finite(t) || !finite(o) || !finite(h) || !finite(l) || !finite(c)) {
    return null;
  }
  // Les prix d'un future sont strictement positifs ; une bougie à zéro est
  // une ligne corrompue, pas une variation extrême.
  if (t <= 0 || o <= 0 || c <= 0) return null;

  const high = Math.max(o, h, l, c);
  const low = Math.min(o, h, l, c);
  const volume = finite(message.v) && message.v >= 0 ? message.v : undefined;
  const period = finite(message.p) && message.p > 0 ? message.p : undefined;

  return {
    s: symbol,
    t: Math.floor(t),
    o,
    h: high,
    l: low,
    c,
    ...(volume === undefined ? {} : { v: volume }),
    ...(period === undefined ? {} : { p: period }),
    ...(typeof message.x === "boolean" ? { x: message.x } : {}),
  };
}

/** Convertit une bougie du pont au format interne du graphique. */
export function toCandle(bar: AtasBar): Candle {
  return {
    time: bar.t,
    open: bar.o,
    high: bar.h,
    low: bar.l,
    close: bar.c,
    // Le pont peut ne pas fournir de volume : la bougie reste valide.
    volume: bar.v ?? 0,
  };
}

/** Période la plus probable d'un lot de bougies (mode des écarts positifs). */
export function inferPeriodSeconds(bars: readonly Candle[]): number | null {
  if (bars.length < 2) return null;
  const times = [...new Set(bars.map((bar) => bar.time))].sort((a, b) => a - b);
  const counts = new Map<number, number>();
  for (let index = 1; index < times.length; index += 1) {
    const delta = times[index] - times[index - 1];
    if (delta <= 0) continue;
    counts.set(delta, (counts.get(delta) ?? 0) + 1);
  }
  let best: number | null = null;
  let bestCount = 0;
  for (const [delta, count] of counts) {
    if (count > bestCount || (count === bestCount && best !== null && delta < best)) {
      best = delta;
      bestCount = count;
    }
  }
  return best;
}

/**
 * Décide comment appliquer une bougie du pont au graphique.
 *
 * - même période : direct ;
 * - pont plus fin et période du graphique multiple : agrégation par bucket ;
 * - pont plus grossier : impossible de découper une bougie → avertir ;
 * - 1D : les séances ne sont pas alignées sur minuit UTC, on n'agrège pas.
 */
export function planAggregation(
  bridgePeriod: number | null,
  chartStep: number,
): AggregationPlan {
  // Ancien indicateur sans `p` : on suppose qu'il est réglé sur le graphique.
  if (bridgePeriod === null) return { kind: "direct" };
  if (!(bridgePeriod > 0) || !(chartStep > 0)) {
    return { kind: "mismatch", reason: "ratio" };
  }
  if (bridgePeriod === chartStep) return { kind: "direct" };
  if (bridgePeriod > chartStep) return { kind: "mismatch", reason: "coarser" };
  if (chartStep >= 86_400) return { kind: "mismatch", reason: "session" };
  if (chartStep % bridgePeriod !== 0) return { kind: "mismatch", reason: "ratio" };
  return { kind: "aggregate", from: bridgePeriod };
}

/** Libellé court d'une période (`300` → `5m`). */
export function formatPeriod(seconds: number | null): string {
  if (!seconds || seconds <= 0) return "?";
  if (KNOWN_PERIODS[seconds]) return KNOWN_PERIODS[seconds];
  if (seconds % 86_400 === 0) return `${seconds / 86_400}j`;
  if (seconds % 3_600 === 0) return `${seconds / 3_600}H`;
  if (seconds % 60 === 0) return `${seconds / 60}m`;
  return `${seconds}s`;
}

/**
 * Agrège des bougies `fromSeconds` en bougies `toSeconds`.
 *
 * Les buckets sont alignés sur l'epoch UTC (`floor(t / to)`), comme les
 * bougies intraday de lightweight-charts. `toSeconds` doit être un multiple
 * de `fromSeconds` : `planAggregation` s'en assure.
 */
export function aggregateBars(
  bars: readonly Candle[],
  fromSeconds: number,
  toSeconds: number,
): Candle[] {
  if (
    bars.length === 0 ||
    !(fromSeconds > 0) ||
    !(toSeconds > fromSeconds) ||
    toSeconds % fromSeconds !== 0
  ) {
    return [];
  }

  const buckets = new Map<number, Candle>();
  for (const bar of bars) {
    const start = Math.floor(bar.time / toSeconds) * toSeconds;
    const current = buckets.get(start);
    if (!current) {
      buckets.set(start, { ...bar, time: start });
      continue;
    }
    current.high = Math.max(current.high, bar.high);
    current.low = Math.min(current.low, bar.low);
    current.close = bar.close;
    current.volume += bar.volume;
  }

  return [...buckets.values()].sort((a, b) => a.time - b.time);
}

export interface BridgeMerge {
  candles: readonly Candle[];
  /** Bougies dont le timestamp n'existait pas. */
  added: number;
  /** Bougies existantes dont les valeurs ont changé. */
  updated: number;
  /** Corrections d'une bougie antérieure à la dernière : `setData` requis. */
  olderCorrections: number;
  /** true quand le pont apporte des bougies avant la première connue. */
  prepended: boolean;
}

function sameCandle(a: Candle, b: Candle): boolean {
  return (
    a.open === b.open &&
    a.high === b.high &&
    a.low === b.low &&
    a.close === b.close &&
    a.volume === b.volume
  );
}

/**
 * Fusionne des bougies du pont avec l'historique existant.
 *
 * Le pont gagne sur le fournisseur historique (il est en temps réel) ; un
 * volume absent du pont ne doit pas effacer celui déjà chargé. L'ordre est
 * garanti et le plafond retire les bougies les plus anciennes.
 */
export function mergeBridgeBars(
  current: readonly Candle[],
  incoming: readonly Candle[],
  maxBars: number = MAX_BARS,
): BridgeMerge {
  if (incoming.length === 0) {
    return {
      candles: current,
      added: 0,
      updated: 0,
      olderCorrections: 0,
      prepended: false,
    };
  }

  const previousLast = current[current.length - 1]?.time ?? 0;
  const firstTime = current[0]?.time ?? null;
  const known = new Map(current.map((bar) => [bar.time, bar]));
  const batch = new Map<number, Candle>();
  for (const bar of incoming) batch.set(bar.time, bar);

  let added = 0;
  let updated = 0;
  let olderCorrections = 0;
  let prepended = false;
  let changed = false;

  for (const bar of batch.values()) {
    const existing = known.get(bar.time);
    if (!existing) {
      added += 1;
      changed = true;
      if (firstTime !== null && bar.time < firstTime) prepended = true;
      known.set(bar.time, bar);
      continue;
    }
    const next: Candle = {
      ...bar,
      volume: bar.volume > 0 ? bar.volume : existing.volume,
    };
    if (sameCandle(existing, next)) continue;
    updated += 1;
    changed = true;
    if (bar.time < previousLast) olderCorrections += 1;
    known.set(bar.time, next);
  }

  if (!changed) {
    return {
      candles: current,
      added: 0,
      updated: 0,
      olderCorrections: 0,
      prepended: false,
    };
  }

  let candles = [...known.values()].sort((a, b) => a.time - b.time);
  if (maxBars > 0 && candles.length > maxBars) {
    candles = candles.slice(candles.length - maxBars);
  }

  return { candles, added, updated, olderCorrections, prepended };
}
