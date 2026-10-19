/**
 * Cache serveur.
 *
 * Trois niveaux, du plus simple au plus riche :
 *  1. mémoire du process (Map) — suffisant pour un déploiement mono-instance ;
 *  2. driver interchangeable (Upstash Redis via REST) si les variables
 *     UPSTASH_REDIS_REST_URL / UPSTASH_REDIS_REST_TOKEN sont présentes ;
 *  3. « stale-while-error » : si le chargeur échoue et qu'une valeur périmée
 *     existe, on la sert en la marquant `stale` (l'UI affiche « Données en
 *     retard » + le badge du dernier cache) au lieu d'une page d'erreur.
 */

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

interface Entry {
  value: unknown;
  storedAt: number;
  ttlMs: number;
}

const memory = new Map<string, Entry>();

let driver: CacheDriver | null = null;

/** Branche un driver externe (Redis). Appelé une fois au démarrage si configuré. */
export function setCacheDriver(next: CacheDriver | null): void {
  driver = next;
}

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
  const now = Date.now();
  const entry = memory.get(key) as Entry | undefined;

  if (entry && now - entry.storedAt < entry.ttlMs) {
    return {
      value: entry.value as T,
      stale: false,
      ageMs: now - entry.storedAt,
      fresh: false,
    };
  }

  try {
    const value = await loader();
    memory.set(key, { value, storedAt: Date.now(), ttlMs });
    if (driver) {
      // écriture best-effort : un cache partagé indisponible ne casse rien
      void driver.set(key, JSON.stringify(value), ttlMs).catch(() => {});
    }
    return { value, stale: false, ageMs: 0, fresh: true };
  } catch (error) {
    const staleEntry = entry ?? (await readDriver(key));
    if (staleEntry && options.staleWhileError !== false) {
      memory.set(key, staleEntry);
      return {
        value: staleEntry.value as T,
        stale: true,
        ageMs: Date.now() - staleEntry.storedAt,
        fresh: false,
      };
    }
    throw error;
  }
}

async function readDriver(key: string): Promise<Entry | null> {
  if (!driver) return null;
  try {
    const raw = await driver.get(key);
    if (!raw) return null;
    return { value: JSON.parse(raw) as unknown, storedAt: Date.now(), ttlMs: 0 };
  } catch {
    return null;
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
