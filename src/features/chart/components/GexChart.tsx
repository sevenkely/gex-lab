"use client";

/**
 * Graphique GEX — lightweight-charts + primitive de bandes.
 *
 * Contraintes de performance tenues ici :
 *  - une seule instance de graphique (créée au montage, détruite au démontage) ;
 *  - aucune donnée React ne change pendant l'animation : les bandes sont
 *    dessinées par la primitive, qui ne demande qu'un redraw (`requestUpdate`) ;
 *  - la légende OHLC et le prix temps réel écrivent directement dans le DOM
 *    (refs), jamais via `setState` par tick ;
 *  - le flux Deribit passe par un singleton WebSocket, appliqué au plus une
 *    fois par frame (requestAnimationFrame).
 *
 * Le changement d'unité de temps passe par l'URL (`?tf=`), donc par le serveur :
 * le composant reçoit de nouvelles bougies et se contente de les appliquer.
 */

import {
  CandlestickSeries,
  ColorType,
  CrosshairMode,
  HistogramSeries,
  LineStyle,
  createChart,
  type CandlestickData,
  type HistogramData,
  type IChartApi,
  type IPriceLine,
  type ISeriesApi,
  type LogicalRange,
  type Time,
} from "lightweight-charts";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { LEVEL_RGB } from "@/features/gex/components/level-style";
import type { GexLevelKind, GexSnapshot } from "@/features/gex/types";
import { INTERVAL_MS, MAX_BARS, WINDOW_HOURS } from "@/lib/candles";
import { fmt, fmtGex, fmtGexCompact } from "@/lib/format";
import { t } from "@/lib/i18n";
import type { Candle, CandleInterval } from "@/server/providers/types";
import {
  aggregateBars,
  formatPeriod,
  mergeBridgeBars,
  planAggregation,
  type AggregationPlan,
} from "../atas";
import { applyPriceTick } from "../candle-tick";
import { mergeOlderCandles } from "../history";
import {
  useAtasLive,
  ATAS_WS_URL,
  type AtasEvent,
  type AtasStatus,
} from "../hooks/useAtasLive";
import { useDeribitPriceIndex } from "../hooks/useDeribitSocket";
import {
  createAlertMemory,
  detectLevelAlert,
  type AlertLevel,
  type LevelAlert,
} from "../alerts";
import { DrawingLayer } from "./DrawingLayer";
import { GexBandsPrimitive, type BandKind, type BandLevel } from "./gex-bands";
import { LevelTags, type LevelTag } from "./LevelTags";
import { StrikeLadder, ladderRows, strikeDecimals } from "./StrikeLadder";

const UP = "#0ECB81";
const DOWN = "#F6465D";

/** « CALL WALL 2 » → « CW2 » ; les niveaux de séance gardent leur sigle. */
function shortLevelLabel(label: string): string {
  const text = label.trim();
  if (!/\s/.test(text)) return text.toUpperCase();
  return text
    .split(/\s+/)
    .map((part) => (/^\d+$/.test(part) ? part : part[0]))
    .join("")
    .toUpperCase();
}

const BAND_LABEL: Record<BandKind, string> = {
  callWall: "Call Wall",
  putWall: "Put Wall",
  zeroGamma: "Zero Gamma",
  maxGamma: "Max Gamma",
  maxPain: "Max Pain",
};

function toCandles(rows: readonly Candle[]): CandlestickData<Time>[] {
  return rows.map((candle) => ({
    time: candle.time as Time,
    open: candle.open,
    high: candle.high,
    low: candle.low,
    close: candle.close,
  }));
}

function toVolume(rows: readonly Candle[]): HistogramData<Time>[] {
  return rows.map((candle) => ({
    time: candle.time as Time,
    value: candle.volume,
    color: candle.close >= candle.open ? "rgba(14,203,129,.38)" : "rgba(246,70,93,.38)",
  }));
}

