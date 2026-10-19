/**
 * Provider FINRA — volumes ATS hebdomadaires (dark pool).
 *
 * Endpoint vérifié le 2026-10-19 :
 *   POST https://api.finra.org/data/group/otcMarket/name/weeklySummary
 *
 * Constats IMPORTANTS (écarts avec le cahier des charges) :
 *  1. le jeu `weeklySummary` répond SANS OAuth (HTTP 200, données réelles) ;
 *     l'authentification client_credentials reste supportée si elle devient
 *     obligatoire : FINRA_CLIENT_ID / FINRA_CLIENT_SECRET (endpoint vérifié :
 *     ews.fip.finra.org/fip/rest/ews/oauth2/access_token) ;
 *  2. le tri serveur exige les clés de partition (weekStartDate + tierIdentifier)
 *     en EQUAL : on récupère donc une fenêtre glissante et on prend le max ;
 *  3. le filtre IN n'est pas accepté → une requête par symbole ;
 *  4. la publication a ~4 semaines de retard (semaine du 2026-09-21 visible le
 *     2026-10-19), ce qui interdit d'en faire un flux de prints.
 *
 * Champ `summaryTypeCode` = ATS_W_SMBL_FIRM : une ligne par ATS et par symbole.
 */

import { z } from "zod";
import { cached } from "../cache";
import { requestJson, requestText, validate } from "../http";
import { ProviderError } from "./types";
import type { DarkPoolRow, DarkPoolSnapshot, ProviderResult } from "./types";

const ENDPOINT = "https://api.finra.org/data/group/otcMarket/name/weeklySummary";
const TOKEN_URL =
  "https://ews.fip.finra.org/fip/rest/ews/oauth2/access_token?grant_type=client_credentials";

const rowSchema = z.object({
  issueSymbolIdentifier: z.string().nullish(),
  weekStartDate: z.string(),
  MPID: z.string().nullish(),
  marketParticipantName: z.string().nullish(),
  totalWeeklyShareQuantity: z.number().nullish(),
  totalWeeklyTradeCount: z.number().nullish(),
  totalNotionalSum: z.number().nullish(),
  tierIdentifier: z.string().nullish(),
  lastUpdateDate: z.string().nullish(),
  initialPublishedDate: z.string().nullish(),
});

const DAY_MS = 86_400_000;

/** Fenêtre de recherche : 10 semaines couvrent largement le retard de publication. */
const LOOKBACK_DAYS = 70;

interface TokenCache {
  token: string;
  expiresAt: number;
}
let tokenCache: TokenCache | null = null;

/** Jeton OAuth optionnel — seulement si les variables FINRA_* sont fournies. */
async function finraToken(): Promise<string | null> {
  const id = process.env.FINRA_CLIENT_ID;
  const secret = process.env.FINRA_CLIENT_SECRET;
  if (!id || !secret) return null;
  if (tokenCache && tokenCache.expiresAt > Date.now()) return tokenCache.token;

  const basic = Buffer.from(`${id}:${secret}`).toString("base64");
  const { text } = await requestText(TOKEN_URL, {
    method: "POST",
    headers: { Authorization: `Basic ${basic}`, "Content-Type": "application/x-www-form-urlencoded" },
    label: "FINRA OAuth",
  });
  const parsed = z
    .object({ access_token: z.string(), expires_in: z.number().nullish() })
    .safeParse(safeJson(text));
  if (!parsed.success) {
    throw new ProviderError("FINRA — jeton OAuth illisible", "auth");
  }
  tokenCache = {
    token: parsed.data.access_token,
    // marge de 5 min pour ne pas présenter un jeton expiré
    expiresAt: Date.now() + Math.max(60, (parsed.data.expires_in ?? 3600) - 300) * 1000,
  };
  return tokenCache.token;
}

