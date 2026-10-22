"use client";

/**
 * Pastilles de niveaux collées à l'axe des prix.
 *
 * Pourquoi ici et pas dans le ladder : dans la référence, le nom du niveau
 * (« CALL WALL », « ZERO GAMMA »…) s'arrête net contre l'axe, et le prix du
 * niveau occupe sa propre case **sur** l'axe. La pastille appartient donc au
 * panneau du graphique, pas à la colonne des strikes.
 *
 * Positionnement : une frame planifiée à chaque changement de plage, de taille
 * ou de niveaux — pas de boucle permanente. Rien n'est rendu par React au
 * défilement : comme le ladder, le DOM n'est réécrit que si la projection
 * change.
 *
 * Un zoom vertical (molette sur le panneau, glisser sur l'axe, pincement)
 * déplace les niveaux SANS notifier le time scale : pendant un geste, et durant
 * les 400 ms qui le suivent, les pastilles sont donc repeintes à chaque frame.
 * Sans ce sursis, elles restaient figées sur l'ancienne projection jusqu'au
 * prochain défilement horizontal.
 *
 * Le graphique peut être détruit avant la frame (changement d'actif, de page) :
 * la lecture de l'échelle est donc protégée, sinon `PriceScaleApi.width()` lève
 * « Value is null » dans la console et coupe la peinture des pastilles.
 */

import type { IChartApi, ISeriesApi } from "lightweight-charts";
import { useEffect, useRef } from "react";
import { fmt } from "@/lib/format";

export interface LevelTag {
  id: string;
  label: string;
  price: number;
  rgb: string;
}

const ROW_HEIGHT = 19;
/** Hauteur d'une pastille + 2 px de respiration entre deux voisines. */
const STACK_STEP = ROW_HEIGHT + 2;
/**
 * La légende OHLC puis la barre d'outils occupent le haut du panneau : une
 * pastille qui y entrerait passerait sous les boutons. Même chose en bas avec
 * les badges ATAS / Deribit WS.
 */
const TOP_INSET = 48;
const BOTTOM_INSET = 60;
/** Durée du sursis de repeinte après un geste (zoom, pan, pincement). */
const BURST_MS = 400;

interface Slot {
  y: number;
  price: number;
  up: boolean;
  down: boolean;
}

/**
 * Répartit les pastilles sans chevauchement.
 *
 * Une pastille vise la coordonnée exacte de son niveau ; les collisions se
 * résolvent vers le bas, puis — si la pile dépasse le panneau — vers le haut,
 * ce qui garde l'ordre vertical des prix et évite la bouillie en bas d'écran.
 */
export function stackSlots(slots: readonly Slot[], top: number, bottom: number): number[] {
  const order = slots.map((slot, index) => ({ index, y: Math.min(bottom, Math.max(top, slot.y)) }));
  order.sort((a, b) => a.y - b.y || b.index - a.index);

  const placed = new Map<number, number>();
  let previous = -Infinity;
  for (const entry of order) {
    const y = Math.max(entry.y, previous + STACK_STEP);
    placed.set(entry.index, y);
    previous = y;
  }

  const last = order.at(-1);
  if (last && (placed.get(last.index) ?? 0) > bottom) {
    // La pile déborde : on la reconstruit depuis le bas du panneau, du prix le
    // plus bas vers le plus haut, pour qu'aucune pastille ne sorte de l'écran.
    let next = bottom + STACK_STEP;
    for (let i = order.length - 1; i >= 0; i--) {
      const entry = order[i];
      const y = Math.min(placed.get(entry.index) ?? entry.y, next - STACK_STEP);
      placed.set(entry.index, y);
      next = y;
    }
    const first = order[0];
    const overflow = top - (placed.get(first.index) ?? top);
    if (overflow > 0) {
      for (const entry of order) {
        placed.set(entry.index, (placed.get(entry.index) ?? entry.y) + overflow);
      }
    }
  }

  return slots.map((_, index) => placed.get(index) ?? top);
}

