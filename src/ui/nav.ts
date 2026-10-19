/** Navigation de l'application : rail, titres, icônes. */

import { t } from "@/lib/i18n";

export interface NavItem {
  id: "home" | "flow" | "chart" | "gamma" | "darkPool" | "methodology";
  href: string;
  /** Route dynamique : l'onglet reste actif sur toutes les sous-pages. */
  match: RegExp;
  icon: string;
}

export const NAV_ITEMS: readonly NavItem[] = [
  { id: "home", href: "/", match: /^\/$/, icon: "M4 11l8-7 8 7v9h-5v-6H9v6H4z" },
  {
    id: "flow",
    href: "/flux",
    match: /^\/flux/,
    icon: "M3 8c3-3 6 3 9 0s6 3 9 0M3 15c3-3 6 3 9 0s6 3 9 0",
  },
  {
    id: "chart",
    href: "/graphique/BTC",
    match: /^\/graphique/,
    icon: "M4 20V4M4 16l5-5 4 3 7-8",
  },
  {
    id: "gamma",
    href: "/gamma/BTC",
    match: /^\/gamma/,
    icon: "M5 4l7 9v7M19 4l-7 9",
  },
  {
    id: "darkPool",
    href: "/dark-pool",
    match: /^\/dark-pool/,
    icon: "M3 10l9-6 9 6M5 10v8M10 10v8M14 10v8M19 10v8M3 20h18",
  },
  {
    id: "methodology",
    href: "/methodologie",
    match: /^\/methodologie/,
    icon: "M5 4h14v16H5zM9 8h6M9 12h6M9 16h4",
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
