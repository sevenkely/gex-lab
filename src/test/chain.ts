/**
 * Fabriques de chaînes d'options synthétiques pour les tests.
 * Aucune dépendance aux providers : on construit des contrats à la main pour
 * pouvoir vérifier les valeurs attendues.
 */

import type { OptionContract } from "@/server/providers/types";

export const DAY = 86_400_000;

/**
 * Instant de référence des tests : 12 mars 2026, 14:00 UTC (10:00 à New York,
 * séance ouverte), pour que les fenêtres d'échéance soient déterministes.
 */
export const NOW = Date.UTC(2026, 2, 12, 14, 0, 0);

export function contract(
  partial: Partial<OptionContract> & Pick<OptionContract, "type" | "strike">,
): OptionContract {
  const { type, strike, ...rest } = partial;
  return {
    symbol: `TEST-${strike}-${type === "call" ? "C" : "P"}`,
    type,
    strike,
    expiry: NOW + 30 * DAY,
    iv: 0.2,
    oi: 1,
    volume: 0,
    ...rest,
  };
}

/** Chaîne symétrique call/put : OI et IV fournis par strike. */
export function symmetricChain(
  strikes: readonly {
    strike: number;
    callOi?: number;
    putOi?: number;
    callIv?: number;
    putIv?: number;
    expiry?: number;
  }[],
  options: { expiry?: number; iv?: number } = {},
): OptionContract[] {
  const out: OptionContract[] = [];
  for (const row of strikes) {
    const expiry = row.expiry ?? options.expiry ?? NOW + 30 * DAY;
    out.push(
      contract({
        type: "call",
        strike: row.strike,
        expiry,
        oi: row.callOi ?? 0,
        iv: row.callIv ?? options.iv ?? 0.2,
      }),
    );
    out.push(
      contract({
        type: "put",
        strike: row.strike,
        expiry,
        oi: row.putOi ?? 0,
        iv: row.putIv ?? options.iv ?? 0.2,
      }),
    );
  }
  return out;
}

/**
 * Chaîne synthétique « type SPX » : ~30 000 contrats sur plusieurs échéances,
 * pour vérifier la tenue du calcul (et le coût du zero gamma) à l'échelle.
 */
export function largeChain(
  spot = 7600,
  expiries = 12,
  strikesPerExpiry = 1100,
): OptionContract[] {
  const out: OptionContract[] = [];
  for (let e = 0; e < expiries; e++) {
    const expiry = NOW + (e + 1) * 7 * DAY;
    const step = 5;
    const count = strikesPerExpiry;
    for (let i = 0; i < count; i++) {
      const strike = Math.round((spot * (1 - 0.25 + (0.5 * i) / count)) / step) * step;
      const dist = Math.abs(strike / spot - 1);
      const oi = Math.round(2000 * Math.exp(-(dist * dist) / 0.02) + 25);
      out.push(contract({ type: "call", strike, expiry, oi, iv: 0.15 }));
      out.push(contract({ type: "put", strike, expiry, oi, iv: 0.17 }));
    }
  }
  return out;
}
