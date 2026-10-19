/**
 * Provider CBOE — chaîne d'options différée 15 min (indices et ETF).
 *
 * Endpoint vérifié le 2026-10-19 :
 *   https://cdn-api.cboe.com/api/global/delayed_quotes/options/_SPX.json
 *   (le CDN `cdn.cboe.com` répond 307 vers `cdn-api.cboe.com`)
 *
 * Structure observée : { timestamp: "YYYY-MM-DD HH:MM:SS", data: { symbol,
 * current_price, prev_day_close, iv30, options: [...] } } où chaque option
 * porte un symbole OCC (`SPX261120C00400000`), `iv` en POURCENT, `gamma` par
 * action, `open_interest`, `volume`, `bid`, `ask`, `last_trade_price`.
 *
 * Deux conséquences assumées :
 *  - `gamma` est fourni : on l'utilise tel quel (× 100 via le multiplicateur) ;
 *  - le champ `iv` de la réponse NE correspond PAS aux prix cotés (relevé :
 *    ATM 30 j coté à 18,6 % d'IV alors que le champ vaut 0,147 %). On
 *    recalcule donc l'IV depuis le mid bid/ask, et `iv` est ignoré — écart
 *    documenté dans docs/DATA-SOURCES.md ;
 *  - l'échéance n'est pas dans la réponse : elle est reconstruite à 16:00 heure
 *    de New York (clôture des options US), en tenant compte de l'heure d'été.
 *
 * Volume : SPX ≈ 13 Mo, NDX ≈ 7 Mo. Le serveur met en cache 60 s et ne garde
 * que les contrats à OI > 0 (les autres ne participent pas au calcul).
 */

import { z } from "zod";
import type { AssetConfig } from "@/config/assets";
import { bsImpliedVol } from "@/lib/black-scholes";
import { ProviderError } from "./types";
import type { ChainProvider, ChainSnapshot, OptionContract, ProviderResult } from "./types";
import { requestJson, validate } from "../http";

const CDN = "https://cdn-api.cboe.com/api/global/delayed_quotes/options";

const envelopeSchema = z.object({
  timestamp: z.string(),
  data: z.object({
    symbol: z.string(),
    current_price: z.number(),
    prev_day_close: z.number().nullish(),
    options: z.array(z.unknown()),
  }),
});

const optionSchema = z.object({
  option: z.string(),
  iv: z.number().nullish(),
  open_interest: z.number().nullish(),
  volume: z.number().nullish(),
  gamma: z.number().nullish(),
  bid: z.number().nullish(),
  ask: z.number().nullish(),
  last_trade_price: z.number().nullish(),
});

/** OCC : racine + AAMMJJ + C/P + strike sur 8 chiffres (3 décimales). */
const OCC_RE = /^([A-Z]+)(\d{2})(\d{2})(\d{2})([CP])(\d{8})$/;

export interface ParsedOcc {
  root: string;
  expiry: number;
  type: "call" | "put";
  strike: number;
}

/**
 * Clôture US (16:00 heure de New York) convertie en UTC.
 * 20:00 UTC en été, 21:00 UTC en hiver — calculé, pas supposé.
 */
const NY_HOUR = new Intl.DateTimeFormat("en-GB", {
  timeZone: "America/New_York",
  hour: "2-digit",
  hour12: false,
});

/**
 * 21 000 contrats partagent ~55 dates : construire un Intl.DateTimeFormat par
 * ligne coûtait 2 s sur SPX. Le formateur est donc créé une fois et le résultat
 * mémoïsé par date.
 */
const closeCache = new Map<string, number>();

export function usCloseUtc(year: number, month: number, day: number): number {
  const key = `${year}-${month}-${day}`;
  const cached = closeCache.get(key);
  if (cached !== undefined) return cached;

  const guess = Date.UTC(year, month - 1, day, 20, 0, 0);
  const hour = Number(NY_HOUR.format(new Date(guess)));
  const value = guess - ((hour % 24) - 16) * 3_600_000;

  if (closeCache.size > 512) closeCache.clear();
  closeCache.set(key, value);
  return value;
}

