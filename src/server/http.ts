/**
 * Couche réseau partagée par tous les providers.
 *
 * - timeout dur (AbortController) : aucun provider ne peut bloquer un rendu ;
 * - retry avec backoff exponentiel + jitter sur 429/5xx et erreurs réseau ;
 * - User-Agent explicite (certaines sources refusent le UA Node par défaut) ;
 * - erreurs typées `ProviderError` pour que le registre sache s'il doit
 *   basculer sur le cache ou les fixtures.
 *
 * Les endpoints et les schémas ont été vérifiés par requête directe avant
 * implémentation (voir docs/DATA-SOURCES.md).
 */

import type { ZodType } from "zod";
import { ProviderError } from "./providers/types";

const DEFAULT_TIMEOUT_MS = 12_000;
const DEFAULT_RETRIES = 2;
const RETRYABLE_STATUS = new Set([408, 425, 429, 500, 502, 503, 504]);

/** UA navigateur : évite les refus 403 des CDN (CBOE, Yahoo, FINRA). */
export const BROWSER_UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0 Safari/537.36";

export interface RequestOptions {
  method?: "GET" | "POST";
  /** Corps JSON sérialisé automatiquement. */
  json?: unknown;
  headers?: Record<string, string>;
  timeoutMs?: number;
  retries?: number;
  /** Libellé de la source pour les messages d'erreur. */
  label?: string;
}

export interface TimedResponse {
  text: string;
  durationMs: number;
  bytes: number;
  status: number;
}

/** Requête HTTP brute, avec retry. Renvoie le corps en texte. */
export async function requestText(
  url: string,
  options: RequestOptions = {},
): Promise<TimedResponse> {
  const {
    method = "GET",
    json,
    headers = {},
    timeoutMs = DEFAULT_TIMEOUT_MS,
    retries = DEFAULT_RETRIES,
    label = new URL(url).host,
  } = options;

  let lastError: ProviderError | null = null;

  for (let attempt = 0; attempt <= retries; attempt++) {
    if (attempt > 0) {
      // 250 ms, 500 ms, 1 s… + jitter pour éviter les tempêtes de requêtes.
      const wait = 250 * 2 ** (attempt - 1) + Math.random() * 150;
      await sleep(wait);
    }

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    const started = performance.now();

    try {
      const response = await fetch(url, {
        method,
        headers: {
          "User-Agent": BROWSER_UA,
          Accept: "application/json, text/plain, */*",
          "Accept-Language": "fr-FR,fr;q=0.9,en;q=0.8",
          ...(json !== undefined ? { "Content-Type": "application/json" } : {}),
          ...headers,
        },
        body: json !== undefined ? JSON.stringify(json) : undefined,
        signal: controller.signal,
        // Les providers gèrent leur propre cache : pas de cache Next implicite.
        cache: "no-store",
      });

      const text = await response.text();
      const durationMs = performance.now() - started;

      if (!response.ok) {
        const retryable = RETRYABLE_STATUS.has(response.status);
        lastError = new ProviderError(
          `${label} — HTTP ${response.status} ${text.slice(0, 120)}`,
          response.status === 401 || response.status === 403 ? "auth" : "http",
          response.status,
        );
        if (retryable && attempt < retries) continue;
        throw lastError;
      }

      return { text, durationMs, bytes: text.length, status: response.status };
    } catch (error) {
      if (error instanceof ProviderError) {
        if (attempt < retries && isRetryableCode(error)) continue;
        throw error;
      }
      const aborted = controller.signal.aborted;
      lastError = new ProviderError(
        aborted ? `${label} — délai dépassé (${timeoutMs} ms)` : `${label} — ${messageOf(error)}`,
        aborted ? "timeout" : "http",
      );
      if (attempt < retries) continue;
      throw lastError;
    } finally {
      clearTimeout(timer);
    }
  }

  throw lastError ?? new ProviderError(`${label} — échec inconnu`, "http");
}

function isRetryableCode(error: ProviderError): boolean {
  if (error.code === "timeout") return true;
  if (error.status !== undefined) return RETRYABLE_STATUS.has(error.status);
  return error.code === "http";
}

/** Requête HTTP + décodage JSON typé. */
export async function requestJson<T = unknown>(
  url: string,
  options: RequestOptions = {},
): Promise<{ json: T; durationMs: number; bytes: number }> {
  const { text, durationMs, bytes } = await requestText(url, options);
  const label = options.label ?? new URL(url).host;
  if (!text.trim()) {
    throw new ProviderError(`${label} — réponse vide`, "parse");
  }
  try {
    return { json: JSON.parse(text) as T, durationMs, bytes };
  } catch {
    throw new ProviderError(
      `${label} — JSON invalide (${text.slice(0, 80).replace(/\s+/g, " ")})`,
      "parse",
    );
  }
}

/**
 * Validation Zod. En cas d'écart de schéma, l'erreur nomme le chemin fautif :
 * c'est ce message qui doit apparaître dans les logs plutôt qu'une exception
 * silencieuse ou une donnée `undefined` propagée dans le calcul.
 */
export function validate<T>(schema: ZodType<T>, raw: unknown, label: string): T {
  const parsed = schema.safeParse(raw);
  if (parsed.success) return parsed.data;
  const issue = parsed.error.issues[0];
  const path = issue?.path.join(".") || "(racine)";
  throw new ProviderError(
    `${label} — schéma inattendu en ${path} : ${issue?.message ?? "inconnu"}`,
    "parse",
  );
}

export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function messageOf(error: unknown): string {
  if (error instanceof Error) return error.message;
  return String(error);
}
