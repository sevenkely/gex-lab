/**
 * Cache serveur.
 *
 * Trois niveaux, du plus simple au plus riche :
 *  1. mémoire du process (Map) — suffisant pour un déploiement mono-instance ;
 *  2. cache partagé (Upstash Redis via REST) activé par les variables
 *     UPSTASH_REDIS_REST_URL / UPSTASH_REDIS_REST_TOKEN : il sert de source de
 *     vérité quand la mémoire est vide (instance froide en serverless), ce qui
 *     évite de recharger plusieurs mégaoctets d'options à chaque démarrage ;
 *  3. « stale-while-error » : si le chargeur échoue et qu'une valeur périmée
 *     existe (mémoire ou cache partagé), on la sert en la marquant `stale`
 *     (l'UI affiche « Données en retard » + le badge du dernier cache) au lieu
 *     d'une page d'erreur.
 *
 * Le cache partagé stocke une enveloppe `{ t, ttl, v }` avec un TTL Redis plus
 * long que la fraîcheur applicative : une instance froide peut ainsi encore
 * servir la dernière valeur connue quand la source est en panne.
 */

import { gunzipSync, gzipSync } from "node:zlib";

export interface CacheDriver {
  get(key: string): Promise<string | null>;
  set(key: string, value: string, ttlMs: number): Promise<void>;
}

export interface CachedValue<T> {
  value: T;
  /** true si la valeur servie est périmée (chargeur en échec). */
  stale: boolean;
  /** Âge de la valeur servie (ms). */
  ageMs: number;
  /** true si la valeur vient d'être recalculée. */
  fresh: boolean;
}

/** Enveloppe écrite dans le cache partagé (fraîcheur indépendante du TTL Redis). */
interface SharedEnvelope {
  /** Date d'écriture (epoch ms). */
  t: number;
  /** Durée de fraîcheur applicative (ms). */
  ttl: number;
  /** Valeur sérialisée JSON. */
  v: unknown;
}

interface Entry {
  value: unknown;
  storedAt: number;
  ttlMs: number;
}

const memory = new Map<string, Entry>();

/** Chargements en cours, par clé : évite N récupérations simultanées identiques. */
const inflight = new Map<string, Promise<CachedValue<unknown>>>();

let driver: CacheDriver | null = null;
let driverResolved = false;

/**
 * Branche un driver externe (Redis). Appelé une fois au démarrage si configuré ;
 * `null` désactive explicitement le cache partagé (tests, diagnostic).
 */
export function setCacheDriver(next: CacheDriver | null): void {
  driver = next;
  driverResolved = true;
}

/** Résout le driver une seule fois : `process.env` ne change pas en production. */
function ensureDriver(): CacheDriver | null {
  if (!driverResolved) {
    driverResolved = true;
    driver = upstashDriverFromEnv();
  }
  return driver;
}

/** Driver Upstash si les deux variables sont présentes, sinon `null`. */
export function upstashDriverFromEnv(
  env: NodeJS.ProcessEnv = process.env,
): CacheDriver | null {
  const url = env.UPSTASH_REDIS_REST_URL?.trim();
  const token = env.UPSTASH_REDIS_REST_TOKEN?.trim();
  if (!url || !token) return null;
  return createUpstashDriver({ url, token });
}

/* --------------------------------------------------------- Upstash REST -- */

/** Préfixe de version : une évolution du format n'écrase pas l'ancien. */
const SHARED_KEY_PREFIX = "gexlab:v1:";

/**
 * Plafond d'un enregistrement. Les requêtes REST Upstash sont limitées en
 * taille ; au-delà on n'écrit pas plutôt que d'échouer à chaque appel.
 * Les chaînes compressées réelles tiennent largement en dessous.
 */
const MAX_SHARED_VALUE_BYTES = 900_000;

/** Lectures/écritures bornées : un cache lent ne doit pas retarder un rendu. */
const READ_TIMEOUT_MS = 1_500;
const WRITE_TIMEOUT_MS = 4_000;

/** Marge du TTL Redis au-delà de la fraîcheur applicative (best-effort). */
const STALE_GRACE_FACTOR = 30;
const MIN_DRIVER_TTL_MS = 15 * 60_000;
const MAX_DRIVER_TTL_MS = 24 * 3_600_000;

export function driverTtl(ttlMs: number): number {
  return Math.min(
    Math.max(ttlMs * STALE_GRACE_FACTOR, MIN_DRIVER_TTL_MS),
    MAX_DRIVER_TTL_MS,
  );
}

/**
 * Compresse en `gz:<base64>` : une chaîne SPX complète passe de plusieurs Mo de
 * JSON à quelques centaines de Ko. Les petites valeurs restent en clair pour ne
 * pas payer l'en-tête gzip.
 */
export function encodeShared(json: string): string {
  const compressed = `gz:${gzipSync(Buffer.from(json, "utf8")).toString("base64")}`;
  return compressed.length < json.length ? compressed : json;
}

/** Inverse de `encodeShared` ; renvoie `null` si le payload est illisible. */
export function decodeShared(payload: string): string | null {
  if (!payload.startsWith("gz:")) return payload;
  try {
    return gunzipSync(Buffer.from(payload.slice(3), "base64")).toString("utf8");
  } catch {
    return null;
  }
}

export interface UpstashConfig {
  url: string;
  token: string;
  /** Injectable pour les tests. */
  fetchImpl?: typeof fetch;
}

/**
 * Client Upstash Redis REST minimal (aucune dépendance) : une commande par
 * requête POST, corps JSON `["SET", key, value, "PX", ttl]`.
 * https://upstash.com/docs/redis/features/restapi
 */
