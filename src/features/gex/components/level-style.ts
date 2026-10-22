import { t } from "@/lib/i18n";
import type { GexLevelKind } from "../types";

/**
 * Couleurs des niveaux — identiques en DOM (rgb pour composer l'alpha) et en
 * canvas (hex). Convention directionnelle : vert = call wall, rouge = put wall,
 * sable = zero gamma, acier = max gamma, lavande = max pain.
 */
export const LEVEL_RGB: Record<GexLevelKind, string> = {
  callWall: "14,203,129",
  putWall: "246,70,93",
  zeroGamma: "232,216,168",
  maxGamma: "160,185,230",
  maxPain: "180,160,229",
};

export const LEVEL_HEX: Record<GexLevelKind, string> = {
  callWall: "#0ECB81",
  putWall: "#F6465D",
  zeroGamma: "#E8D8A8",
  maxGamma: "#A0B9E6",
  maxPain: "#B4A0E5",
};

/**
 * Niveaux mis en avant dans le graphique (bandes, étiquettes, épinglage).
 * Le max gamma en est exclu : il est déjà dessiné en segments discrets et
 * n'a pas d'étiquette, pour ne pas concurrencer les murs.
 */
export const MAIN_LEVELS: readonly GexLevelKind[] = [
  "callWall",
  "putWall",
  "zeroGamma",
  "maxPain",
];

/** Niveaux listés dans le panneau (le King Node y figure aussi). */
export const CARD_LEVELS: readonly GexLevelKind[] = [...MAIN_LEVELS, "maxGamma"];

/** Définition courte d'un niveau, affichée en info-bulle. */
export function levelExplain(kind: GexLevelKind): string {
  return t().levels.explain[kind];
}

/**
 * Code court des badges du ladder : CW / CW2, PW / PW2, ZG, MG, MP — la
 * convention de la référence (deux murs par côté).
 */
export function levelCode(kind: GexLevelKind, rank = 1): string {
  const base =
    kind === "callWall"
      ? "CW"
      : kind === "putWall"
        ? "PW"
        : kind === "zeroGamma"
          ? "ZG"
          : kind === "maxGamma"
            ? "MG"
            : "MP";
  return rank > 1 ? `${base}${rank}` : base;
}

/** Nom complet, rang inclus : « Call Wall », « Call Wall 2 ». */
export function levelLabelWithRank(kind: GexLevelKind, rank = 1): string {
  const label = levelLabel(kind);
  return rank > 1 ? `${label} ${rank}` : label;
}

export function levelLabel(kind: GexLevelKind): string {
  switch (kind) {
    case "callWall":
      return t().levels.callWall;
    case "putWall":
      return t().levels.putWall;
    case "zeroGamma":
      return t().levels.zeroGamma;
    case "maxGamma":
      return t().levels.maxGamma;
    case "maxPain":
      return t().levels.maxPain;
  }
}
