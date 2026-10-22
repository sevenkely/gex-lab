"use client";

/**
 * Journal des alertes de niveau (Zustand).
 *
 * Ce ne sont ni des données de marché ni des préférences d'affichage : ce sont
 * des **événements** datés, produits par `detectLevelAlert()` au fil des ticks.
 * Le journal est borné (12 entrées) : l'objectif est de répondre à « qu'est-ce
 * qui vient de se passer ? », pas de constituer un historique.
 */

import { create } from "zustand";
import type { LevelAlert } from "@/features/chart/alerts";

const MAX_ALERTS = 12;

export interface AlertsState {
  /** Suivi actif ou non (bouton du panneau). */
  enabled: boolean;
  /** Plus récent en premier. */
  alerts: LevelAlert[];
  toggle: () => void;
  push: (alert: LevelAlert) => void;
  clear: () => void;
}

export const useAlertsStore = create<AlertsState>((set) => ({
  enabled: true,
  alerts: [],
  toggle: () => set((state) => ({ enabled: !state.enabled })),
  push: (alert) =>
    set((state) =>
      state.enabled ? { alerts: [alert, ...state.alerts].slice(0, MAX_ALERTS) } : state,
    ),
  clear: () => set({ alerts: [] }),
}));
