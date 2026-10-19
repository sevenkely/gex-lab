/**
 * i18n minimaliste : dictionnaires fr/en, résolution par locale.
 * L'interface est en français par défaut ; l'anglais est prêt à être activé
 * via NEXT_PUBLIC_LOCALE.
 */

export type Locale = "fr" | "en";

export const LOCALE: Locale =
  (process.env.NEXT_PUBLIC_LOCALE as Locale | undefined) === "en" ? "en" : "fr";

type DeepWiden<T> = { [K in keyof T]: T[K] extends string ? string : DeepWiden<T[K]> };

const fr = {
  appName: "GEX Terminal",
  nav: {
    home: "Accueil",
    flow: "Flux d’options",
    chart: "Graphique GEX",
    gamma: "Gamma par strike",
    darkPool: "Dark Pool",
    methodology: "Méthodologie",
  },
  header: {
    search: "Rechercher un ticker",
    live: "Direct",
    delayed: "Différé",
    regimeAuto: "Régime : auto",
    regimeLong: "Régime : long",
    regimeShort: "Régime : short",
  },
  regime: {
    long: "Long gamma",
    short: "Short gamma",
    label: "Régime",
  },
  badges: {
    estimated: "Modèle estimé",
    derived: "Dérivé (proxy)",
    realtime: "Temps réel",
    delayed: "Différé",
    stale: "Données en retard",
  },
  levels: {
    callWall: "Call Wall",
    putWall: "Put Wall",
    zeroGamma: "Zero Gamma",
    maxGamma: "Gamma max",
    title: "Niveaux clés",
    priceDistance: "Prix / distance",
  },
  metrics: {
    netGex: "Net GEX",
    netGexPer1pct: "Net GEX / +1 % du spot",
    expectedMove: "Mouvement attendu 1σ",
    spot: "Spot",
    oi: "Open interest",
    volume: "Volume",
    iv: "IV",
  },
  home: {
    title: "Accueil",
    netGexByTicker: "Net GEX par actif",
    recentFlow: "Flux récent",
    regimeOfDay: "Régime du jour",
    primary: "Actifs principaux",
    secondary: "Secondaires",
    clickHint: "Cliquez pour ouvrir le graphique",
  },
  flow: {
    title: "Flux d’options",
    filters: { all: "Tout", calls: "Calls", puts: "Puts", blocks: "Blocs" },
    cols: {
      time: "Heure",
      symbol: "Symbole",
      type: "Type",
      strike: "Strike",
      expiry: "Éch.",
      size: "Taille",
      premium: "Prime",
      side: "Côté",
      tag: "Tag",
    },
    block: "Bloc",
    calls: "Calls",
    puts: "Puts",
    ask: "Ask",
    bid: "Bid",
    indexNote:
      "Activité d’options (volume) calculée par différence de snapshots CBOE : ce ne sont pas des trades.",
  },
  chart: {
    title: "Graphique GEX",
    focus: "Focus",
    levels: "Niveaux",
    testLevel: "Tester un niveau",
    interval: "Unité de temps",
    loading: "Chargement des bougies…",
  },
  gamma: {
    title: "Gamma par strike",
    subtitle: "GEX par strike — puts à gauche, calls à droite",
    empty: "Aucun strike dans la fenêtre ± 8 strikes.",
  },
  darkPool: {
    title: "Dark Pool",
    banner:
      "Données ATS hebdomadaires FINRA — pas des prints en direct. Publication avec plusieurs semaines de retard.",
    week: "Semaine du",
    volume: "Volume",
    trades: "Trades",
    notional: "Notionnel",
    mainAts: "Principaux ATS",
    relative: "Volume relatif",
    notCovered: "Non couvert par les données ATS FINRA (indice).",
  },
  methodology: {
    title: "Méthodologie & sources",
  },
  common: {
    source: "Source",
    latency: "Latence",
    asOf: "À",
    unavailable: "indisponible",
    lastCache: "dernier cache",
    marketClosed: "Marché fermé — dernière séance",
    all: "Toutes",
    loading: "Chargement…",
    retry: "Réessayer",
    error: "Erreur de chargement",
    showMore: "Afficher plus",
    disclaimer:
      "GEX estimé à partir des chaînes d’options publiques. Ce n’est pas du positionnement dealer observé, ni un conseil financier. Aucun ordre n’est exécuté depuis cet outil.",
    icu: "Aucune donnée disponible",
  },
} as const;

