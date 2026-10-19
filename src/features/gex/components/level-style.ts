import { t } from "@/lib/i18n";
import type { GexLevelKind } from "../types";

/**
 * Couleurs des niveaux — identiques en DOM (rgb pour composer l'alpha) et en
 * canvas (hex). Ces valeurs viennent des tokens du design system "Gamma Field" :
 * turquoise = call wall, braise = put wall, sable = zero gamma.
 */
export const LEVEL_RGB: Record<GexLevelKind, string> = {
  callWall: "45,212,191",
  putWall: "255,107,74",
  zeroGamma: "232,216,168",
  maxGamma: "160,185,230",
};

export const LEVEL_HEX: Record<GexLevelKind, string> = {
  callWall: "#2DD4BF",
  putWall: "#FF6B4A",
  zeroGamma: "#E8D8A8",
  maxGamma: "#A0B9E6",
};

/** Niveaux mis en avant dans les cartes et les tags du graphique. */
export const MAIN_LEVELS: readonly GexLevelKind[] = ["callWall", "putWall", "zeroGamma"];

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
  }
}