export function LevelTags({
  chart,
  series,
  levels,
  decimals = 2,
  visible = true,
}: {
  chart: IChartApi | null;
  series: ISeriesApi<"Candlestick"> | null;
  levels: readonly LevelTag[];
  decimals?: number;
  visible?: boolean;
}) {
  const hostRef = useRef<HTMLDivElement | null>(null);
  const tagRefs = useRef(new Map<string, HTMLSpanElement>());

  useEffect(() => {
    if (!chart || !series || !visible) return;
    let frame = 0;
    let disposed = false;
    let signature = "";
    let burstUntil = 0;

    const paint = () => {
      if (disposed || !hostRef.current) return;
      let range: { from: number; to: number } | null = null;
      let height = 0;
      let axisWidth = 0;
      try {
        const scale = series.priceScale();
        range = scale.getVisibleRange();
        height = chart.panes()[0]?.getHeight() ?? 0;
        axisWidth = scale.width();
      } catch {
        // Instance détruite entre la souscription et la frame : rien à peindre.
        return;
      }
      const next = range
        ? `${range.from}:${range.to}:${height}:${Math.round(axisWidth)}`
        : `::${height}:${Math.round(axisWidth)}`;
      if (next === signature) return;
      signature = next;

      // La pastille meurt contre l'axe des prix (2 px de respiration).
      if (hostRef.current)
        hostRef.current.style.right = `${Math.round(axisWidth) + 2}px`;

      const top = TOP_INSET;
      const bottom = Math.max(top, height - BOTTOM_INSET);

      // Coordonnées projetées, puis répartition sans chevauchement.
      const placed: (Slot & { level: LevelTag })[] = [];
      const hidden: LevelTag[] = [];
      for (const level of levels) {
        const coordinate = series.priceToCoordinate(level.price);
        if (coordinate === null) {
          hidden.push(level);
          continue;
        }
        placed.push({
          level,
          y: coordinate,
          price: level.price,
          up: range ? level.price > range.to : coordinate < top,
          down: range ? level.price < range.from : coordinate > bottom,
        });
      }
      const ys = stackSlots(placed, top, bottom);

      for (const level of hidden) {
        const element = tagRefs.current.get(level.id);
        if (!element) continue;
        element.style.opacity = "0";
        element.style.transform = "translateY(-999px)";
      }

      placed.forEach((slot, index) => {
        const element = tagRefs.current.get(slot.level.id);
        if (!element) return;
        const arrow = element.querySelector<HTMLElement>("[data-arrow]");
        if (arrow) arrow.textContent = slot.up ? "↑" : slot.down ? "↓" : "";
        element.style.opacity = "1";
        element.style.transform = `translateY(${Math.round(ys[index] - ROW_HEIGHT / 2)}px)`;
      });
    };

    const tick = () => {
      frame = 0;
      if (disposed) return;
      paint();
      if (performance.now() < burstUntil) frame = requestAnimationFrame(tick);
    };

    const schedule = () => {
      if (disposed || frame !== 0) return;
      frame = requestAnimationFrame(tick);
    };

    // Un geste sur le panneau ou l'axe peut changer l'échelle des prix sans
    // prévenir le time scale : on repeint pendant le geste et un peu après.
    const burst = (event: Event) => {
      if (event.type === "pointermove" && (event as PointerEvent).buttons === 0) return;
      burstUntil = performance.now() + BURST_MS;
      schedule();
    };
    const gestures = [
      "wheel",
      "pointerdown",
      "pointermove",
      "touchstart",
      "touchmove",
      "keydown",
    ] as const;
    for (const name of gestures) {
      window.addEventListener(name, burst, { passive: true });
    }

    // Peinture déclenchée par les changements réels du graphique, jamais par
    // une boucle au repos.
    const timeScale = chart.timeScale();
    let subscribed = true;
    try {
      timeScale.subscribeVisibleLogicalRangeChange(schedule);
      timeScale.subscribeSizeChange(schedule);
    } catch {
      subscribed = false;
    }
    schedule();
    window.addEventListener("resize", schedule);

    return () => {
      disposed = true;
      cancelAnimationFrame(frame);
      window.removeEventListener("resize", schedule);
      for (const name of gestures) {
        window.removeEventListener(name, burst);
      }
      if (!subscribed) return;
      try {
        timeScale.unsubscribeVisibleLogicalRangeChange(schedule);
        timeScale.unsubscribeSizeChange(schedule);
      } catch {
        // Le graphique a déjà été détruit avec son échelle.
      }
    };
  }, [chart, series, levels, visible]);

  if (!visible) return null;

  return (
    <div
      ref={hostRef}
      aria-hidden="true"
      className="pointer-events-none absolute inset-y-0 right-0 z-20 w-0"
    >
      {levels.map((level) => (
        <span
          key={level.id}
          ref={(element) => {
            if (element) tagRefs.current.set(level.id, element);
            else tagRefs.current.delete(level.id);
          }}
          className="absolute top-0 right-0 rounded-l-[3px] px-1.5 text-[10px] leading-[19px] font-semibold tracking-[0.02em] whitespace-nowrap opacity-0 shadow-[0_1px_6px_rgba(0,0,0,.35)]"
          style={{
            background: `rgb(${level.rgb})`,
            color: "#0b1220",
            transform: "translateY(-999px)",
          }}
        >
          <span data-arrow className="mr-0.5 inline-block" />
          {level.label}{" "}
          <span className="num font-normal">{fmt(level.price, decimals)}</span>
        </span>
      ))}
    </div>
  );
}