const en: Dictionary = {
  appName: "GEX Terminal",
  nav: {
    home: "Home",
    flow: "Options flow",
    chart: "GEX chart",
    gamma: "Gamma by strike",
    darkPool: "Dark pool",
    methodology: "Methodology",
  },
  header: {
    search: "Search a ticker",
    live: "Live",
    delayed: "Delayed",
    regimeAuto: "Regime: auto",
    regimeLong: "Regime: long",
    regimeShort: "Regime: short",
  },
  regime: { long: "Long gamma", short: "Short gamma", label: "Regime" },
  badges: {
    estimated: "Estimated model",
    derived: "Derived (proxy)",
    realtime: "Real-time",
    delayed: "Delayed",
    stale: "Stale data",
  },
  levels: {
    callWall: "Call wall",
    putWall: "Put wall",
    zeroGamma: "Zero gamma",
    maxGamma: "Max gamma",
    title: "Key levels",
    priceDistance: "Price / distance",
  },
  metrics: {
    netGex: "Net GEX",
    netGexPer1pct: "Net GEX / +1% spot",
    expectedMove: "Expected 1σ move",
    spot: "Spot",
    oi: "Open interest",
    volume: "Volume",
    iv: "IV",
  },
  home: {
    title: "Home",
    netGexByTicker: "Net GEX by asset",
    recentFlow: "Recent flow",
    regimeOfDay: "Regime of the day",
    primary: "Primary assets",
    secondary: "Secondary",
    clickHint: "Click to open the chart",
  },
  flow: {
    title: "Options flow",
    filters: { all: "All", calls: "Calls", puts: "Puts", blocks: "Blocks" },
    cols: {
      time: "Time",
      symbol: "Symbol",
      type: "Type",
      strike: "Strike",
      expiry: "Exp.",
      size: "Size",
      premium: "Premium",
      side: "Side",
      tag: "Tag",
    },
    block: "Block",
    calls: "Calls",
    puts: "Puts",
    ask: "Ask",
    bid: "Bid",
    indexNote:
      "Options activity (volume) derived from CBOE snapshot deltas — not trades.",
  },
  chart: {
    title: "GEX chart",
    focus: "Focus",
    levels: "Levels",
    testLevel: "Test a level",
    interval: "Timeframe",
    loading: "Loading candles…",
  },
  gamma: {
    title: "Gamma by strike",
    subtitle: "GEX by strike — puts left, calls right",
    empty: "No strike within ± 8 strikes.",
  },
  darkPool: {
    title: "Dark pool",
    banner: "FINRA weekly ATS data — not live prints. Published several weeks behind.",
    week: "Week of",
    volume: "Volume",
    trades: "Trades",
    notional: "Notional",
    mainAts: "Main ATS",
    relative: "Relative volume",
    notCovered: "Not covered by FINRA ATS data (index).",
  },
  methodology: { title: "Methodology & sources" },
  common: {
    source: "Source",
    latency: "Latency",
    asOf: "As of",
    unavailable: "unavailable",
    lastCache: "last cache",
    marketClosed: "Market closed — last session",
    all: "All",
    loading: "Loading…",
    retry: "Retry",
    error: "Loading error",
    showMore: "Show more",
    disclaimer:
      "GEX estimated from public options chains. This is not observed dealer positioning, nor financial advice. No order is executed from this tool.",
    icu: "No data available",
  },
};

/** Dictionnaire élargi : clés de `fr`, valeurs `string` quel que soit la langue. */
export type Dictionary = DeepWiden<typeof fr>;

const dictionaries: Record<Locale, Dictionary> = { fr, en };

export function t(): Dictionary {
  return dictionaries[LOCALE];
}
