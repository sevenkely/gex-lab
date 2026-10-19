"use client";

/**
 * État d'interface (Zustand). Aucune donnée de marché ici : uniquement des
 * préférences d'affichage. Les ticks de prix ne passent JAMAIS par ce store
 * (ils vivent dans des refs et sont rendus en requestAnimationFrame).
 */

import { create } from "zustand";
import type { ExpiryFilter } from "@/config/assets";
import type { GexRegime } from "@/features/gex/types";

export type RegimeMode = "auto" | "long" | "short";
export type FlowFilter = "all" | "calls" | "puts" | "blocks";

export interface UiState {
  /** Mode du régime affiché : auto (calculé) ou forcé (démo). */
  regimeMode: RegimeMode;
  /** Régime calculé du dernier snapshot chargé. */
  autoRegime: GexRegime;
  /** Panneau latéral du graphique replié (mode Focus). */
  focus: boolean;
  /** Bandes de niveaux visibles. */
  showLevels: boolean;
  /** Filtre d'échéance partagé par les vues GEX. */
  expiryFilter: ExpiryFilter;
  /** Filtre du flux d'options. */
  flowFilter: FlowFilter;
  /** Intervalles du graphique (clé → valeur) pour mémoriser le choix. */
  interval: string;
  setRegimeMode: (mode: RegimeMode) => void;
  setAutoRegime: (regime: GexRegime) => void;
  toggleFocus: () => void;
  toggleLevels: () => void;
  setExpiryFilter: (filter: ExpiryFilter) => void;
  setFlowFilter: (filter: FlowFilter) => void;
  setInterval: (interval: string) => void;
}

export const useUiStore = create<UiState>((set) => ({
  regimeMode: "auto",
  autoRegime: "long",
  focus: false,
  showLevels: true,
  expiryFilter: "ALL",
  flowFilter: "all",
  interval: "5m",
  setRegimeMode: (regimeMode) => set({ regimeMode }),
  setAutoRegime: (autoRegime) => set({ autoRegime }),
  toggleFocus: () => set((s) => ({ focus: !s.focus })),
  toggleLevels: () => set((s) => ({ showLevels: !s.showLevels })),
  setExpiryFilter: (expiryFilter) => set({ expiryFilter }),
  setFlowFilter: (flowFilter) => set({ flowFilter }),
  setInterval: (interval) => set({ interval }),
}));

export function useEffectiveRegime(): GexRegime {
  return useUiStore((s) => (s.regimeMode === "auto" ? s.autoRegime : s.regimeMode));
}
