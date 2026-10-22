/**
 * Niveaux générés par la séance précédente (RTH 9:30–16:00 New York) :
 * value area (pVAH / pVAL), point of control (pPOC) et extrêmes (pLO / pHI).
 *
 * Le profil est construit à partir des bougies 5 min du future, en répartissant
 * le volume de chaque bougie uniformément entre son plus bas et son plus haut.
 * La value area est celle qui contient 70 % du volume de la séance, développée
 * de part et d'autre du POC (méthode classique du market profile).
 *
 * Module pur : aucun I/O, aucune dépendance au provider — testable.
 */

import type { Candle } from "@/server/providers/types";
import { NY_TZ } from "@/lib/time";
import type { SessionLevel, SessionProfileBucket } from "./types";

const RTH_START_MINUTES = 9 * 60 + 30;
const RTH_END_MINUTES = 16 * 60;

const PARTS = new Intl.DateTimeFormat("en-CA", {
  timeZone: NY_TZ,
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
  hour12: false,
  hourCycle: "h23",
});

interface NyStamp {
  date: string;
  minutes: number;
}

/** Date et heure locales de New York pour un timestamp (sans lib externe). */
export function nyStamp(ts: number): NyStamp {
  const parts = PARTS.formatToParts(new Date(ts));
  const get = (type: string) => parts.find((part) => part.type === type)?.value ?? "";
  const hour = Number(get("hour")) % 24;
  return {
    date: `${get("year")}-${get("month")}-${get("day")}`,
    minutes: hour * 60 + Number(get("minute")),
  };
}

/** Pas « rond » (1, 2, 2,5, 5 × puissance de 10) le plus proche du pas brut. */
export function niceStep(raw: number): number {
  if (!(raw > 0) || !Number.isFinite(raw)) return 1;
  const power = 10 ** Math.floor(Math.log10(raw));
  const ratio = raw / power;
  const multiplier = ratio <= 1 ? 1 : ratio <= 2 ? 2 : ratio <= 2.5 ? 2.5 : ratio <= 5 ? 5 : 10;
  return multiplier * power;
}

export type ProfileBucket = SessionProfileBucket;

export interface SessionProfile {
  /** Niveaux prêts à afficher, triés du plus haut au plus bas. */
  levels: SessionLevel[];
  /** Histogramme du profil (prix croissant), pour un éventuel rendu. */
  profile: ProfileBucket[];
  /** Date NY de la séance retenue (YYYY-MM-DD). */
  session: string;
}

/**
 * Dernière séance RTH **terminée** avant `now`.
 *
 * La séance du jour n'est retenue qu'après 16:00 NY : sinon ses niveaux
 * bougeraient en cours de route et ne seraient plus des « niveaux précédents ».
 */
export function previousSession(candles: readonly Candle[], now: number): Candle[] {
  const today = nyStamp(now);
  const todayComplete = today.minutes >= RTH_END_MINUTES;
  const sessions = new Map<string, Candle[]>();

  for (const candle of candles) {
    const stamp = nyStamp(candle.time * 1000);
    if (stamp.minutes < RTH_START_MINUTES || stamp.minutes >= RTH_END_MINUTES) continue;
    if (stamp.date > today.date || (stamp.date === today.date && !todayComplete)) continue;
    const rows = sessions.get(stamp.date) ?? [];
    rows.push(candle);
    sessions.set(stamp.date, rows);
  }

  const dates = [...sessions.keys()].sort();
  const last = dates.at(-1);
  return last ? (sessions.get(last) ?? []) : [];
}

/**
 * Profil de volume + niveaux d'une liste de bougies RTH.
 * `step` est optionnel : il est déduit de l'amplitude si absent.
 */
export function buildSessionProfile(
  candles: readonly Candle[],
  options: { step?: number } = {},
): { levels: SessionLevel[]; profile: ProfileBucket[] } {
  if (candles.length === 0) return { levels: [], profile: [] };

  let low = Number.POSITIVE_INFINITY;
  let high = Number.NEGATIVE_INFINITY;
  for (const candle of candles) {
    low = Math.min(low, candle.low);
    high = Math.max(high, candle.high);
  }
  if (!Number.isFinite(low) || !Number.isFinite(high) || high <= low) {
    return { levels: [], profile: [] };
  }

  const step = options.step && options.step > 0 ? options.step : niceStep((high - low) / 60);
  const buckets = new Map<number, number>();
  let total = 0;

  for (const candle of candles) {
    const from = Math.floor(candle.low / step);
    const to = Math.floor(candle.high / step);
    const count = to - from + 1;
    // Une bougie sans volume (fenêtre pré-marché de Yahoo) pèse quand même
    // dans la forme du profil : sinon la séance peut être entièrement vide.
    const weight = candle.volume > 0 ? candle.volume : 1;
    const share = weight / Math.max(1, count);
    for (let index = from; index <= to; index += 1) {
      buckets.set(index, (buckets.get(index) ?? 0) + share);
      total += share;
    }
  }

  let pocIndex = 0;
  let pocVolume = -1;
  for (const [index, volume] of buckets) {
    if (volume > pocVolume) {
      pocIndex = index;
      pocVolume = volume;
    }
  }
  if (!(total > 0)) return { levels: [], profile: [] };

  const included = new Set<number>([pocIndex]);
  let accumulated = pocVolume;
  let lo = pocIndex;
  let hi = pocIndex;
  const target = total * 0.7;

  while (accumulated < target) {
    const below = buckets.get(lo - 1) ?? 0;
    const above = buckets.get(hi + 1) ?? 0;
    if (below === 0 && above === 0) break;
    if (above >= below) {
      hi += 1;
      accumulated += above;
      included.add(hi);
    } else {
      lo -= 1;
      accumulated += below;
      included.add(lo);
    }
  }

  // Les bords de la value area sont ceux des buckets, ramenés dans les
  // extrêmes de la séance : un bucket peut dépasser la mèche la plus haute.
  const levels: SessionLevel[] = [
    { kind: "pVAH", price: Math.min(high, (hi + 1) * step) },
    { kind: "pPOC", price: (pocIndex + 0.5) * step },
    { kind: "pVAL", price: Math.max(low, lo * step) },
    { kind: "pHI", price: high },
    { kind: "pLO", price: low },
  ];

  const profile = [...buckets.entries()]
    .sort((a, b) => a[0] - b[0])
    .map(([index, volume]) => ({ price: (index + 0.5) * step, volume }));

  return { levels, profile };
}

/** Niveaux de la dernière séance RTH terminée, triés du plus haut au plus bas. */
export function computeSessionLevels(candles: readonly Candle[], now: number): SessionLevel[] {
  return computeSession(candles, now).levels;
}

/** Niveaux + profil de la dernière séance RTH terminée. */
export function computeSession(
  candles: readonly Candle[],
  now: number,
): { levels: SessionLevel[]; profile: ProfileBucket[] } {
  const session = previousSession(candles, now);
  const { levels, profile } = buildSessionProfile(session);
  return { levels: levels.slice().sort((a, b) => b.price - a.price), profile };
}
