/**
 * Fusion d'une page d'historique avec les bougies déjà en mémoire.
 *
 * Le serveur peut renvoyer un chevauchement (la fenêtre demandée commence
 * avant la plus ancienne bougie connue) et l'ordre n'est pas garanti : on
 * déduplique par `time`, on trie, puis on plafonne. Le plafond retire les
 * bougies les plus anciennes — l'utilisateur regarde le passé récent, pas le
 * début de l'historique.
 */

import { MAX_BARS } from "@/lib/candles";
import type { Candle } from "@/server/providers/types";

export interface HistoryMerge {
  candles: readonly Candle[];
  /** Nombre de bougies réellement ajoutées en tête. */
  added: number;
  /** true si l'historique est complet (rien à ajouter ou plafond atteint). */
  exhausted: boolean;
}

export function mergeOlderCandles(
  current: readonly Candle[],
  older: readonly Candle[],
  maxBars: number = MAX_BARS,
): HistoryMerge {
  const known = new Set(current.map((row) => row.time));
  const fresh = older
    .filter((row) => !known.has(row.time))
    .slice()
    .sort((a, b) => a.time - b.time);

  if (fresh.length === 0) {
    return { candles: current, added: 0, exhausted: true };
  }

  const room = Math.max(0, maxBars - current.length);
  const kept = fresh.length > room ? fresh.slice(fresh.length - room) : fresh;
  if (kept.length === 0) {
    return { candles: current, added: 0, exhausted: true };
  }

  return {
    candles: [...kept, ...current],
    added: kept.length,
    exhausted: fresh.length > room,
  };
}