function safeJson(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

interface WeekRows {
  weekStart: string;
  rows: DarkPoolRow[];
  publishedAt: number | null;
}

/**
 * Récupère la dernière semaine publiée pour un symbole.
 * Une requête par symbole (le filtre IN n'est pas supporté par l'API).
 */
async function fetchSymbolWeek(symbol: string, now: number): Promise<WeekRows | null> {
  const token = await finraToken();
  const end = new Date(now).toISOString().slice(0, 10);
  const start = new Date(now - LOOKBACK_DAYS * DAY_MS).toISOString().slice(0, 10);

  const { json } = await requestJson(ENDPOINT, {
    method: "POST",
    label: "FINRA ATS",
    json: {
      limit: 5000,
      compareFilters: [
        { compareType: "EQUAL", fieldName: "issueSymbolIdentifier", fieldValue: symbol },
        { compareType: "EQUAL", fieldName: "summaryTypeCode", fieldValue: "ATS_W_SMBL_FIRM" },
      ],
      dateRangeFilters: [{ fieldName: "weekStartDate", startDate: start, endDate: end }],
    },
    // FINRA choisit le format de réponse d'après `Accept` : sans la valeur
    // exacte `application/json`, l'API renvoie du CSV (vérifié).
    headers: { Accept: "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}) },
  });

  const rows = validate(z.array(rowSchema), json, "FINRA weeklySummary");
  if (rows.length === 0) return null;

  const latest = rows.reduce((max, row) => (row.weekStartDate > max ? row.weekStartDate : max), "");
  const latestRows = rows.filter((row) => row.weekStartDate === latest);
  const publishedRaw = latestRows[0]?.initialPublishedDate ?? latestRows[0]?.lastUpdateDate ?? null;
  const publishedAt = publishedRaw ? Date.parse(`${publishedRaw}T00:00:00Z`) : null;

  // Une ligne par ATS : on déduplique sur (MPID) au cas où plusieurs tiers
  // seraient publiés pour le même participant.
  const seen = new Set<string>();
  const out: DarkPoolRow[] = [];
  for (const row of latestRows) {
    const mpid = row.MPID ?? "—";
    if (seen.has(mpid)) continue;
    seen.add(mpid);
    out.push({
      symbol,
      weekStart: latest,
      mpid,
      marketParticipantName: row.marketParticipantName ?? mpid,
      trades: row.totalWeeklyTradeCount ?? 0,
      volume: row.totalWeeklyShareQuantity ?? 0,
      notional: row.totalNotionalSum ?? 0,
    });
  }

  return { weekStart: latest, rows: out, publishedAt };
}

/** Snapshot dark pool pour une liste de symboles. */
export async function fetchFinraDarkPool(
  symbols: readonly string[],
  now = Date.now(),
): Promise<ProviderResult<DarkPoolSnapshot>> {
  const results = await Promise.all(
    symbols.map(async (symbol) => {
      try {
        return await fetchSymbolWeek(symbol, now);
      } catch (error) {
        // Un symbole non couvert ne doit pas faire échouer les autres, mais
        // l'erreur doit rester visible dans les logs serveur.
        console.warn(`[finra] ${symbol} :`, error instanceof Error ? error.message : error);
        return null;
      }
    }),
  );

  const available = results.filter((r): r is WeekRows => r !== null);
  if (available.length === 0) {
    throw new ProviderError("FINRA ATS — aucune semaine publiée", "not_found");
  }

  const weekStart = available.reduce(
    (max, entry) => (entry.weekStart > max ? entry.weekStart : max),
    available[0].weekStart,
  );
  const rows = available.filter((r) => r.weekStart === weekStart).flatMap((r) => r.rows);
  const publishedAt = available.find((r) => r.weekStart === weekStart)?.publishedAt ?? null;
  const weekEnd = Date.parse(`${weekStart}T00:00:00Z`) + 7 * DAY_MS;

  return {
    data: { weekStart, rows, publishedAt: publishedAt ?? undefined },
    provenance: {
      source: "FINRA ATS (hebdomadaire)",
      provider: "finra",
      asOf: weekEnd,
      fetchedAt: Date.now(),
      delayMs: Math.max(0, now - weekEnd),
      derived: false,
      stale: false,
      demo: false,
    },
  };
}

/**
 * Liste des symboles couverts sur la dernière semaine publiée : permet à l'UI
 * de dire qu'un actif (SPX) n'est pas couvert plutôt que d'afficher du vide.
 */
export async function finraCoverage(symbols: readonly string[]): Promise<Record<string, boolean>> {
  const coverage: Record<string, boolean> = {};
  await Promise.all(
    symbols.map(async (symbol) => {
      try {
        const last = await cached(`finra:coverage:${symbol}`, 6 * 3_600_000, async () => {
          const week = await fetchSymbolWeek(symbol, Date.now());
          return week !== null;
        });
        coverage[symbol] = last.value;
      } catch {
        coverage[symbol] = false;
      }
    }),
  );
  return coverage;
}
