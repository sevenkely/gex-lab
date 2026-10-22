"use client";

/**
 * Calque de dessin au-dessus du graphique.
 *
 * Les dessins sont stockés en coordonnées de données (temps, prix) et projetés
 * en SVG à chaque changement d'échelle : ils restent donc attachés au prix et à
 * la date, comme sur TradingView. Le calque lui-même est transparent aux
 * clics ; les gestes sont interceptés en phase de capture sur le conteneur du
 * graphique, uniquement quand un outil est actif ou qu'un dessin est visé —
 * le défilement et le zoom natifs restent intacts sinon.
 *
 * Portée : ligne horizontale, tendance, zone, texte. Chaque dessin est
 * personnalisable (couleur, épaisseur, pointillés), déplaçable, supprimable, et
 * persiste par actif + unité de temps.
 */

import type { IChartApi, ISeriesApi, Time } from "lightweight-charts";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { fmt } from "@/lib/format";
import { t } from "@/lib/i18n";
import type { CandleInterval } from "@/server/providers/types";
import {
  clampToPlot,
  createHline,
  createText,
  createTrend,
  createZone,
  decodeDrawings,
  drawingsKey,
  encodeDrawings,
  hitTest,
  lastStyle,
  nearestBarTime,
  type Anchor,
  type Drawing,
  type DrawingStyle,
  type DrawingTool,
  type Point,
  type ProjectedDrawing,
} from "../drawings";
import { DrawingToolbar } from "./DrawingToolbar";

interface DragState {
  mode: "move" | "create";
  id?: string;
  /** Ancre de départ (création) ou point de saisie (déplacement). */
  start: Anchor;
  /** Dessin d'origine, pour appliquer un delta sans dérive cumulative. */
  origin?: Drawing;
}

interface Editing {
  at: Anchor;
  value: string;
  /** Présent quand on édite un texte existant (double-clic). */
  id?: string;
}

function textWidth(text: string): number {
  return Math.min(320, Math.max(20, text.length * 6.4 + 12));
}

function anchorOfPoint(
  chart: IChartApi,
  series: ISeriesApi<"Candlestick">,
  point: Point,
): Anchor | null {
  const time = chart.timeScale().coordinateToTime(point.x);
  const price = series.coordinateToPrice(point.y);
  if (typeof time !== "number" || price === null || !(price > 0)) return null;
  return { time, price };
}