export function GexChart({
  snapshot,
  candles,
  interval,
  decimals,
  highlight,
  panelOpen,
  onTogglePanel,
  levelsVisible,
  onToggleLevels,
  onAlert,
}: {
  snapshot: GexSnapshot;
  candles: readonly Candle[];
  interval: CandleInterval;
  decimals: number;
  highlight: GexLevelKind | null;
  panelOpen: boolean;
  onTogglePanel: () => void;
  levelsVisible: boolean;
  onToggleLevels: () => void;
  /** Appelé quand le flux temps réel approche, touche ou croise un niveau. */
  onAlert?: (alert: LevelAlert) => void;
}) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const chartRef = useRef<IChartApi | null>(null);
  // API du graphique exposée au calque de dessin (état, pas ref : le calque
  // doit se remonter quand l'instance change).
  const [apis, setApis] = useState<{
    chart: IChartApi;
    series: ISeriesApi<"Candlestick">;
  } | null>(null);
  const [zoneLabels, setZoneLabels] = useState(true);
  const [toolsOpen, setToolsOpen] = useState(false);
  // Le ladder remplace les étiquettes internes et les pastilles d'axe sur
  // grand écran ; sur mobile, on garde l'ancien rendu dans le panneau.
  const [wide, setWide] = useState(false);
  const overlayLinesRef = useRef<IPriceLine[]>([]);
  const candleRef = useRef<ISeriesApi<"Candlestick"> | null>(null);
  const volumeRef = useRef<ISeriesApi<"Histogram"> | null>(null);
  const bandsRef = useRef<GexBandsPrimitive | null>(null);
  const candlesRef = useRef<readonly Candle[]>(candles);
  // Dernier historique venu du serveur : le pont s'y superpose, il ne le
  // remplace pas. Une réinitialisation du pont repart de cette base.
  const baseCandlesRef = useRef<readonly Candle[]>(candles);
  // Pont ATAS : bougies brutes (une par timestamp), bougies en attente de
  // frame, et unité de temps annoncée par l'indicateur.
  const atasRawRef = useRef(new Map<number, Candle>());
  const atasPeriodRef = useRef<number | null>(null);
  const atasPendingRef = useRef<Candle[]>([]);
  const atasRafRef = useRef(0);
  const reapplyAtasRef = useRef<() => void>(() => {});
  const [atas, setAtas] = useState<{
    status: AtasStatus;
    period: number | null;
    mismatch: "coarser" | "session" | "ratio" | null;
  }>({ status: "idle", period: null, mismatch: null });
  const legendRef = useRef<HTMLDivElement | null>(null);
  // Le handler crosshair est enregistré une fois au montage : il doit appeler
  // la dernière version de writeLegend (sinon l'unité de temps reste figée).
  const legendWriterRef = useRef<(index: number | null) => void>(() => {});
  const priceTagRef = useRef<HTMLSpanElement | null>(null);
  const statusRef = useRef<HTMLSpanElement | null>(null);
  const rafRef = useRef(0);
  // Historique : chargement des périodes précédentes au défilement.
  const historyRef = useRef({
    loading: false,
    exhausted: false,
    lastAttempt: 0,
    generation: 0,
  });
  const loadOlderRef = useRef<() => void>(() => {});
  // N'arme le chargement qu'après une interaction : un `fitContent()` initial
  // place la vue au bord gauche et déclencherait un appel inutile au montage.
  const armedRef = useRef(false);
  // L'indicateur est étiqueté par vue : un chargement resté en vol lors d'un
  // changement d'unité de temps ne peut pas rallumer la pastille à tort.
  const viewKey = `${snapshot.assetId}:${interval}`;
  // Le pont ATAS est disponible mais désactivé par défaut : le graphique
  // continue d'afficher la donnée serveur différée de 15 min, comme avant.
  // `NEXT_PUBLIC_ATAS_LIVE=1` l'active explicitement (NQ, ES, GC).
  const atasEnabled = process.env.NEXT_PUBLIC_ATAS_LIVE === "1";
  // BTC/ETH gardent le flux Deribit : le pont ne concerne que les futures
  // indexés sur une chaîne d'options CBOE.
  const atasEligible = snapshot.assetId !== "BTC" && snapshot.assetId !== "ETH";
  const atasSymbol = atasEnabled && atasEligible ? snapshot.assetId : null;
  const [loadingState, setLoadingState] = useState({ key: viewKey, loading: false });
  const loadingOlder = loadingState.key === viewKey && loadingState.loading;
  // Alertes : mémoire des délais anti-répétition et prix du tick précédent.
  const alertMemoryRef = useRef(createAlertMemory());
  const alertPriceRef = useRef(0);
  const onAlertRef = useRef(onAlert);

  const tr = t();

  /**
   * Niveaux → bandes. Le rang 1 porte la bande pleine et l'étiquette ; le rang 2
   * des murs est un trait fin (CW2/PW2 de la référence) ; le max gamma reste en
   * segments discrets.
   */
  const bandLevels = useMemo<BandLevel[]>(() => {
    const order: GexLevelKind[] = [
      "callWall",
      "putWall",
      "zeroGamma",
      "maxGamma",
      "maxPain",
    ];
    const out: BandLevel[] = [];
    for (const kind of order) {
      for (const level of snapshot.levels) {
        if (level.kind !== kind) continue;
        const rank = level.rank ?? 1;
        out.push({
          kind: kind as BandKind,
          rank,
          price: level.price,
          label: BAND_LABEL[kind as BandKind],
          rgb: LEVEL_RGB[kind],
          main: rank === 1 && kind !== "maxGamma",
          // Une case de prix par niveau, seconde murs et max gamma compris :
          // le prix d'un niveau s'écrit UNE fois, sur l'axe.
          tag: true,
        });
      }
    }
    return out;
  }, [snapshot]);

  /**
   * Pastilles de noms, contre l'axe — le seul endroit où un niveau se nomme :
   * murs (rangs 1 et 2), flip, max gamma, max pain.
   *
   * Les niveaux de séance (pVAH / pPOC / pVAL / pLO / pHI) ne sont plus dessinés :
   * cinq lignes de plus sur le graphique et autant de pastilles y ajoutaient du
   * bruit sans changer la lecture du gamma. Le calcul reste disponible côté
   * données (`snapshot.sessionLevels`).
   */
  const overlayLevels = useMemo<LevelTag[]>(() => {
    const out: LevelTag[] = [];
    // Un prix = une étiquette. Deux niveaux peuvent tomber sur le MÊME strike
    // (le max gamma est souvent le mur call du même strike) : le second serait
    // une seconde pastille au même endroit, avec le même prix écrit deux fois.
    const seen = new Set<string>();
    const push = (level: LevelTag) => {
      const key = fmt(level.price, decimals);
      if (seen.has(key)) return;
      seen.add(key);
      out.push(level);
    };
    for (const level of bandLevels) {
      push({
        id: `${level.kind}-${level.rank}`,
        label: `${level.label}${level.rank > 1 ? ` ${level.rank}` : ""}`.toUpperCase(),
        price: level.price,
        rgb: level.rgb,
      });
    }
    return out;
  }, [bandLevels, decimals]);

  const ladder = useMemo(
    () => ladderRows(snapshot.byStrike, snapshot.spot),
    [snapshot.byStrike, snapshot.spot],
  );
  /** Précision de la grille : le ladder et les pastilles écrivent pareil. */
  const ladderDecimals = useMemo(
    () =>
      strikeDecimals(
        ladder.map((row) => row.strike),
        decimals,
      ),
    [ladder, decimals],
  );

  const highlightPrice = useMemo(
    () => bandLevels.find((level) => level.kind === highlight)?.price ?? null,
    [bandLevels, highlight],
  );

  /**
   * Niveaux rappelés dans le ladder : filet coloré sur la rangée, et pastille
   * abrégée à gauche (CW2, ZG, PW…) — le nom complet reste sur le graphique.
   */
  const ladderLevels = useMemo(
    () =>
      levelsVisible
        ? overlayLevels.map((level) => ({
            price: level.price,
            rgb: level.rgb,
            label: shortLevelLabel(level.label),
          }))
        : [],
    [levelsVisible, overlayLevels],
  );

  /** Niveaux surveillés par les alertes (les murs, le flip et le max pain). */
  const alertLevels = useMemo<AlertLevel[]>(
    () =>
      bandLevels
        .filter(
          (level) => level.main || level.kind === "callWall" || level.kind === "putWall",
        )
        .map((level) => ({
          kind: level.kind,
          price: level.price,
          label: level.rank > 1 ? `${level.label} ${level.rank}` : level.label,
        })),
    [bandLevels],
  );
  const alertLevelsRef = useRef(alertLevels);

  /* ------------------------------------------------------- media / échantillons */

  useEffect(() => {
    if (typeof window === "undefined") return;
    const query = window.matchMedia("(min-width: 1024px)");
    const apply = () => setWide(query.matches);
    apply();
    query.addEventListener("change", apply);
    return () => query.removeEventListener("change", apply);
  }, []);

  /** Historique court du Net GEX pour le panneau MAX Δ GEX et la divergence. */
  type GexSample = { t: number; netGex: number; spot: number; key: string };
  const [samples, setSamples] = useState<GexSample[]>(() => [
    { t: Date.now(), netGex: snapshot.netGex, spot: snapshot.spot, key: viewKey },
  ]);

  useEffect(() => {
    let cancelled = false;
    const poll = async () => {
      try {
        const response = await fetch(
          `/api/gex/${snapshot.assetId}?filter=${snapshot.filter}`,
          { cache: "no-store" },
        );
        if (!response.ok) return;
        const next = (await response.json()) as GexSnapshot;
        if (cancelled) return;
        setSamples((previous) =>
          [
            ...previous,
            { t: Date.now(), netGex: next.netGex, spot: next.spot, key: viewKey },
          ].slice(-61),
        );
      } catch {
        // Réseau indisponible : le prochain tick réessaiera.
      }
    };
    const id = window.setInterval(poll, 60_000);
    return () => {
      cancelled = true;
      window.clearInterval(id);
    };
  }, [viewKey, snapshot.assetId, snapshot.filter]);

  // Un changement d'actif ou d'échéance repart d'un historique vierge : on ne
  // compare pas le GEX de SPX à celui de QQQ.
  const activeSamples = useMemo(
    () => samples.filter((sample) => sample.key === viewKey),
    [samples, viewKey],
  );

  const deltaRows = useMemo(() => {
    const last = activeSamples.at(-1);
    return [1, 5, 15, 30].map((minutes) => {
      if (!last || activeSamples.length < 2) {
        return { minutes, value: null as number | null };
      }
      const target = last.t - minutes * 60_000;
      let best: GexSample | null = null;
      for (const sample of activeSamples) {
        if (sample.t <= target && (!best || sample.t > best.t)) best = sample;
      }
      if (!best || Math.abs(best.t - target) > 90_000) {
        return { minutes, value: null as number | null };
      }
      return { minutes, value: last.netGex - best.netGex };
    });
  }, [activeSamples]);

  const divergence = useMemo(() => {
    const last = activeSamples.at(-1);
    if (!last) return false;
    const target = last.t - 15 * 60_000;
    const previous = activeSamples.filter((sample) => sample.t <= target).at(-1);
    if (!previous || Math.abs(previous.t - target) > 90_000) return false;
    const price = last.spot / previous.spot - 1;
    const gex = last.netGex - previous.netGex;
    if (Math.abs(price) < 0.0005 || gex === 0) return false;
    return Math.sign(price) !== Math.sign(gex);
  }, [activeSamples]);

  const writeLegend = useCallback(
    (index: number | null) => {
      const element = legendRef.current;
      if (!element) return;
      const rows = candlesRef.current;
      const candle = index !== null && rows[index] ? rows[index] : rows[rows.length - 1];
      if (!candle) return;
      const previous = rows[(index ?? rows.length - 1) - 1];
      const rising = !previous || candle.close >= previous.close;
      const color = rising ? UP : DOWN;
      element.innerHTML = `
        <span class="text-tx font-semibold">${snapshot.symbol}</span>
        <span class="text-tx2">${interval}</span>
        <span class="text-tx2">O</span> <span style="color:${color}">${fmt(candle.open, decimals)}</span>
        <span class="text-tx2">H</span> <span style="color:${color}">${fmt(candle.high, decimals)}</span>
        <span class="text-tx2">L</span> <span style="color:${color}">${fmt(candle.low, decimals)}</span>
        <span class="text-tx2">C</span> <span style="color:${color}">${fmt(candle.close, decimals)}</span>
      `;
    },
    [decimals, interval, snapshot.symbol],
  );

  /* ---------------------------------------------------------- pont ATAS */

  /** Met à jour l'étiquette d'état sans relancer un rendu par tick. */
  const noteAtas = useCallback((period: number | null, plan: AggregationPlan) => {
    const mismatch = plan.kind === "mismatch" ? plan.reason : null;
    setAtas((previous) =>
      previous.period === period && previous.mismatch === mismatch
        ? previous
        : { ...previous, period, mismatch },
    );
  }, []);

  const noteAtasStatus = useCallback((status: AtasStatus) => {
    setAtas((previous) =>
      previous.status === status ? previous : { ...previous, status },
    );
  }, []);

  /** Repart de l'historique serveur, sans aucune bougie du pont. */
  const resetAtasToBase = useCallback(() => {
    const series = candleRef.current;
    if (!series) return;
    candlesRef.current = baseCandlesRef.current;
    series.setData(toCandles(baseCandlesRef.current));
    volumeRef.current?.setData(toVolume(baseCandlesRef.current));
    writeLegend(null);
  }, [writeLegend]);

  /**
   * Snapshot du pont : on repart de l'historique serveur puis on fusionne.
   * Un seul `setData`, jamais une suite d'`update` sur des bougies anciennes
   * (c'est ce qui déclenchait « Cannot update oldest data »).
   */
  const applyAtasSnapshot = useCallback(
    (bars: readonly Candle[], period: number | null) => {
      const series = candleRef.current;
      if (!series) return;
      const step = INTERVAL_MS[interval] / 1000;
      const plan = planAggregation(period, step);
      noteAtas(period, plan);
      if (plan.kind === "mismatch") {
        resetAtasToBase();
        return;
      }
      const source =
        plan.kind === "aggregate" ? aggregateBars(bars, plan.from, step) : bars;
      // Le pont est la source de vérité sur la plage qu'il couvre : on retire
      // les bougies serveur de cette plage (leurs bornes horaires diffèrent
      // souvent de celles d'ATAS), puis on fusionne. Sans cela, deux bougies
      // se disputent la même heure et la dernière reste celle de Yahoo.
      const bridgeStart = source[0]?.time;
      const base =
        bridgeStart === undefined
          ? baseCandlesRef.current
          : baseCandlesRef.current.filter((bar) => bar.time < bridgeStart);
      const merged = mergeBridgeBars(base, source);
      candlesRef.current = merged.candles;
      series.setData(toCandles(merged.candles));
      volumeRef.current?.setData(toVolume(merged.candles));
      writeLegend(null);
    },
    [interval, noteAtas, resetAtasToBase, writeLegend],
  );

  /** Applique les bougies en attente, au plus une fois par frame. */
  const flushAtas = useCallback(() => {
    atasRafRef.current = 0;
    const pending = atasPendingRef.current;
    atasPendingRef.current = [];
    const series = candleRef.current;
    if (!series || pending.length === 0) return;

    const current = candlesRef.current;
    const merged = mergeBridgeBars(current, pending);
    if (merged.candles === current) return;
    const previousLast = current[current.length - 1]?.time ?? 0;
    candlesRef.current = merged.candles;

    // Une bougie ajoutée (snapshot, rattrapage) ou une correction ancienne
    // impose de reconstruire la série ; un simple tick met à jour la dernière.
    if (merged.added > 0 || merged.prepended || merged.olderCorrections > 0) {
      const range = chartRef.current?.timeScale().getVisibleLogicalRange();
      series.setData(toCandles(merged.candles));
      volumeRef.current?.setData(toVolume(merged.candles));
      if (merged.prepended && range) {
        chartRef.current?.timeScale().setVisibleLogicalRange({
          from: range.from + merged.added,
          to: range.to + merged.added,
        });
      }
    } else {
      const last = merged.candles[merged.candles.length - 1];
      if (last && last.time >= previousLast) {
        series.update({
          time: last.time as Time,
          open: last.open,
          high: last.high,
          low: last.low,
          close: last.close,
        });
        volumeRef.current?.update({
          time: last.time as Time,
          value: last.volume,
          color: last.close >= last.open ? "rgba(14,203,129,.38)" : "rgba(246,70,93,.38)",
        });
      }
    }
    writeLegend(null);

    const last = merged.candles[merged.candles.length - 1];
    if (last && last.close !== alertPriceRef.current) {
      bandsRef.current?.notifyPrice(last.close);
      const alert = detectLevelAlert({
        previous: alertPriceRef.current,
        price: last.close,
        now: Date.now(),
        levels: alertLevelsRef.current,
        memory: alertMemoryRef.current,
      });
      if (alert) onAlertRef.current?.(alert);
      alertPriceRef.current = last.close;
    }
  }, [writeLegend]);

  const queueAtas = useCallback(
    (bars: readonly Candle[]) => {
      if (bars.length === 0) return;
      atasPendingRef.current.push(...bars);
      if (atasRafRef.current !== 0) return;
      atasRafRef.current = requestAnimationFrame(flushAtas);
    },
    [flushAtas],
  );

  /**
   * Réception du pont. En agrégation, on recalcule à partir de **toutes** les
   * bougies brutes : une seule bougie 1m ne suffit pas à décrire un bucket 5m.
   */
  const handleAtasEvent = useCallback(
    (event: AtasEvent) => {
      const step = INTERVAL_MS[interval] / 1000;

      if (event.type === "snapshot") {
        atasRawRef.current = new Map(event.bars.map((bar) => [bar.time, bar]));
        atasPeriodRef.current = event.period;
        applyAtasSnapshot(event.bars, event.period);
        return;
      }

      const periodChanged =
        event.period !== null &&
        atasPeriodRef.current !== null &&
        event.period !== atasPeriodRef.current;
      if (periodChanged) {
        // ATAS a changé d'unité de temps : les bougies accumulées ne sont plus
        // comparables. On repart du serveur et du nouveau flux.
        atasRawRef.current = new Map([[event.bar.time, event.bar]]);
        atasPeriodRef.current = event.period;
        applyAtasSnapshot([event.bar], event.period);
        return;
      }

      if (event.period !== null) atasPeriodRef.current = event.period;
      atasRawRef.current.set(event.bar.time, event.bar);
      const plan = planAggregation(atasPeriodRef.current, step);
      noteAtas(atasPeriodRef.current, plan);
      if (plan.kind === "mismatch") return;

      const raw = [...atasRawRef.current.values()];
      const source =
        plan.kind === "aggregate" ? aggregateBars(raw, plan.from, step) : raw;
      queueAtas(source);
    },
    [applyAtasSnapshot, interval, noteAtas, queueAtas],
  );

  // Le hook garde ce callback dans une ref : changer d'unité de temps ne
  // provoque ni reconnexion ni nouvelle poignée de main.
  useAtasLive(atasSymbol, handleAtasEvent, noteAtasStatus);

  // Rejoue le tampon brut après un rechargement serveur (timeframe, symbole).
  useEffect(() => {
    reapplyAtasRef.current = () => {
      if (atasRawRef.current.size === 0) return;
      applyAtasSnapshot([...atasRawRef.current.values()], atasPeriodRef.current);
    };
  });

  /**
   * Charge la fenêtre précédente et la préfixe, sans déplacer la vue.
   *
   * Le défilement vers la gauche déclenche l'appel ; `setData` reconstruit la
   * série, donc on rétablit la plage logique décalée du nombre de bougies
   * ajoutées pour que les bougies affichées restent les mêmes.
   */
  const loadOlder = useCallback(() => {
    const state = historyRef.current;
    if (state.loading || state.exhausted || candlesRef.current.length === 0) return;
    const now = Date.now();
    if (now - state.lastAttempt < 1_500) return;

    const oldest = candlesRef.current[0].time * 1000;
    if (oldest <= now - 730 * 86_400_000 || candlesRef.current.length >= MAX_BARS) {
      state.exhausted = true;
      return;
    }

    const generation = state.generation;
    state.loading = true;
    state.lastAttempt = now;
    setLoadingState({ key: viewKey, loading: true });
    const url =
      `/api/candles/${snapshot.assetId}?interval=${encodeURIComponent(interval)}` +
      `&hours=${WINDOW_HOURS[interval]}&to=${oldest - 1}`;

    fetch(url)
      .then((response) => {
        if (response.ok) return response.json() as Promise<{ candles?: Candle[] }>;
        // 404 = le fournisseur n'a rien avant cette date (limite d'historique
        // Yahoo en intraday, par exemple) : inutile de redemander.
        const error = new Error(String(response.status));
        if (response.status === 404) {
          (error as Error & { exhausted?: boolean }).exhausted = true;
        }
        throw error;
      })
      .then((payload: { candles?: Candle[] }) => {
        // Un changement d'unité de temps ou d'actif entre-temps rend la réponse
        // obsolète : on ne mélange pas deux fenêtres.
        if (historyRef.current.generation !== generation) return;
        const merged = mergeOlderCandles(candlesRef.current, payload.candles ?? []);
        if (merged.added === 0) {
          state.exhausted = true;
          return;
        }
        state.exhausted = merged.exhausted;

        const range = chartRef.current?.timeScale().getVisibleLogicalRange();
        candlesRef.current = merged.candles;
        candleRef.current?.setData(toCandles(merged.candles));
        volumeRef.current?.setData(toVolume(merged.candles));
        if (range) {
          chartRef.current?.timeScale().setVisibleLogicalRange({
            from: range.from + merged.added,
            to: range.to + merged.added,
          });
        }
      })
      .catch((error: unknown) => {
        if ((error as { exhausted?: boolean }).exhausted) {
          state.exhausted = true;
          return;
        }
        // Réseau indisponible : on autorise une nouvelle tentative au prochain
        // défilement, sans marquer l'historique comme épuisé.
        state.lastAttempt = 0;
      })
      .finally(() => {
        if (historyRef.current.generation !== generation) return;
        state.loading = false;
        setLoadingState((previous) =>
          previous.key === viewKey ? { key: viewKey, loading: false } : previous,
        );
      });
  }, [interval, snapshot.assetId, viewKey]);

  // Les gestionnaires enregistrés une seule fois (crosshair, plage visible,
  // flux temps réel) lisent ces refs : on les synchronise **après** le rendu,
  // les règles React interdisant d'écrire une ref pendant le rendu. Une frame
  // de retard au pire, jamais de valeur perdue.
  useEffect(() => {
    legendWriterRef.current = writeLegend;
    loadOlderRef.current = loadOlder;
    alertLevelsRef.current = alertLevels;
    onAlertRef.current = onAlert;
  });

  /* --------------------------------------------------------- init graphique */

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    const chart = createChart(container, {
      autoSize: true,
      layout: {
        background: { type: ColorType.Solid, color: "transparent" },
        textColor: "#8B97AD",
        fontFamily: '"JetBrains Mono", ui-monospace, Menlo, Consolas, monospace',
        fontSize: 11,
        // Attribution TradingView (Apache-2.0) : conservée volontairement.
        attributionLogo: true,
      },
      grid: {
        vertLines: { color: "rgba(160,185,230,.05)" },
        horzLines: { color: "rgba(160,185,230,.055)" },
      },
      // L'échelle de droite reste visible : c'est la colonne de prix du
      // graphique (graduations + dernier prix). Le ladder à côté écrit des
      // STRIKES, pas des prix — les deux colonnes ne doublonnent donc rien.
      rightPriceScale: {
        visible: true,
        borderColor: "rgba(160,185,230,.14)",
        scaleMargins: { top: 0.14, bottom: 0.12 },
        // Une largeur minimale évite que « 30 150,00 » soit tronqué au bord
        // du canevas.
        minimumWidth: 64,
        entireTextOnly: true,
      },
      timeScale: {
        borderColor: "rgba(160,185,230,.12)",
        timeVisible: true,
        secondsVisible: false,
        rightOffset: 3,
        // Sans borne gauche, un défilement latéral sort du jeu de données et
        // laisse l'utilisateur devant un canevas vide ; l'historique se charge
        // en butée gauche, la vue ne bouge donc plus.
        //
        // On ne fixe **pas** le bord droit : `fixRightEdge` ramène `rightOffset`
        // à 0 et la dernière bougie se retrouve dessinée sous l'échelle des
        // prix (centre au-delà de la zone traçable) — elle paraît absente.
        fixLeftEdge: true,
        fixRightEdge: false,
      },
      crosshair: {
        mode: CrosshairMode.Normal,
        vertLine: {
          color: "rgba(255,255,255,.28)",
          width: 1,
          style: LineStyle.Dashed,
          labelBackgroundColor: "#2b3448",
        },
        horzLine: {
          color: "rgba(255,255,255,.28)",
          width: 1,
          style: LineStyle.Dashed,
          labelBackgroundColor: "#2b3448",
        },
      },
      localization: {
        locale: "fr-FR",
        priceFormatter: (price: number) => fmt(price, decimals),
      },
    });

    const candleSeries = chart.addSeries(CandlestickSeries, {
      upColor: UP,
      downColor: DOWN,
      borderUpColor: UP,
      borderDownColor: DOWN,
      wickUpColor: UP,
      wickDownColor: DOWN,
      priceFormat: { type: "price", precision: decimals, minMove: 1 / 10 ** decimals },
      // Ligne du prix en cours : elle traverse le graphique et son prix
      // s'écrit dans une case colorée sur l'axe. C'est le repère de lecture
      // principal (dernier tick pour BTC/ETH, dernière clôture sinon).
      priceLineVisible: true,
      priceLineColor: "rgba(230,236,245,.55)",
      priceLineWidth: 1,
      priceLineStyle: LineStyle.Dashed,
      lastValueVisible: true,
    });

    const volumeSeries = chart.addSeries(
      HistogramSeries,
      {
        priceFormat: { type: "volume" },
        priceScaleId: "",
        lastValueVisible: false,
        priceLineVisible: false,
      },
      1,
    );
    volumeSeries.priceScale().applyOptions({ scaleMargins: { top: 0.2, bottom: 0 } });
    chart.panes()[1]?.setHeight(64);

    const primitive = new GexBandsPrimitive(bandLevels);
    candleSeries.attachPrimitive(primitive);

    const reduced =
      typeof window !== "undefined" &&
      window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    primitive.setOptions({
      reducedMotion: reduced,
      spot: snapshot.spot,
      decimals,
      labels: false,
      // Le nom ET le prix vivent dans la pastille (`LevelTags`) : une seule
      // occurrence par niveau, pas de case de prix séparée sur l'axe.
      axisTags: false,
    });

    chart.subscribeCrosshairMove((param) => {
      const data = param.time
        ? (param.seriesData.get(candleSeries) as CandlestickData<Time> | undefined)
        : undefined;
      if (!data) {
        legendWriterRef.current(null);
        return;
      }
      const index = candlesRef.current.findIndex(
        (candle) => (candle.time as number) === (data.time as number),
      );
      legendWriterRef.current(index >= 0 ? index : null);
    });

    chartRef.current = chart;
    candleRef.current = candleSeries;
    volumeRef.current = volumeSeries;
    bandsRef.current = primitive;
    setApis({ chart, series: candleSeries });

    candleSeries.setData(toCandles(candlesRef.current));
    volumeSeries.setData(toVolume(candlesRef.current));
    // Le panneau latéral modifie la largeur juste après le montage : on
    // refitte sur la frame suivante pour éviter une plage horaire trop large.
    // La frame est annulée au démontage : sinon elle repeint un graphique déjà
    // détruit ("Object is disposed" dans fancy-canvas).
    let fitFrame = 0;
    fitFrame = requestAnimationFrame(() => {
      chart.timeScale().fitContent();
      writeLegend(null);
    });

    return () => {
      cancelAnimationFrame(fitFrame);
      primitive.detached();
      // Coupe le ResizeObserver avant la destruction : une frame de peinture
      // déclenchée par un dernier redimensionnement repeignait l'axe du
      // graphique déjà détruit (« Object is disposed » dans la console).
      try {
        chart.applyOptions({ autoSize: false });
      } catch {
        // Instance déjà détruite par un autre chemin de démontage.
      }
      chart.remove();
      setApis(null);
      chartRef.current = null;
      candleRef.current = null;
      volumeRef.current = null;
      bandsRef.current = null;
    };
    // Création unique : les mises à jour passent par les effets suivants.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /* ------------------------------------------------------------- données */

  useEffect(() => {
    if (candles === candlesRef.current) return;
    baseCandlesRef.current = candles;
    candlesRef.current = candles;
    candleRef.current?.setData(toCandles(candles));
    volumeRef.current?.setData(toVolume(candles));
    // Nouvelle fenêtre serveur (unité de temps, actif) : réapplique le tampon
    // du pont. Sans cela, le passage 1m → 5m effacerait les bougies live.
    reapplyAtasRef.current();
    const frame = requestAnimationFrame(() => {
      chartRef.current?.timeScale().fitContent();
      writeLegend(null);
    });
    return () => cancelAnimationFrame(frame);
  }, [candles, writeLegend]);

  /* ----------------------------------------------- historique au défilement */

  useEffect(() => {
    const chart = chartRef.current;
    const container = containerRef.current;
    if (!chart || !container) return;
    const timeScale = chart.timeScale();
    const arm = () => {
      armedRef.current = true;
      // En butée gauche (`fixLeftEdge`), le défilement ne modifie plus la
      // plage visible : aucun `visibleLogicalRangeChange` n'est émis et
      // l'historique ne se chargerait jamais. C'est donc le geste qui
      // déclenche la vérification ; `loadOlder` s'auto-limite (1,5 s).
      const range = timeScale.getVisibleLogicalRange();
      if (range && range.from <= 2) loadOlderRef.current();
    };
    const onRange = (range: LogicalRange | null) => {
      if (!range || !armedRef.current) return;
      if (range.from <= 2) loadOlderRef.current();
    };
    timeScale.subscribeVisibleLogicalRangeChange(onRange);
    container.addEventListener("wheel", arm, { passive: true });
    container.addEventListener("pointerdown", arm);
    container.addEventListener("touchstart", arm, { passive: true });
    return () => {
      timeScale.unsubscribeVisibleLogicalRangeChange(onRange);
      container.removeEventListener("wheel", arm);
      container.removeEventListener("pointerdown", arm);
      container.removeEventListener("touchstart", arm);
    };
  }, []);

  useEffect(() => {
    historyRef.current = {
      ...historyRef.current,
      loading: false,
      exhausted: false,
      lastAttempt: 0,
      generation: historyRef.current.generation + 1,
    };
    armedRef.current = false;
  }, [candles, interval, snapshot.assetId]);

  /* ------------------------------------------------------------- niveaux */

  useEffect(() => {
    const primitive = bandsRef.current;
    if (!primitive) return;
    primitive.setLevels(bandLevels);
    primitive.setOptions({
      spot: snapshot.spot,
      decimals,
      visible: levelsVisible,
      // Sur grand écran, le nom du niveau vient de la pastille DOM (`LevelTags`) ;
      // sur mobile, cette pastille est masquée et le nom dessiné sur la bande
      // chevauchait la légende OHLC → les niveaux se lisent sur l'axe.
      labels: false,
      // Desktop : le prix est écrit DANS la pastille du niveau, la case de
      // l'axe le répéterait. Mobile : la pastille DOM est masquée, l'axe est
      // alors le seul endroit lisible.
      axisTags: !wide,
      // Desktop : les pastilles sont en DOM (`LevelTags`) → le canvas n'en
      // dessine aucune, sinon deux étiquettes se chevauchent au même bord.
      inlineTags: !wide,
      profile: snapshot.sessionProfile,
    });
  }, [
    bandLevels,
    decimals,
    levelsVisible,
    snapshot.sessionProfile,
    snapshot.spot,
    wide,
    zoneLabels,
  ]);

  useEffect(() => {
    bandsRef.current?.setOptions({ highlight });
  }, [highlight]);

  useEffect(() => {
    if (typeof window === "undefined") return;
    const query = window.matchMedia("(prefers-reduced-motion: reduce)");
    const apply = () => bandsRef.current?.setReducedMotion(query.matches);
    query.addEventListener("change", apply);
    return () => query.removeEventListener("change", apply);
  }, []);

  /* --------------------------------------------- unités de prix (GC → ES) */

  useEffect(() => {
    const series = candleRef.current;
    if (!series) return;
    series.applyOptions({
      priceFormat: {
        type: "price",
        precision: decimals,
        minMove: 1 / 10 ** decimals,
      },
    });
    chartRef.current?.applyOptions({
      localization: {
        locale: "fr-FR",
        priceFormatter: (price: number) => fmt(price, decimals),
      },
    });
    bandsRef.current?.setOptions({ decimals });
  }, [decimals]);

  /* --------------------------------- niveaux de séance + range implicite IV */

  useEffect(() => {
    const series = candleRef.current;
    if (!series) return;
    for (const line of overlayLinesRef.current) series.removePriceLine(line);
    overlayLinesRef.current = [];
    if (!levelsVisible) return;

    const move = snapshot.expectedMove;
    if (move && move.points > 0) {
      const steps: readonly [number, number][] = [
        [1, 0.3],
        [1.2816, 0.2],
      ];
      for (const [multiplier, alpha] of steps) {
        for (const sign of [-1, 1]) {
          overlayLinesRef.current.push(
            series.createPriceLine({
              price: snapshot.spot + sign * multiplier * move.points,
              color: `rgba(160,185,230,${alpha})`,
              lineWidth: 1,
              lineStyle: LineStyle.Dotted,
              axisLabelVisible: false,
              title: `${sign > 0 ? "+" : "−"}${multiplier === 1 ? "68" : "80"}%`,
            }),
          );
        }
      }
    }

    return () => {
      for (const line of overlayLinesRef.current) series.removePriceLine(line);
      overlayLinesRef.current = [];
    };
  }, [levelsVisible, snapshot.expectedMove, snapshot.spot, wide]);

  /* --------------------------------------------------------- temps réel WS */

  const currency =
    snapshot.assetId === "BTC"
      ? "btc_usd"
      : snapshot.assetId === "ETH"
        ? "eth_usd"
        : null;

  useDeribitPriceIndex(
    currency,
    (price) => {
      // Une seule application par frame : ni setState, ni re-render React.
      if (rafRef.current) return;
      rafRef.current = requestAnimationFrame(() => {
        rafRef.current = 0;
        const series = candleRef.current;
        if (!series) return;
        // Rollover : une nouvelle bougie doit s'ouvrir au franchissement de
        // l'intervalle, sinon la dernière bougie absorbe toute la séance.
        const tick = applyPriceTick(candlesRef.current, price, interval, Date.now());
        if (tick.candles !== candlesRef.current) {
          candlesRef.current = tick.candles;
          const updated = tick.candles[tick.candles.length - 1];
          series.update({
            time: updated.time as Time,
            open: updated.open,
            high: updated.high,
            low: updated.low,
            close: updated.close,
          });
          if (tick.rolled) {
            // Le panneau volume doit rester aligné sur les bougies.
            volumeRef.current?.update({
              time: updated.time as Time,
              value: updated.volume,
              color: "rgba(14,203,129,.38)",
            });
          }
        }
        bandsRef.current?.notifyPrice(price);
        const alert = detectLevelAlert({
          previous: alertPriceRef.current,
          price,
          now: Date.now(),
          levels: alertLevelsRef.current,
          memory: alertMemoryRef.current,
        });
        if (alert) onAlertRef.current?.(alert);
        alertPriceRef.current = price;
        if (priceTagRef.current) priceTagRef.current.textContent = fmt(price, decimals);
        if (statusRef.current) statusRef.current.dataset.live = "1";
      });
    },
    (status) => {
      if (!statusRef.current) return;
      statusRef.current.dataset.status = status;
    },
  );

  useEffect(
    () => () => {
      cancelAnimationFrame(rafRef.current);
      cancelAnimationFrame(atasRafRef.current);
    },
    [],
  );

  /* --------------------------------------------------------------- rendu */

  const ivRange = snapshot.expectedMove
    ? {
        low: snapshot.spot - snapshot.expectedMove.points,
        high: snapshot.spot + snapshot.expectedMove.points,
        low80: snapshot.spot - snapshot.expectedMove.points * 1.2816,
        high80: snapshot.spot + snapshot.expectedMove.points * 1.2816,
      }
    : null;

  return (
    <div className="relative h-full w-full">
      <div
        ref={containerRef}
        className="absolute inset-y-0 left-0 right-0 lg:right-[var(--ladder-w)]"
      />

      {/* Pastilles de niveaux contre l'axe des prix (le prix du niveau, lui,
          est dessiné sur l'axe par la primitive). */}
      {apis && (
        <div className="pointer-events-none absolute inset-y-0 left-0 right-0 z-20 hidden lg:block lg:right-[var(--ladder-w)]">
          <LevelTags
            chart={apis.chart}
            series={apis.series}
            levels={overlayLevels}
            decimals={ladderDecimals}
            visible={zoneLabels && levelsVisible}
          />
        </div>
      )}

      {apis && (
        <div className="absolute inset-y-0 right-0 z-10 hidden lg:block">
          <StrikeLadder
            rows={ladder}
            spot={snapshot.spot}
            decimals={decimals}
            highlightPrice={highlightPrice}
            levelPrices={ladderLevels}
          />
        </div>
      )}

      {apis && (
        <DrawingLayer
          key={viewKey}
          chart={apis.chart}
          series={apis.series}
          assetId={snapshot.assetId}
          interval={interval}
          decimals={decimals}
          open={toolsOpen}
        />
      )}

      {/* Légende OHLC + contexte : mise à jour directe dans le DOM. Sous
          `lg`, la barre d'outils occupe le haut : la légende descend d'une
          ligne au lieu de passer dessous. */}
      <div className="pointer-events-none absolute top-2.5 left-3.5 z-10 max-w-[calc(100%-210px)] font-mono text-[11px] max-lg:top-11 max-lg:max-w-[calc(100%-140px)] lg:max-w-[calc(100%_-_var(--ladder-w)_-_250px)]">
        <div ref={legendRef} className="flex flex-wrap items-center gap-1.5" />
        <div className="mt-1.5 flex flex-wrap items-center gap-1.5 text-[10px] text-tx2">
          {snapshot.proxy && (
            <span className="rounded-[10px] border border-line bg-surface px-1.5 py-px">
              {snapshot.proxy.underlyingId} <span aria-hidden="true">→</span>{" "}
              <b className="text-tx">{snapshot.symbol}</b>
            </span>
          )}
          <span className="inline-flex items-center gap-1.5 rounded-[10px] border border-line bg-surface px-1.5 py-px">
            Net GEX <b className="num text-zero">{fmtGex(snapshot.netGex)}</b>
          </span>
          <span
            className={`rounded-[10px] border border-line bg-surface px-1.5 py-px font-semibold ${
              snapshot.regime === "long" ? "text-call" : "text-put"
            }`}
            title={tr.chart.delta.filterHint}
          >
            {snapshot.regime === "long" ? tr.regime.long : tr.regime.short}
            {snapshot.filter !== "ALL" && (
              <span className="ml-1 font-normal text-tx2">· {snapshot.filter}</span>
            )}
          </span>
          <span className="rounded-[10px] border border-line bg-surface px-1.5 py-px">
            <span className="num text-tx">{ladder.length}</span> {tr.chart.ladder.strikes}
          </span>
          {ivRange && (
            <span
              className="rounded-[10px] border border-line bg-surface px-1.5 py-px"
              title={`68 % : ${fmt(ivRange.low, decimals)} – ${fmt(ivRange.high, decimals)} · 80 % : ${fmt(ivRange.low80, decimals)} – ${fmt(ivRange.high80, decimals)}`}
            >
              {tr.chart.range.iv} 68 %{" "}
              <b className="num text-tx">
                {fmt(ivRange.low, decimals)} – {fmt(ivRange.high, decimals)}
              </b>
            </span>
          )}
          {divergence && (
            <span
              className="rounded-[10px] border border-put/40 bg-put/10 px-1.5 py-px font-semibold text-put"
              title={tr.chart.delta.divergenceHint}
            >
              ⚠ {tr.chart.delta.divergence}
            </span>
          )}
        </div>
      </div>

      {/* MAX Δ GEX : échantillonné une fois par minute depuis l'API. Sous la
          légende (qui occupe deux à trois lignes selon la largeur du panneau). */}
      <div className="pointer-events-none absolute top-[86px] left-3.5 z-10 w-[172px] rounded-md border border-line bg-surface/75 px-2 py-1.5 font-mono backdrop-blur max-lg:hidden">
        <div className="mb-1 flex items-center justify-between gap-2 text-[9px] tracking-[0.06em] text-tx2 uppercase">
          <span>{tr.chart.delta.title}</span>
          <b className="num text-tx">{fmtGexCompact(snapshot.netGex)}</b>
        </div>
        {deltaRows.map((row) => (
          <div
            key={row.minutes}
            className="flex items-center justify-between text-[10px]"
          >
            <span className="num text-tx2">{row.minutes}m</span>
            <span
              className={`num ${
                row.value === null
                  ? "text-tx2"
                  : row.value >= 0
                    ? "text-call"
                    : "text-put"
              }`}
            >
              {row.value === null ? "—" : fmtGexCompact(row.value)}
            </span>
          </div>
        ))}
      </div>

      {loadingOlder && (
        <span className="num pointer-events-none absolute bottom-[118px] left-3 z-10 rounded-md border border-line bg-surface px-2 py-1 text-[10px] text-tx2 backdrop-blur">
          {tr.chart.loadingOlder}
        </span>
      )}

      {snapshot.contracts === 0 && (
        <div className="pointer-events-none absolute inset-x-6 top-1/2 z-10 -translate-y-1/2 text-center">
          <p className="inline-block rounded-md border border-line bg-surface/85 px-3 py-1.5 text-[11px] text-tx2 backdrop-blur">
            {tr.gex.empty.chart}
          </p>
        </div>
      )}

      <div className="absolute top-2.5 right-[92px] z-10 flex items-center gap-1.5 max-lg:top-auto max-lg:right-auto max-lg:bottom-9 max-lg:left-3 max-lg:rounded-lg max-lg:bg-bg/70 max-lg:px-1 max-lg:py-0.5 max-lg:backdrop-blur-sm lg:right-[calc(var(--ladder-w)_+_112px)]">
        <button
          type="button"
          onClick={() => setToolsOpen((value) => !value)}
          aria-pressed={toolsOpen}
          aria-label={tr.drawings.title}
          title={tr.drawings.title}
          className={`inline-flex items-center gap-1.5 rounded-md border px-2.5 py-1 text-[11px] transition-colors duration-200 ${
            toolsOpen
              ? "border-line bg-white/8 text-tx"
              : "border-transparent text-tx2 hover:bg-white/5 hover:text-tx"
          }`}
        >
          <svg
            viewBox="0 0 24 24"
            aria-hidden="true"
            className="size-3.5 fill-none stroke-current [stroke-linecap:round] [stroke-linejoin:round] [stroke-width:1.7]"
          >
            <path d="M4 20l4-1 10-10-3-3L5 16zM14 6l3 3" />
          </svg>
          {tr.drawings.open}
        </button>
        <button
          type="button"
          onClick={onToggleLevels}
          aria-pressed={levelsVisible}
          className={`rounded-md border px-2.5 py-1 text-[11px] transition-colors duration-200 ${
            levelsVisible
              ? "border-line bg-white/8 text-tx"
              : "border-transparent text-tx2 hover:bg-white/5 hover:text-tx"
          }`}
        >
          {tr.chart.levels}
        </button>
        <button
          type="button"
          onClick={() => setZoneLabels((value) => !value)}
          aria-pressed={zoneLabels}
          className={`rounded-md border px-2.5 py-1 text-[11px] transition-colors duration-200 ${
            zoneLabels
              ? "border-line bg-white/8 text-tx"
              : "border-transparent text-tx2 hover:bg-white/5 hover:text-tx"
          }`}
        >
          {tr.chart.labels}
        </button>
        <button
          type="button"
          onClick={onTogglePanel}
          aria-pressed={panelOpen}
          className={`rounded-md border px-2.5 py-1 text-[11px] transition-colors duration-200 ${
            panelOpen
              ? "border-line bg-white/8 text-tx"
              : "border-line text-tx2 hover:bg-white/5 hover:text-tx"
          }`}
        >
          {tr.chart.analysis}
        </button>
      </div>

      {currency && (
        <span className="absolute right-3 bottom-[112px] z-10 inline-flex items-center gap-1.5 rounded-md border border-line bg-surface px-2 py-1 font-mono text-[10px] text-tx2 backdrop-blur max-lg:right-auto max-lg:left-3 lg:right-[calc(var(--ladder-w)_+_112px)]">
          <i
            ref={statusRef}
            aria-hidden="true"
            className="size-1.5 rounded-full bg-tx2/40 data-[status=open]:bg-ac data-[live='1']:animate-[pulse_2s_ease-in-out_infinite]"
          />
          Deribit WS
          <b ref={priceTagRef} className="num text-tx" />
        </span>
      )}

      {atasEligible && (
        <span
          className="absolute right-3 bottom-[112px] z-10 inline-flex items-center gap-1.5 rounded-md border border-line bg-surface px-2 py-1 font-mono text-[10px] text-tx2 backdrop-blur max-lg:right-auto max-lg:left-3 lg:right-[calc(var(--ladder-w)_+_112px)]"
          title={
            atasEnabled
              ? `${tr.chart.atas.title} · ${ATAS_WS_URL}${
                  atas.mismatch
                    ? ` — ${
                        atas.mismatch === "coarser"
                          ? tr.chart.atas.mismatchCoarser
                          : atas.mismatch === "session"
                            ? tr.chart.atas.mismatchSession
                            : tr.chart.atas.mismatchRatio
                      }`
                    : ""
                }`
              : tr.chart.atas.disabledHint
          }
        >
          <i
            aria-hidden="true"
            className={`size-1.5 rounded-full ${
              !atasEnabled
                ? "bg-zero/60"
                : atas.status === "open"
                  ? "bg-ac"
                  : atas.status === "offline"
                    ? "bg-put/70"
                    : "bg-tx2/40"
            }`}
          />
          ATAS
          <b className="num text-tx">
            {!atasEnabled
              ? tr.chart.atas.disabled
              : atas.mismatch
                ? `${formatPeriod(atas.period)} ≠ ${interval}`
                : tr.chart.atas[atas.status]}
          </b>
        </span>
      )}
    </div>
  );
}
