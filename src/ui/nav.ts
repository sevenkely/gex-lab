/** Navigation de l'application : rail, titres, icônes. */

import { t } from "@/lib/i18n";

export interface NavItem {
  id: "home" | "flow" | "chart" | "gamma" | "darkPool" | "methodology";
  href: string;
  /** Route dynamique : l'onglet reste actif sur toutes les sous-pages. */
  match: RegExp;
  icon: string;
}

/**
 * Jeu d'icônes du rail — une seule famille : grille de 24, trait 1,6 px,
 * extrémités arrondies, aucune lettre ni pictogramme emprunté (l'ancien « Y »
 * pour gamma et la banque pour le dark pool ne racontaient pas la donnée).
 * Chaque tracé représente la vue : tableau de bord, impulsion du flux, deux
 * bougies, courbe de gamma, couches de liquidité masquée, fiche de méthode.
 */
export const NAV_ITEMS: readonly NavItem[] = [
  {
    id: "home",
    href: "/",
    match: /^\/$/,
    // Tableau de bord : quatre tuiles, pas une maison.
    icon: "M4 4h6.5v6.5H4zM13.5 4H20v6.5h-6.5zM4 13.5h6.5V20H4zM13.5 13.5H20V20h-6.5z",
  },
  {
    id: "flow",
    href: "/flux",
    match: /^\/flux/,
    // Impulsion de flux : une ligne d'activité, pas des vagues.
    icon: "M2.5 12h3.2l2.1-6.4 3.6 12.8L14 9l2 3h5.5",
  },
  {
    id: "chart",
    href: "/graphique/ES",
    match: /^\/graphique/,
    // Deux bougies : mèches + corps, la vue réelle de l'onglet.
    icon: "M6.5 3v4M6.5 15.5V21M6.5 7h3.5v8.5H6.5zM15.5 3v2.5M15.5 12.5V21M15.5 5.5H19V12.5h-3.5z",
  },
  {
    id: "gamma",
    href: "/gamma/ES",
    match: /^\/gamma/,
    // Distribution gamma : la cloche, pas la lettre Y.
    icon: "M2.5 19.5c4.6 0 4.2-14 9.5-14s4.9 14 9.5 14M2.5 19.5h19",
  },
  {
    id: "darkPool",
    href: "/dark-pool",
    match: /^\/dark-pool/,
    // Liquidité en couches : le carnet caché, pas une banque.
    icon: "M12 3.5l8.5 4.7-8.5 4.8-8.5-4.8zM3.5 12.5l8.5 4.8 8.5-4.8M3.5 16.8l8.5 4.7 8.5-4.7",
  },
  {
    id: "methodology",
    href: "/methodologie",
    match: /^\/methodologie/,
    // Fiche annotée : la définition de chaque niveau.
    icon: "M5 3.5h9.5L19 8v12.5H5zM14 3.5V8h4.5M8.5 12h7M8.5 15.5h7M8.5 19h4",
  },
] as const;

export function navLabel(id: NavItem["id"]): string {
  return t().nav[id];
}

export function activeNav(pathname: string): NavItem | undefined {
  return NAV_ITEMS.find((item) => item.match.test(pathname));
}

/** Sous-navigation d'un actif (graphique / gamma) : un onglet par actif. */
export function assetHref(view: "chart" | "gamma", assetId: string): string {
  return view === "chart" ? `/graphique/${assetId}` : `/gamma/${assetId}`;
}