export function DrawingLayer({
  chart,
  series,
  assetId,
  interval,
  decimals,
  open,
}: {
  chart: IChartApi;
  series: ISeriesApi<"Candlestick">;
  assetId: string;
  interval: CandleInterval;
  decimals: number;
  /** Palette dépliée depuis l'en-tête du graphique. */
  open: boolean;
}) {
  const tr = t();
  const key = drawingsKey(assetId, interval);
  const [drawings, setDrawings] = useState<Drawing[]>(() => {
    if (typeof window === "undefined") return [];
    try {
      return decodeDrawings(window.localStorage.getItem(key));
    } catch {
      // Stockage indisponible (mode privé, quota) : on repart à vide.
      return [];
    }
  });
  const [style, setStyle] = useState<DrawingStyle>(() => lastStyle(drawings));
  const [tool, setTool] = useState<DrawingTool>("cursor");
  const [selected, setSelected] = useState<string | null>(null);
  const [draft, setDraft] = useState<{ tool: "trend" | "zone"; a: Anchor; b: Anchor } | null>(null);
  const [editing, setEditing] = useState<Editing | null>(null);
  // Incrémenté à chaque changement d'échelle : force la reprojection SVG.
  const [frame, setFrame] = useState(0);

  const svgRef = useRef<SVGSVGElement | null>(null);
  const dragRef = useRef<DragState | null>(null);
  const cancelEditRef = useRef(false);

  // Les écouteurs sont installés une fois : ils lisent l'état via des refs.
  const toolRef = useRef(tool);
  const styleRef = useRef(style);
  const drawingsRef = useRef(drawings);
  const draftRef = useRef(draft);
  const editingRef = useRef(editing);
  const selectedRef = useRef<string | null>(selected);
  const signatureRef = useRef("");
  const geometryRef = useRef<ProjectedDrawing[]>([]);

  /* ------------------------------------------------------------- persistance */

  useEffect(() => {
    try {
      window.localStorage.setItem(key, encodeDrawings(drawings));
    } catch {
      // Quota / mode privé : le dessin reste valable pour la session.
    }
  }, [drawings, key]);

  /* ------------------------------------------------------------- projection */

  // Horodatage → abscisse, en se rattachant à la barre la plus proche : un
  // dessin déplacé sur un week-end (indices) ou au-delà de la dernière bougie
  // doit rester visible, pas disparaître en entier.
  const xForTime = useCallback(
    (time: number): number | null => {
      const rows = series.data() as readonly { time: number }[];
      const snapped = nearestBarTime(rows, time);
      if (snapped === null) return null;
      return chart.timeScale().timeToCoordinate(snapped as Time);
    },
    [chart, series],
  );

  const projected = useMemo<ProjectedDrawing[]>(() => {
    // Dépendance volontaire : `frame` change à chaque mouvement d'échelle.
    void frame;
    const paneWidth = chart.timeScale().width();
    const result: ProjectedDrawing[] = [];
    for (const drawing of drawings) {
      if (drawing.type === "hline") {
        const y = series.priceToCoordinate(drawing.price);
        if (y === null) continue;
        result.push({ id: drawing.id, type: "hline", points: [{ x: 0, y }] });
        continue;
      }
      if (drawing.type === "text") {
        const x = xForTime(drawing.at.time);
        const y = series.priceToCoordinate(drawing.at.price);
        if (x === null || y === null) continue;
        result.push({
          id: drawing.id,
          type: "text",
          points: [{ x: clampToPlot(x, paneWidth), y }],
          box: { width: textWidth(drawing.text), height: 16 },
        });
        continue;
      }
      const ax = xForTime(drawing.a.time);
      const bx = xForTime(drawing.b.time);
      const ay = series.priceToCoordinate(drawing.a.price);
      const by = series.priceToCoordinate(drawing.b.price);
      if (ax === null || bx === null || ay === null || by === null) continue;
      result.push({
        id: drawing.id,
        type: drawing.type,
        points: [
          { x: clampToPlot(ax, paneWidth), y: ay },
          { x: clampToPlot(bx, paneWidth), y: by },
        ],
      });
    }
    return result;
    // `frame` matérialise un déplacement d'échelle (pan, zoom, redimensionnement).
  }, [drawings, chart, series, frame, xForTime]);

  useEffect(() => {
    toolRef.current = tool;
    styleRef.current = style;
    drawingsRef.current = drawings;
    draftRef.current = draft;
    editingRef.current = editing;
    selectedRef.current = selected;
    geometryRef.current = projected;
  });

  /* ---------------------------------------------------------------- actions */

  const applyStyle = useCallback(
    (patch: Partial<DrawingStyle>) => {
      const next: DrawingStyle = { ...styleRef.current, ...patch };
      styleRef.current = next;
      setStyle(next);
      if (!selected) return;
      setDrawings((list) =>
        list.map((item) => (item.id === selected ? { ...item, style: next } : item)),
      );
    },
    [selected],
  );

  const remove = useCallback((id: string) => {
    setDrawings((list) => list.filter((item) => item.id !== id));
    setSelected((current) => (current === id ? null : current));
  }, []);

  const add = useCallback((drawing: Drawing) => {
    setDrawings((list) => [...list, drawing]);
    setSelected(drawing.id);
  }, []);

  /* -------------------------------------------------------------- écouteurs */

  useEffect(() => {
    const host = svgRef.current?.parentElement;
    if (!host) return;

    const bump = () => setFrame((value) => value + 1);

    const pointOf = (clientX: number, clientY: number): Point => {
      const rect = host.getBoundingClientRect();
      return { x: clientX - rect.left, y: clientY - rect.top };
    };

    const anchorAt = (point: Point): Anchor | null => anchorOfPoint(chart, series, point);

    const onDown = (event: PointerEvent) => {
      if (event.button !== 0) return;
      // Boutons, barre d'outils, champ de texte : jamais un geste de dessin.
      if (!(event.target as Element | null)?.closest?.("canvas")) return;
      const point = pointOf(event.clientX, event.clientY);
      const paneWidth = chart.timeScale().width();
      // Échelle des prix / axe du temps : jamais de dessin dessus.
      if (point.x > paneWidth) return;
      const currentTool = toolRef.current;

      if (currentTool === "erase") {
        const id = hitTest(geometryRef.current, point);
        if (id) {
          remove(id);
          event.preventDefault();
          event.stopPropagation();
        }
        return;
      }

      if (currentTool !== "cursor") {
        // Un outil actif prend la main : le graphique ne doit pas se déplacer.
        event.preventDefault();
        event.stopPropagation();
      }

      const anchor = anchorAt(point);
      if (currentTool === "hline") {
        if (anchor) add(createHline(anchor.price, styleRef.current));
        setTool("cursor");
        return;
      }
      if (currentTool === "text") {
        if (anchor) setEditing({ at: anchor, value: "" });
        setTool("cursor");
        return;
      }
      if (currentTool === "trend" || currentTool === "zone") {
        if (!anchor) return;
        dragRef.current = { mode: "create", start: anchor };
        setDraft({ tool: currentTool, a: anchor, b: anchor });
        return;
      }

      // Sélection / déplacement.
      const id = hitTest(geometryRef.current, point);
      if (!id) {
        setSelected(null);
        return;
      }
      setSelected(id);
      const origin = drawingsRef.current.find((item) => item.id === id);
      if (!origin || !anchor) return;
      event.preventDefault();
      event.stopPropagation();
      dragRef.current = { mode: "move", id, start: anchor, origin };
    };

    const onMove = (event: PointerEvent) => {
      const drag = dragRef.current;
      if (!drag) return;
      const point = pointOf(event.clientX, event.clientY);
      const anchor = anchorAt(point);
      if (!anchor) return;

      if (drag.mode === "create") {
        // Mise à jour immédiate de la ref : le `pointerup` peut arriver avant
        // le rendu suivant, il doit voir le dernier point.
        const current = draftRef.current;
        if (!current) return;
        const next = { ...current, b: anchor };
        draftRef.current = next;
        setDraft(next);
        return;
      }

      // Déplacement par delta : aucune dérive cumulative, même sur un long drag.
      const deltaTime = anchor.time - drag.start.time;
      const deltaPrice = anchor.price - drag.start.price;
      const origin = drag.origin;
      if (!origin) return;
      setDrawings((list) =>
        list.map((item) => {
          if (item.id !== drag.id) return item;
          if (origin.type === "hline") {
            return { ...origin, price: Math.max(0.01, origin.price + deltaPrice) };
          }
          if (origin.type === "text") {
            return {
              ...origin,
              at: {
                time: origin.at.time + deltaTime,
                price: Math.max(0.01, origin.at.price + deltaPrice),
              },
            };
          }
          return {
            ...origin,
            a: {
              time: origin.a.time + deltaTime,
              price: Math.max(0.01, origin.a.price + deltaPrice),
            },
            b: {
              time: origin.b.time + deltaTime,
              price: Math.max(0.01, origin.b.price + deltaPrice),
            },
          };
        }),
      );
    };

    const onUp = () => {
      const drag = dragRef.current;
      dragRef.current = null;
      if (!drag) return;
      if (drag.mode === "create") {
        const current = draftRef.current;
        setDraft(null);
        if (!current) return;
        const a = current.a;
        const b = current.b;
        // Un simple clic ne crée pas de tendance ni de zone dégénérée.
        const ax = chart.timeScale().timeToCoordinate(a.time as Time) ?? 0;
        const bx = chart.timeScale().timeToCoordinate(b.time as Time) ?? 0;
        const ay = series.priceToCoordinate(a.price) ?? 0;
        const by = series.priceToCoordinate(b.price) ?? 0;
        if (Math.hypot(bx - ax, by - ay) < 6) return;
        add(
          current.tool === "trend"
            ? createTrend(a, b, styleRef.current)
            : createZone(a, b, styleRef.current),
        );
        setTool("cursor");
      }
    };

    const onDouble = (event: MouseEvent) => {
      if (!(event.target as Element | null)?.closest?.("canvas")) return;
      const point = pointOf(event.clientX, event.clientY);
      const id = hitTest(geometryRef.current, point);
      if (!id) return;
      const drawing = drawingsRef.current.find((item) => item.id === id);
      if (drawing?.type !== "text") return;
      event.preventDefault();
      event.stopPropagation();
      setEditing({ at: drawing.at, value: drawing.text, id: drawing.id });
    };

    const onKey = (event: KeyboardEvent) => {
      if (editingRef.current) return;
      if (event.key === "Escape") {
        setTool((current) => (current === "cursor" ? current : "cursor"));
        setSelected(null);
        setDraft(null);
        dragRef.current = null;
        return;
      }
      if (event.key === "Delete" || event.key === "Backspace") {
        const id = selectedRef.current;
        if (!id) return;
        event.preventDefault();
        remove(id);
      }
    };

    // Signature d'échelle : évite de re-rendre à chaque mouvement de souris.
    const onPointerSignal = () => {
      const timeRange = chart.timeScale().getVisibleRange();
      const priceRange = series.priceScale().getVisibleRange();
      const signature = `${timeRange?.from}:${timeRange?.to}:${priceRange?.from}:${priceRange?.to}:${chart.timeScale().width()}:${chart.timeScale().height()}`;
      if (signature === signatureRef.current) return;
      signatureRef.current = signature;
      bump();
    };

    host.addEventListener("pointerdown", onDown, true);
    host.addEventListener("dblclick", onDouble, true);
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointermove", onPointerSignal);
    window.addEventListener("pointerup", onUp);
    window.addEventListener("keydown", onKey);
    chart.timeScale().subscribeVisibleLogicalRangeChange(bump);
    const observer =
      typeof ResizeObserver === "undefined" ? null : new ResizeObserver(() => bump());
    observer?.observe(host);

    return () => {
      host.removeEventListener("pointerdown", onDown, true);
      host.removeEventListener("dblclick", onDouble, true);
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointermove", onPointerSignal);
      window.removeEventListener("pointerup", onUp);
      window.removeEventListener("keydown", onKey);
      chart.timeScale().unsubscribeVisibleLogicalRangeChange(bump);
      observer?.disconnect();
    };
  }, [add, chart, remove, series]);

  // Curseur : croix quand un outil de tracé est actif. On passe par `body`
  // plutôt que par l'élément du graphique : muter le style d'un nœud détenu
  // par une autre bibliothèque n'est pas notre rôle.
  useEffect(() => {
    if (tool === "cursor") return;
    const previous = document.body.style.cursor;
    document.body.style.cursor = "crosshair";
    return () => {
      document.body.style.cursor = previous;
    };
  }, [tool]);

  /* ------------------------------------------------------------------ rendu */

  const commitEdit = () => {
    const current = editingRef.current;
    if (!current) return;
    setEditing(null);
    const value = current.value.trim();
    if (!value) return;
    if (current.id) {
      setDrawings((list) =>
        list.map((item) =>
          item.id === current.id && item.type === "text" ? { ...item, text: value } : item,
        ),
      );
      return;
    }
    add(createText(current.at, value, styleRef.current));
  };

  const paneWidth = chart.timeScale().width();
  const paneHeight = chart.timeScale().height();

  const preview = useMemo(() => {
    if (!draft) return null;
    const ax = xForTime(draft.a.time);
    const bx = xForTime(draft.b.time);
    const ay = series.priceToCoordinate(draft.a.price);
    const by = series.priceToCoordinate(draft.b.price);
    if (ax === null || bx === null || ay === null || by === null) return null;
    return {
      type: draft.tool,
      a: { x: clampToPlot(ax, paneWidth), y: ay },
      b: { x: clampToPlot(bx, paneWidth), y: by },
    };
  }, [draft, series, paneWidth, xForTime]);

  const editPoint = useMemo(() => {
    if (!editing) return null;
    const x = xForTime(editing.at.time);
    const y = series.priceToCoordinate(editing.at.price);
    if (x === null || y === null) return null;
    return { x: clampToPlot(x, paneWidth), y };
  }, [editing, series, paneWidth, xForTime]);

  const byId = new Map(drawings.map((item) => [item.id, item]));

  return (
    <>
      <svg
        ref={svgRef}
        aria-hidden="true"
        className="pointer-events-none absolute inset-0 z-10 overflow-visible"
        width={paneWidth}
        height={paneHeight}
      >
        {projected.map((item) => {
          const drawing = byId.get(item.id);
          if (!drawing) return null;
          const active = selected === item.id;
          const { color, width: strokeWidth, dashed } = drawing.style;
          const dash = dashed ? "5 4" : undefined;
          const glow = active ? `drop-shadow(0 0 5px ${color})` : undefined;

          if (drawing.type === "hline") {
            const y = item.points[0]?.y;
            if (y === undefined) return null;
            return (
              <g key={item.id} style={{ filter: glow }}>
                <line
                  x1={0}
                  x2={paneWidth}
                  y1={y}
                  y2={y}
                  stroke={color}
                  strokeWidth={strokeWidth}
                  strokeDasharray={dash}
                />
                <text
                  x={8}
                  y={y - 5}
                  fill={color}
                  className="num"
                  fontSize={10}
                  opacity={0.9}
                >
                  {fmt(drawing.price, decimals)}
                </text>
              </g>
            );
          }

          if (drawing.type === "text") {
            const point = item.points[0];
            if (!point) return null;
            const box = item.box ?? { width: textWidth(drawing.text), height: 16 };
            return (
              <g key={item.id} style={{ filter: glow }}>
                <rect
                  x={point.x}
                  y={point.y - box.height / 2}
                  width={box.width}
                  height={box.height}
                  rx={3}
                  fill="#0a0f1a"
                  opacity={0.55}
                />
                <text
                  x={point.x + 6}
                  y={point.y}
                  dominantBaseline="middle"
                  fill={color}
                  fontSize={11}
                  className="num"
                >
                  {drawing.text}
                </text>
              </g>
            );
          }

          const [a, b] = item.points;
          if (!a || !b) return null;
          if (drawing.type === "zone") {
            return (
              <g key={item.id} style={{ filter: glow }}>
                <rect
                  x={Math.min(a.x, b.x)}
                  y={Math.min(a.y, b.y)}
                  width={Math.abs(b.x - a.x)}
                  height={Math.abs(b.y - a.y)}
                  fill={color}
                  opacity={0.14}
                  stroke={color}
                  strokeWidth={strokeWidth}
                  strokeDasharray={dash}
                />
              </g>
            );
          }
          return (
            <g key={item.id} style={{ filter: glow }}>
              <line
                x1={a.x}
                y1={a.y}
                x2={b.x}
                y2={b.y}
                stroke={color}
                strokeWidth={strokeWidth}
                strokeDasharray={dash}
              />
              <circle cx={a.x} cy={a.y} r={2.5} fill={color} />
              <circle cx={b.x} cy={b.y} r={2.5} fill={color} />
            </g>
          );
        })}

        {preview && (
          <g opacity={0.75}>
            {preview.type === "zone" ? (
              <rect
                x={Math.min(preview.a.x, preview.b.x)}
                y={Math.min(preview.a.y, preview.b.y)}
                width={Math.abs(preview.b.x - preview.a.x)}
                height={Math.abs(preview.b.y - preview.a.y)}
                fill={style.color}
                opacity={0.14}
                stroke={style.color}
                strokeDasharray="4 3"
              />
            ) : (
              <line
                x1={preview.a.x}
                y1={preview.a.y}
                x2={preview.b.x}
                y2={preview.b.y}
                stroke={style.color}
                strokeDasharray="4 3"
              />
            )}
          </g>
        )}
      </svg>

      {open && (
        <DrawingToolbar
          tool={tool}
          style={style}
          hasSelection={selected !== null}
          onTool={(next) => {
            setTool(next);
            if (next !== "cursor") setSelected(null);
          }}
          onStyle={applyStyle}
          onDelete={() => {
            if (selected) remove(selected);
          }}
          onClear={() => {
            setDrawings([]);
            setSelected(null);
          }}
        />
      )}

      {tool !== "cursor" && (
        <span className="pointer-events-none absolute bottom-3 left-3 z-20 rounded-md border border-line bg-surface/90 px-2 py-1 text-[10px] text-tx2 backdrop-blur">
          {tr.drawings.hint}
        </span>
      )}

      {editing && editPoint && (
        <input
          autoFocus
          value={editing.value}
          maxLength={80}
          placeholder={tr.drawings.placeholder}
          onChange={(event) =>
            setEditing((current) => (current ? { ...current, value: event.target.value } : current))
          }
          onKeyDown={(event) => {
            if (event.key === "Enter") {
              event.preventDefault();
              event.currentTarget.blur();
            }
            if (event.key === "Escape") {
              event.preventDefault();
              cancelEditRef.current = true;
              event.currentTarget.blur();
            }
          }}
          onBlur={() => {
            if (cancelEditRef.current) {
              cancelEditRef.current = false;
              setEditing(null);
              return;
            }
            commitEdit();
          }}
          style={{ left: editPoint.x, top: editPoint.y, transform: "translateY(-50%)" }}
          className="num absolute z-30 w-44 rounded-md border border-line bg-surface px-2 py-1 text-[11px] text-tx shadow-lg outline-none focus:border-ac"
        />
      )}
    </>
  );
}