export function parseOcc(symbol: string): ParsedOcc | null {
  const match = OCC_RE.exec(symbol);
  if (!match) return null;
  const [, root, yy, mm, dd, type, strikeRaw] = match;
  const strike = Number(strikeRaw) / 1000;
  if (!(strike > 0)) return null;
  return {
    root,
    type: type === "C" ? "call" : "put",
    strike,
    expiry: usCloseUtc(2000 + Number(yy), Number(mm), Number(dd)),
  };
}

/** "2026-10-19 01:58:18" (UTC) → ms epoch. */
export function parseCboeTimestamp(value: string): number {
  const iso = value.includes("T") ? value : value.replace(" ", "T");
  const ms = Date.parse(`${iso}Z`);
  return Number.isFinite(ms) ? ms : Date.now();
}

/** Marge de tolérance pour les échéances : une séance complète. */
const EXPIRY_GRACE_MS = 86_400_000;

export async function fetchCboeChain(asset: AssetConfig): Promise<ProviderResult<ChainSnapshot>> {
  const url = `${CDN}/${encodeURIComponent(asset.chainSymbol)}.json`;
  const { json } = await requestJson(url, { timeoutMs: 20_000, label: "CBOE" });
  const envelope = validate(envelopeSchema, json, "CBOE delayed quotes");
  const spot = envelope.data.current_price;
  if (!(spot > 0)) {
    throw new ProviderError("CBOE — prix du sous-jacent absent", "parse");
  }

  const now = Date.now();
  const contracts: OptionContract[] = [];
  let rejected = 0;
  let considered = 0;

  for (const raw of envelope.data.options) {
    const prefilter = raw as { open_interest?: unknown };
    if (typeof prefilter.open_interest !== "number" || prefilter.open_interest <= 0) continue;
    considered += 1;

    const parsedRow = optionSchema.safeParse(raw);
    if (!parsedRow.success) {
      rejected += 1;
      continue;
    }
    const row = parsedRow.data;
    const occ = parseOcc(row.option);
    if (!occ) {
      rejected += 1;
      continue;
    }
    if (occ.expiry < now - EXPIRY_GRACE_MS) continue;

    // IV recalculée depuis le mid (le champ `iv` de la source est incohérent
    // avec les prix). Sans cotation exploitable, on laisse undefined : le
    // gamma fourni suffit au calcul du GEX.
    const mid =
      row.bid !== null && row.bid !== undefined && row.ask !== null && row.ask !== undefined && row.ask > 0
        ? (row.bid + row.ask) / 2
        : undefined;
    const tYears = Math.max((occ.expiry - now) / 86_400_000, 1 / 24) / 365;
    const iv =
      mid !== undefined
        ? (bsImpliedVol(mid, spot, occ.strike, tYears, occ.type) ?? undefined)
        : undefined;

    contracts.push({
      symbol: row.option,
      type: occ.type,
      strike: occ.strike,
      expiry: occ.expiry,
      iv,
      oi: row.open_interest ?? 0,
      volume: row.volume ?? 0,
      gamma: row.gamma ?? undefined,
      bid: row.bid ?? undefined,
      ask: row.ask ?? undefined,
      last: row.last_trade_price ?? undefined,
    });
  }

  // Garde-fou de schéma : si plus de 20 % des lignes retenues sont illisibles,
  // la source a changé et il faut le voir dans les logs, pas dans le calcul.
  if (considered > 20 && rejected / considered > 0.2) {
    throw new ProviderError(
      `CBOE — ${rejected}/${considered} lignes illisibles (schéma modifié ?)`,
      "parse",
    );
  }
  if (contracts.length === 0) {
    throw new ProviderError("CBOE — aucun contrat à open interest", "not_found");
  }

  return {
    data: {
      assetId: asset.id,
      spot,
      prevClose: envelope.data.prev_day_close ?? undefined,
      contracts,
      nativeSymbol: envelope.data.symbol,
    },
    provenance: {
      source: "CBOE (différé 15 min)",
      provider: "cboe",
      asOf: parseCboeTimestamp(envelope.timestamp),
      fetchedAt: Date.now(),
      delayMs: 900_000,
      derived: false,
      stale: false,
      demo: false,
    },
  } satisfies ProviderResult<ChainSnapshot>;
}

export const cboeChainProvider: ChainProvider = {
  id: "cboe",
  name: "CBOE (différé)",
  delayMs: 900_000,
  supports: (asset) => asset.chainSource === "cboe",
  getChain: fetchCboeChain,
};