export function createUpstashDriver(config: UpstashConfig): CacheDriver {
  const base = config.url.replace(/\/+$/, "");
  const doFetch = config.fetchImpl ?? fetch;

  async function command(args: (string | number)[], timeoutMs: number): Promise<unknown> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const response = await doFetch(base, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${config.token}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify(args),
        signal: controller.signal,
        cache: "no-store",
      });
      if (!response.ok) throw new Error(`Upstash — HTTP ${response.status}`);
      const body = (await response.json()) as { result?: unknown; error?: string };
      if (body?.error) throw new Error(`Upstash — ${body.error}`);
      return body?.result ?? null;
    } finally {
      clearTimeout(timer);
    }
  }

  return {
    async get(key) {
      const result = await command(["GET", SHARED_KEY_PREFIX + key], READ_TIMEOUT_MS);
      return typeof result === "string" ? decodeShared(result) : null;
    },
    async set(key, value, ttlMs) {
      const payload = encodeShared(value);
      if (payload.length > MAX_SHARED_VALUE_BYTES) return;
      await command(
        ["SET", SHARED_KEY_PREFIX + key, payload, "PX", driverTtl(ttlMs)],
        WRITE_TIMEOUT_MS,
      );
    },
  };
}

/* ------------------------------------------------------------- caché() -- */

export function memoryEntries(): { key: string; ageMs: number; ttlMs: number }[] {
  const now = Date.now();
  return [...memory.entries()].map(([key, entry]) => ({
    key,
    ageMs: now - entry.storedAt,
    ttlMs: entry.ttlMs,
  }));
}

export function clearMemoryCache(): void {
  memory.clear();
  inflight.clear();
}

/** Nom du cache partagé actif, pour les diagnostics (`/api/health`). */
export function sharedCacheStatus(): { kind: "upstash" | "memory"; keys: number } {
  return { kind: ensureDriver() ? "upstash" : "memory", keys: memory.size };
}

/**
 * Charge une valeur avec TTL. `staleWhileError` s'applique quand le chargeur
 * échoue : on renvoie la dernière valeur connue, marquée périmée.
 */
export async function cached<T>(
  key: string,
  ttlMs: number,
  loader: () => Promise<T>,
  options: { staleWhileError?: boolean } = {},
): Promise<CachedValue<T>> {
  const warm = freshMemoryEntry(key);
  if (warm) {
    return {
      value: warm.value as T,
      stale: false,
      ageMs: Date.now() - warm.storedAt,
      fresh: false,
    };
  }

  const pending = inflight.get(key);
  if (pending) return (await pending) as CachedValue<T>;

  const task = load(key, ttlMs, loader, options);
  inflight.set(key, task as Promise<CachedValue<unknown>>);
  try {
    return await task;
  } finally {
    if (inflight.get(key) === (task as Promise<CachedValue<unknown>>)) inflight.delete(key);
  }
}

function freshMemoryEntry(key: string): Entry | null {
  const entry = memory.get(key);
  if (!entry) return null;
  return Date.now() - entry.storedAt < entry.ttlMs ? entry : null;
}

async function load<T>(
  key: string,
  ttlMs: number,
  loader: () => Promise<T>,
  options: { staleWhileError?: boolean },
): Promise<CachedValue<T>> {
  const now = Date.now();
  const shared = await readDriver(key);

  // Instance froide : le cache partagé connaît peut-être déjà la réponse.
  if (shared && now - shared.storedAt < shared.ttlMs) {
    memory.set(key, shared);
    return {
      value: shared.value as T,
      stale: false,
      ageMs: now - shared.storedAt,
      fresh: false,
    };
  }

  try {
    const value = await loader();
    const storedAt = Date.now();
    memory.set(key, { value, storedAt, ttlMs });
    await writeDriver(key, value, ttlMs);
    return { value, stale: false, ageMs: 0, fresh: true };
  } catch (error) {
    const fallback = memory.get(key) ?? shared;
    if (fallback && options.staleWhileError !== false) {
      memory.set(key, fallback);
      return {
        value: fallback.value as T,
        stale: true,
        ageMs: Date.now() - fallback.storedAt,
        fresh: false,
      };
    }
    throw error;
  }
}

async function readDriver(key: string): Promise<Entry | null> {
  const active = ensureDriver();
  if (!active) return null;
  try {
    const raw = await active.get(key);
    if (!raw) return null;
    const envelope = JSON.parse(raw) as SharedEnvelope;
    if (!envelope || typeof envelope.t !== "number") return null;
    return { value: envelope.v, storedAt: envelope.t, ttlMs: envelope.ttl };
  } catch {
    return null;
  }
}

async function writeDriver(key: string, value: unknown, ttlMs: number): Promise<void> {
  const active = ensureDriver();
  if (!active) return;
  const envelope: SharedEnvelope = { t: Date.now(), ttl: ttlMs, v: value };
  try {
    // Écriture attendue : en serverless, une promesse flottante peut être
    // abandonnée une fois la réponse envoyée.
    await active.set(key, JSON.stringify(envelope), ttlMs);
  } catch {
    // cache partagé indisponible : la requête reste correcte
  }
}

/** TTL par source (ms) — cf. docs/DATA-SOURCES.md. */
export const TTL = {
  /** Chaînes différées 15 min : on rafraîchit toutes les 60 s. */
  cboeChain: 60_000,
  /** Deribit : OI/IV bougent en continu, 20 s de fraîcheur suffisent. */
  deribitChain: 20_000,
  /** Bougies de prix (Yahoo, Deribit chart) : 30 s. */
  candles: 30_000,
  /** Cotations : 5 s. */
  quote: 5_000,
  /** FINRA : publication hebdomadaire, cache d'une heure. */
  finra: 3_600_000,
  /** Découverte de la dernière semaine FINRA publiée : 6 h. */
  finraWeek: 21_600_000,
} as const;
