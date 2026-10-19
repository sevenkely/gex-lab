/** Utilitaires de temps : marchés, échéances d'options, horloge New York. */

export const NY_TZ = "America/New_York";

const DAY_MS = 86_400_000;

/** Heure de New York, format 24 h (horloge du header). */
export function nyClock(date: Date = new Date()): string {
  return date.toLocaleTimeString("fr-FR", {
    timeZone: NY_TZ,
    hour12: false,
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
}

export function nyDateLabel(date: Date = new Date()): string {
  return date.toLocaleDateString("fr-FR", {
    timeZone: NY_TZ,
    weekday: "short",
    day: "2-digit",
    month: "short",
  });
}

/** Heure locale de New York au format HH:MM (flux, tables). */
export function nyTimeShort(ts: number): string {
  return new Date(ts).toLocaleTimeString("fr-FR", {
    timeZone: NY_TZ,
    hour12: false,
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
}

/** Minuit New York du jour contenant `now`, exprimé en UTC (ms). */
export function nyMidnightUtc(now: number = Date.now()): number {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: NY_TZ,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date(now)); // YYYY-MM-DD
  // New York est UTC-4 (EDT) ou UTC-5 (EST) : on cherche l'instant UTC
  // correspondant à minuit local en comparant l'heure locale obtenue.
  const guess = Date.parse(`${parts}T04:00:00Z`);
  const hour = Number(
    new Intl.DateTimeFormat("en-GB", {
      timeZone: NY_TZ,
      hour: "2-digit",
      hour12: false,
    }).format(new Date(guess)),
  );
  return guess - (hour % 24) * 3_600_000;
}

/** Jours calendaires entiers entre deux instants (0 = aujourd'hui). */
export function daysUntil(expiryMs: number, now: number = Date.now()): number {
  const startOfToday = nyMidnightUtc(now);
  const startOfExpiry = nyMidnightUtc(expiryMs);
  return Math.max(0, Math.round((startOfExpiry - startOfToday) / DAY_MS));
}

/** Durée (années) utilisée dans Black-Scholes, avec plancher pour les 0DTE. */
export function timeToExpiryYears(
  expiryMs: number,
  now: number = Date.now(),
  floorDays = 1 / 24,
): number {
  const days = (expiryMs - now) / DAY_MS;
  return Math.max(days, floorDays) / 365;
}

/** Échéance Deribit/OCC "26DEC27" -> timestamp UTC de 08:00 UTC (Deribit) . */
export function parseExpiryCode(code: string): number | null {
  const m = /^(\d{2})([A-Z]{3})(\d{2})$/.exec(code.trim().toUpperCase());
  if (!m) return null;
  const [, dd, mon, yy] = m;
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
  const month = months.indexOf(mon);
  if (month < 0) return null;
  return Date.UTC(2000 + Number(yy), month, Number(dd), 8, 0, 0);
}

export function formatExpiry(expiryMs: number): string {
  return new Date(expiryMs).toLocaleDateString("fr-FR", {
    timeZone: "UTC",
    day: "2-digit",
    month: "short",
    year: "2-digit",
  });
}

export function formatExpiryShort(expiryMs: number): string {
  const days = daysUntil(expiryMs);
  if (days === 0) return "0DTE";
  return `+${days}j`;
}

/** Lundi (UTC) de la semaine contenant `ts`, format YYYY-MM-DD. */
export function weekStart(ts: number): string {
  const d = new Date(ts);
  const day = d.getUTCDay();
  const diff = (day + 6) % 7; // lundi = 0
  const monday = Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate() - diff);
  return new Date(monday).toISOString().slice(0, 10);
}

export function isoDate(ts: number): string {
  return new Date(ts).toISOString().slice(0, 10);
}

/** Fenêtre de la séance NY pour un instant donné (9:30–16:00). */
export function isUsMarketOpen(now: number = Date.now()): boolean {
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: NY_TZ,
    hour: "2-digit",
    minute: "2-digit",
    weekday: "short",
    hour12: false,
  }).formatToParts(new Date(now));
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? "";
  const weekday = get("weekday");
  if (weekday === "Sat" || weekday === "Sun") return false;
  const minutes = Number(get("hour")) * 60 + Number(get("minute"));
  return minutes >= 570 && minutes <= 960;
}

export const SECOND = 1000;
export const MINUTE = 60 * SECOND;
export const DAY = DAY_MS;
