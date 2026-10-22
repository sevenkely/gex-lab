"use client";

import { create } from "zustand";

/**
 * Ouverture de la palette de commandes (⌘K / Ctrl+K).
 *
 * `openCount` s'incrémente à chaque ouverture : le contenu de la palette est
 * remonté à neuf (recherche vide, première ligne active) sans effet de
 * synchronisation — l'état de la palette ne survit pas à sa fermeture.
 */
export interface PaletteState {
  open: boolean;
  openCount: number;
  setOpen: (open: boolean) => void;
  toggle: () => void;
}

export const usePaletteStore = create<PaletteState>((set) => ({
  open: false,
  openCount: 0,
  setOpen: (open) =>
    set((state) => ({
      open,
      openCount: open && !state.open ? state.openCount + 1 : state.openCount,
    })),
  toggle: () =>
    set((state) =>
      state.open
        ? { open: false }
        : { open: true, openCount: state.openCount + 1 },
    ),
}));
