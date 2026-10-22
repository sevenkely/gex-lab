"use client";

/**
 * Cartes des niveaux clés (Call Wall, Put Wall, Zero Gamma, Max Pain, King Node).
 * Au survol, la carte prévient le graphique : la bande correspondante
 * s'illumine et les autres s'atténuent.
 *
 * Chaque carte porte sa définition (info-bulle CSS, aucune donnée chargée) :
 * c'est la couche pédagogique du terminal, au contact du chiffre.
 */

import { useState } from "react";
import { fmt, fmtDistance } from "@/lib/format";
import { t } from "@/lib/i18n";
import { Tooltip } from "@/ui/Tooltip";
import type { GexLevel, GexLevelKind } from "../types";
import { CARD_LEVELS, LEVEL_RGB, levelExplain, levelLabel } from "./level-style";

export function LevelCards({
  levels,
  spot,
  decimals = 2,
  onHover,
  filterKinds = CARD_LEVELS,
}: {
  levels: readonly GexLevel[];
  spot: number;
  decimals?: number;
  onHover?: (kind: GexLevelKind | null) => void;
  filterKinds?: readonly GexLevelKind[];
}) {
  const [hovered, setHovered] = useState<GexLevelKind | null>(null);

  const visible = filterKinds
    .map((kind) => levels.find((level) => level.kind === kind))
    .filter((level): level is GexLevel => Boolean(level));

  if (visible.length === 0) {
    return <p className="text-[11px] text-tx2">{t().common.icu}</p>;
  }

  return (
    <div className="flex flex-col gap-2">
      {visible.map((level, index) => {
        const rgb = LEVEL_RGB[level.kind];
        const highlighted = hovered === level.kind;
        return (
          <Tooltip
            key={level.kind}
            label={levelExplain(level.kind)}
            side={index < 2 ? "bottom" : "top"}
            className="w-full"
          >
            <button
              type="button"
              onMouseEnter={() => {
                setHovered(level.kind);
                onHover?.(level.kind);
              }}
              onMouseLeave={() => {
                setHovered(null);
                onHover?.(null);
              }}
              onFocus={() => {
                setHovered(level.kind);
                onHover?.(level.kind);
              }}
              onBlur={() => {
                setHovered(null);
                onHover?.(null);
              }}
              style={{ ["--i" as string]: index }}
              className="rise panel grid w-full grid-cols-[auto_1fr_auto] items-center gap-x-2.5 gap-y-0.5 px-3 py-2.5 text-left transition-[transform,border-color,box-shadow] duration-250 hover:-translate-y-px"
              data-highlighted={highlighted}
            >
              <i
                aria-hidden="true"
                className="row-span-2 size-1.5 rounded-full"
                style={{ background: `rgb(${rgb})` }}
              />
              <span className="col-start-2 row-span-2 text-xs text-tx2">
                {levelLabel(level.kind)}
              </span>
              <b className="num col-start-3 row-start-1 text-right text-[13px] font-semibold">
                {fmt(level.price, decimals)}
              </b>
              <em className="num col-start-3 row-start-2 text-right text-[11px] text-tx2 not-italic">
                {fmtDistance(level.price, spot)}
              </em>
            </button>
          </Tooltip>
        );
      })}
    </div>
  );
}
