/**
 * Lecture des paramètres d'URL. Module neutre (ni "use client" ni "use
 * server") : il est appelé par les pages serveur ET par les onglets clients.
 */

import { EXPIRY_FILTERS, type ExpiryFilter } from "@/config/assets";
import type { CandleInterval } from "@/server/providers/types";

export type RawParams = Record<string, string | string[] | undefined>;

export function firstParam(raw: string | string[] | undefined): string | undefined {
  return Array.isArray(raw) ? raw[0] : raw;
}

export function parseExpiryFilter(raw: string | string[] | undefined): ExpiryFilter {
  const value = (firstParam(raw) ?? "ALL").toUpperCase();
  return EXPIRY_FILTERS.some((filter) => filter.id === value)
    ? (value as ExpiryFilter)
    : "ALL";
}

export const INTERVALS: readonly CandleInterval[] = ["1m", "5m", "15m", "1H", "1D"];

export function parseInterval(raw: string | string[] | undefined): CandleInterval {
  const value = firstParam(raw) as CandleInterval | undefined;
  return value && INTERVALS.includes(value) ? value : "5m";
}
