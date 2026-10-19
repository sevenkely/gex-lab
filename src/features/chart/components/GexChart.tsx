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
  type ISeriesApi,
  type Time,
} from "lightweight-charts";
import { useCallback, useEffect, useMemo, useRef } from "react";
import { LEVEL_RGB } from "@/features/gex/components/level-style";
import type { GexLevelKind, GexSnapshot } from "@/features/gex/types";
import { fmt, fmtGex } from "@/lib/format";
import { t } from "@/lib/i18n";
import type { Candle, CandleInterval } from "@/server/providers/types";
import { useDeribitPriceIndex } from "../hooks/useDeribitSocket";
import { GexBandsPrimitive, type BandKind, type BandLevel } from "./gex-bands";

const UP = "#E6ECF5";
const DOWN = "#6F7FA3";

const BAND_LABEL: Record<BandKind, string> = {
  callWall: "Call Wall",
  putWall: "Put Wall",
  zeroGamma: "Zero Gamma",
  maxGamma: "Max Gamma",
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
    color:
      candle.close >= candle.open ? "rgba(230,236,245,.16)" : "rgba(111,127,163,.28)",
  }));
}

export function GexChart({
  snapshot,
  candles,
  interval,
  highlight,
  onHighlight,
  focus,
  onToggleFocus,
  levelsVisible,
  onToggleLevels,
}: {
  snapshot: GexSnapshot;
  candles: readonly Candle[];
  interval: CandleInterval;
  highlight: GexLevelKind | null;
  onHighlight: (kind: GexLevelKind | null) => void;
  focus: boolean;
  onToggleFocus: () => void;
  levelsVisible: boolean;
  onToggleLevels: () => void;
}) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const chartRef = useRef<IChartApi | null>(null);
  const candleRef = useRef<ISeriesApi<"Candlestick"> | null>(null);
  const volumeRef = useRef<ISeriesApi<"Histogram"> | null>(null);
  const bandsRef = useRef<GexBandsPrimitive | null>(null);
  const candlesRef = useRef<readonly Candle[]>(candles);
  const legendRef = useRef<HTMLDivElement | null>(null);
  // Le handler crosshair est enregistré une fois au montage : il doit appeler
  // la dernière version de writeLegend (sinon l'unité de temps reste figée).
  const legendWriterRef = useRef<(index: number | null) => void>(() => {});
  const priceTagRef = useRef<HTMLSpanElement | null>(null);
  const statusRef = useRef<HTMLSpanElement | null>(null);
  const rafRef = useRef(0);

  const decimals = snapshot.symbol === "BTC" || snapshot.symbol === "ETH" ? 2 : 2;
  const tr = t();

  /** Niveaux → bandes. Le max gamma est dessiné en segments discrets. */
  const bandLevels = useMemo<BandLevel[]>(() => {
    const order: GexLevelKind[] = ["callWall", "putWall", "zeroGamma", "maxGamma"];
    return order
      .map((kind) => snapshot.levels.find((level) => level.kind === kind))
      .filter((level): level is NonNullable<typeof level> => Boolean(level))
      .map((level) => ({
        kind: level.kind as BandKind,
        price: level.price,
        label: BAND_LABEL[level.kind as BandKind],
        rgb: LEVEL_RGB[level.kind],
        main: level.kind !== "maxGamma",
      }));
  }, [snapshot]);

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

  legendWriterRef.current = writeLegend;

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
      rightPriceScale: {
        borderColor: "rgba(160,185,230,.12)",
        scaleMargins: { top: 0.14, bottom: 0.12 },
      },
      timeScale: {
        borderColor: "rgba(160,185,230,.12)",
        timeVisible: true,
        secondsVisible: false,
        rightOffset: 3,
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
      priceLineVisible: false,
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
    primitive.setOptions({ reducedMotion: reduced, spot: snapshot.spot, decimals });

    candleSeries.createPriceLine({
      price: snapshot.spot,
      color: "rgba(230,236,245,.32)",
      lineWidth: 1,
      lineStyle: LineStyle.Dotted,
      axisLabelVisible: false,
      title: "",
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

    candleSeries.setData(toCandles(candlesRef.current));
    volumeSeries.setData(toVolume(candlesRef.current));
    // Le panneau latéral modifie la largeur juste après le montage : on
    // refitte sur la frame suivante pour éviter une plage horaire trop large.
    requestAnimationFrame(() => {
      chart.timeScale().fitContent();
      writeLegend(null);
    });

    return () => {
      primitive.detached();
      chart.remove();
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
    candlesRef.current = candles;
    candleRef.current?.setData(toCandles(candles));
    volumeRef.current?.setData(toVolume(candles));
    requestAnimationFrame(() => {
      chartRef.current?.timeScale().fitContent();
      writeLegend(null);
    });
  }, [candles, writeLegend]);

  /* ------------------------------------------------------------- niveaux */

  useEffect(() => {
    const primitive = bandsRef.current;
    if (!primitive) return;
    primitive.setLevels(bandLevels);
    primitive.setOptions({ spot: snapshot.spot, decimals, visible: levelsVisible });
  }, [bandLevels, decimals, levelsVisible, snapshot.spot]);

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

  /* --------------------------------------------------------- temps réel WS */

  const currency =
    snapshot.assetId === "BTC" ? "btc_usd" : snapshot.assetId === "ETH" ? "eth_usd" : null;

  useDeribitPriceIndex(
    currency,
    (price) => {
      // Une seule application par frame : ni setState, ni re-render React.
      if (rafRef.current) return;
      rafRef.current = requestAnimationFrame(() => {
        rafRef.current = 0;
        const series = candleRef.current;
        if (!series) return;
        const rows = candlesRef.current;
        const last = rows[rows.length - 1];
        if (last) {
          const updated = {
            ...last,
            close: price,
            high: Math.max(last.high, price),
            low: Math.min(last.low, price),
          };
          series.update({
            time: updated.time as Time,
            open: updated.open,
            high: updated.high,
            low: updated.low,
            close: updated.close,
          });
          candlesRef.current = [...rows.slice(0, -1), updated];
        }
        bandsRef.current?.notifyPrice(price);
        if (priceTagRef.current) priceTagRef.current.textContent = fmt(price, decimals);
        if (statusRef.current) statusRef.current.dataset.live = "1";
      });
    },
    (status) => {
      if (!statusRef.current) return;
      statusRef.current.dataset.status = status;
    },
  );

  useEffect(() => () => cancelAnimationFrame(rafRef.current), []);

  /* --------------------------------------------------------------- rendu */

  const levelChips = bandLevels
    .filter((level) => level.main)
    .map((level) => (
      <span
        key={level.kind}
        className="inline-flex items-center gap-1.5 rounded-[10px] border border-line bg-surface px-1.5 py-px text-[10px] text-tx2"
      >
        <i
          aria-hidden="true"
          className="size-1.5 rounded-full"
          style={{ background: `rgb(${level.rgb})` }}
        />
        <span className="num">{fmt(level.price, decimals)}</span>
      </span>
    ));

  return (
    <div className="relative h-full w-full">
      <div ref={containerRef} className="absolute inset-0" />

      {/* Légende OHLC + GEX net : mise à jour directe dans le DOM. */}
      <div className="pointer-events-none absolute top-2.5 left-3.5 z-10 max-w-[calc(100%-340px)] font-mono text-[11px]">
        <div ref={legendRef} className="flex flex-wrap items-center gap-1.5" />
        <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
          <span className="inline-flex items-center gap-1.5 rounded-[10px] border border-line bg-surface px-1.5 py-px text-[10px] text-tx2">
            Net GEX <b className="num text-zero">{fmtGex(snapshot.netGex)}</b>
          </span>
          {levelChips}
        </div>
      </div>

      <div className="absolute top-2.5 right-[92px] z-10 flex items-center gap-1.5">
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
          onClick={() => {
            const target = bandLevels.find((level) => level.main);
            if (!target) return;
            bandsRef.current?.pulse(target.kind);
            onHighlight(target.kind);
            window.setTimeout(() => onHighlight(null), 1_200);
          }}
          className="rounded-md border border-line px-2.5 py-1 text-[11px] text-tx2 transition-colors duration-200 hover:bg-white/5 hover:text-tx"
          title="Déclenche l’animation de toucher sur le premier niveau (démonstration)"
        >
          {tr.chart.testLevel}
        </button>
        <button
          type="button"
          onClick={onToggleFocus}
          aria-pressed={focus}
          className={`rounded-md border px-2.5 py-1 text-[11px] transition-colors duration-200 ${
            focus
              ? "border-line bg-white/8 text-tx"
              : "border-line text-tx2 hover:bg-white/5 hover:text-tx"
          }`}
        >
          {tr.chart.focus}
        </button>
      </div>

      {currency && (
        <span className="absolute right-3 bottom-[112px] z-10 inline-flex items-center gap-1.5 rounded-md border border-line bg-surface px-2 py-1 font-mono text-[10px] text-tx2 backdrop-blur">
          <i
            ref={statusRef}
            aria-hidden="true"
            className="size-1.5 rounded-full bg-tx2/40 data-[status=open]:bg-ac data-[live='1']:animate-[pulse_2s_ease-in-out_infinite]"
          />
          Deribit WS
          <b ref={priceTagRef} className="num text-tx" />
        </span>
      )}
    </div>
  );
}
