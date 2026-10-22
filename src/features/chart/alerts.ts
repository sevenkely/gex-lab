/**
 * Alertes de niveau — logique pure, testable, sans horloge implicite.
 *
 * Trois événements, du plus fort au plus faible :
 *   1. « croisement » : le prix passe de l'autre côté d'un niveau entre deux
 *      ticks (le seul événement qui change la lecture du book) ;
 *   2. « toucher » : le prix entre dans ± 0,12 % du niveau ;
 *   3. « approche » : le prix entre dans ± 0,35 % du niveau.
 *
 * Les délais anti-répétition évitent qu'un prix qui oscille autour d'un niveau
 * inonde le journal (le défaut n°1 des alertes de trading).
 *
 * Aucune donnée de marché n'est stockée ici : le module ne fait que décider, à
 * partir du tick précédent, du tick courant et de l'état des niveaux.
 */

import type { GexLevelKind } from "@/features/gex/types";

export type AlertKind = "approach" | "touch" | "cross";

export interface AlertLevel {
  kind: GexLevelKind;
  price: number;
  /** Libellé lisible du niveau (« Call Wall »). */
  label: string;
}

export interface LevelAlert {
  id: string;
  kind: AlertKind;
  level: GexLevelKind;
  label: string;
  /** Prix du niveau touché. */
  levelPrice: number;
  /** Prix observé au moment de l'alerte. */
  observed: number;
  ts: number;
}

/** Seuil d'approche, en fraction du prix (0,35 %). */
export const APPROACH_PCT = 0.0035;
/** Seuil de toucher, en fraction du prix (0,12 %). */
export const TOUCH_PCT = 0.0012;

export const APPROACH_COOLDOWN_MS = 15 * 60_000;
export const TOUCH_COOLDOWN_MS = 4_000;
export const CROSS_COOLDOWN_MS = 60_000;

export interface AlertMemory {
  approach: Map<GexLevelKind, number>;
  touch: Map<GexLevelKind, number>;
  cross: Map<GexLevelKind, number>;
}

export function createAlertMemory(): AlertMemory {
  return { approach: new Map(), touch: new Map(), cross: new Map() };
}

/** Les trois types, du plus fort au plus faible. */
const PRIORITY: readonly AlertKind[] = ["cross", "touch", "approach"];

const COOLDOWN: Record<AlertKind, number> = {
  cross: CROSS_COOLDOWN_MS,
  touch: TOUCH_COOLDOWN_MS,
  approach: APPROACH_COOLDOWN_MS,
};

/**
 * Décide de la prochaine alerte, ou `null`. La mémoire passée est mise à jour
 * pour le seul événement retenu (sinon un croisement consommerait aussi le
 * quota d'approche du même niveau).
 */
export function detectLevelAlert({
  previous,
  price,
  now,
  levels,
  memory,
}: {
  previous: number;
  price: number;
  now: number;
  levels: readonly AlertLevel[];
  memory: AlertMemory;
}): LevelAlert | null {
  if (!(price > 0)) return null;

  let best: { alert: LevelAlert; rank: number; distance: number } | null = null;

  for (const level of levels) {
    if (!(level.price > 0)) continue;
    const distance = Math.abs(price - level.price) / price;

    const crossed =
      previous > 0 && (previous > level.price) !== (price > level.price) && previous !== price;
    const kinds: AlertKind[] = crossed
      ? ["cross"]
      : distance <= TOUCH_PCT
        ? ["touch"]
        : distance <= APPROACH_PCT
          ? ["approach"]
          : [];

    for (const kind of kinds) {
      const last = memory[kind].get(level.kind) ?? 0;
      if (now - last < COOLDOWN[kind]) continue;
      const rank = PRIORITY.indexOf(kind);
      if (!best || rank < best.rank || (rank === best.rank && distance < best.distance)) {
        best = {
          rank,
          distance,
          alert: {
            id: `${level.kind}-${kind}-${now}`,
            kind,
            level: level.kind,
            label: level.label,
            levelPrice: level.price,
            observed: price,
            ts: now,
          },
        };
      }
    }
  }

  if (!best) return null;
  memory[best.alert.kind].set(best.alert.level, now);
  // Un croisement EST un toucher : on pose aussi ce délai, sinon le tick
  // suivant (le prix reste collé au niveau) produirait une seconde alerte.
  if (best.alert.kind === "cross") memory.touch.set(best.alert.level, now);
  return best.alert;
}
