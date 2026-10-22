"use client";

/**
 * Barre d'outils du calque de dessin : outils, couleur, épaisseur, pointillés,
 * suppression. Compacte et iconographique, alignée sur le reste de l'interface
 * (mêmes bordures, mêmes fonds, chiffres en mono).
 */

import { useEffect, useRef, useState } from "react";
import { t } from "@/lib/i18n";
import { DRAWING_COLORS, type DrawingStyle, type DrawingTool } from "../drawings";

interface ToolDefinition {
  id: DrawingTool;
  icon: string;
}

const TOOLS: readonly ToolDefinition[] = [
  { id: "cursor", icon: "M5 3l14 9-6 1-3 6z" },
  { id: "hline", icon: "M3 12h18M6 9v6M18 9v6" },
  { id: "trend", icon: "M4 19L20 5M4 19h.01M20 5h.01" },
  { id: "zone", icon: "M4 6h16v12H4z" },
  { id: "text", icon: "M5 5h14M12 5v14M9 19h6" },
  { id: "erase", icon: "M4 15l6-6 8 8-3 3H7zM10 21h10" },
];

export function DrawingToolbar({
  tool,
  style,
  hasSelection,
  onTool,
  onStyle,
  onDelete,
  onClear,
}: {
  tool: DrawingTool;
  style: DrawingStyle;
  hasSelection: boolean;
  onTool: (tool: DrawingTool) => void;
  onStyle: (style: Partial<DrawingStyle>) => void;
  onDelete: () => void;
  onClear: () => void;
}) {
  const tr = t();
  const [confirmClear, setConfirmClear] = useState(false);
  const timer = useRef<number | null>(null);

  useEffect(
    () => () => {
      if (timer.current !== null) window.clearTimeout(timer.current);
    },
    [],
  );

  const requestClear = () => {
    if (confirmClear) {
      onClear();
      setConfirmClear(false);
      return;
    }
    setConfirmClear(true);
    if (timer.current !== null) window.clearTimeout(timer.current);
    timer.current = window.setTimeout(() => setConfirmClear(false), 3_000);
  };

  return (
    <div
      role="toolbar"
      aria-label={tr.drawings.title}
      className="pointer-events-auto absolute top-11 right-[92px] z-20 flex max-w-[calc(100%-108px)] items-center gap-0.5 overflow-x-auto rounded-lg border border-line bg-surface/92 p-1 backdrop-blur lg:right-[calc(var(--ladder-w)_+_112px)] lg:max-w-[calc(100%_-_var(--ladder-w)_-_128px)]"
    >
      {TOOLS.map((item) => {
        const active = tool === item.id;
        return (
          <button
            key={item.id}
            type="button"
            onClick={() => onTool(item.id)}
            aria-pressed={active}
            aria-label={tr.drawings[item.id]}
            title={tr.drawings[item.id]}
            className={`grid size-7 shrink-0 place-items-center rounded-md transition-colors duration-150 ${
              active
                ? "bg-white/10 text-tx"
                : "text-tx2 hover:bg-white/5 hover:text-tx"
            }`}
          >
            <svg
              viewBox="0 0 24 24"
              aria-hidden="true"
              className="size-4 fill-none stroke-current [stroke-linecap:round] [stroke-linejoin:round] [stroke-width:1.7]"
            >
              <path d={item.icon} />
            </svg>
          </button>
        );
      })}

      <span aria-hidden="true" className="mx-1 h-5 w-px shrink-0 bg-line" />

      {DRAWING_COLORS.map((color) => (
        <button
          key={color}
          type="button"
          onClick={() => onStyle({ color })}
          aria-label={`${tr.drawings.color} ${color}`}
          aria-pressed={style.color === color}
          title={`${tr.drawings.color} ${color}`}
          className={`size-5 shrink-0 rounded-full border transition-transform duration-150 hover:scale-110 ${
            style.color === color ? "border-tx" : "border-transparent"
          }`}
          style={{ background: color }}
        />
      ))}

      <button
        type="button"
        onClick={() => onStyle({ width: style.width === 3 ? 1 : ((style.width + 1) as 1 | 2 | 3) })}
        aria-label={tr.drawings.width}
        title={tr.drawings.width}
        className="num grid size-7 shrink-0 place-items-center rounded-md text-[11px] text-tx2 transition-colors hover:bg-white/5 hover:text-tx"
      >
        {style.width}
      </button>

      <button
        type="button"
        onClick={() => onStyle({ dashed: !style.dashed })}
        aria-pressed={style.dashed}
        aria-label={tr.drawings.dashed}
        title={tr.drawings.dashed}
        className={`grid size-7 shrink-0 place-items-center rounded-md transition-colors ${
          style.dashed ? "bg-white/10 text-tx" : "text-tx2 hover:bg-white/5 hover:text-tx"
        }`}
      >
        <svg
          viewBox="0 0 24 24"
          aria-hidden="true"
          className="size-4 fill-none stroke-current [stroke-linecap:round] [stroke-width:1.7]"
        >
          <path d="M3 12h5m3 0h5m3 0h2" />
        </svg>
      </button>

      <span aria-hidden="true" className="mx-1 h-5 w-px shrink-0 bg-line" />

      <button
        type="button"
        onClick={onDelete}
        disabled={!hasSelection}
        aria-label={tr.drawings.delete}
        title={tr.drawings.delete}
        className="grid size-7 shrink-0 place-items-center rounded-md text-tx2 transition-colors hover:bg-white/5 hover:text-put disabled:cursor-not-allowed disabled:opacity-35"
      >
        <svg
          viewBox="0 0 24 24"
          aria-hidden="true"
          className="size-4 fill-none stroke-current [stroke-linecap:round] [stroke-linejoin:round] [stroke-width:1.7]"
        >
          <path d="M4 7h16M9 7V4h6v3M6 7l1 13h10l1-13M10 11v6M14 11v6" />
        </svg>
      </button>

      <button
        type="button"
        onClick={requestClear}
        aria-label={tr.drawings.clear}
        title={tr.drawings.clear}
        className={`h-7 shrink-0 rounded-md px-1.5 text-[10px] transition-colors ${
          confirmClear
            ? "bg-put/15 text-put"
            : "text-tx2 hover:bg-white/5 hover:text-tx"
        }`}
      >
        {confirmClear ? tr.drawings.confirm : tr.drawings.clear}
      </button>
    </div>
  );
}
