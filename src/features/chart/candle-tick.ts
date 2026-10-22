/**
 * Application d'un tick de prix à la dernière bougie.
 *
 * Le flux Deribit ne fournit qu'un prix : il ne doit ni laisser la dernière
 * bougie ouverte indéfiniment (le défaut précédent : sur 5m, la bougie de
 * l'ouverture absorbait toute la séance), ni écraser l'historique.
 *
 * Règles :
 *  - même intervalle → high/low/close mis à jour, open conservé ;
 *  - intervalle franchi → nouvelle bougie ouverte au close précédent ;
 *  - horloge en retard ou bougie de données différées → on met à jour la
 *    dernière bougie au lieu de créer une bougie dans le passé ;
 *  - aucune mutation de l'entrée (les refs du graphique comparent les
 *    références).
 */

import { INTERVAL_MS } from "@/lib/candles";
import type { Candle, CandleInterval } from "@/server/providers/types";

export interface CandleTick {
  candles: readonly Candle[];
  /** true quand une nouvelle bougie a été ouverte. */
  rolled: boolean;
}

export function applyPriceTick(
  candles: readonly Candle[],
  price: number,
  interval: CandleInterval,
  now: number = Date.now(),
): CandleTick {
  const last = candles[candles.length - 1];
  if (!last || !Number.isFinite(price) || price <= 0) {
    return { candles, rolled: false };
  }

  const step = INTERVAL_MS[interval];
  const bucket = Math.floor(now / step) * step;
  const lastMs = last.time * 1000;

  if (bucket > lastMs) {
    const open = last.close;
    const next: Candle = {
      time: Math.floor(bucket / 1000),
      open,
      high: Math.max(open, price),
      low: Math.min(open, price),
      close: price,
      // Le prix ne transporte pas de volume : la nouvelle bougie démarre à 0
      // et l'histogramme se remplit au prochain rechargement serveur.
      volume: 0,
    };
    return { candles: [...candles, next], rolled: true };
  }

  const updated: Candle = {
    ...last,
    close: price,
    high: Math.max(last.high, price),
    low: Math.min(last.low, price),
  };
  return { candles: [...candles.slice(0, -1), updated], rolled: false };
}
