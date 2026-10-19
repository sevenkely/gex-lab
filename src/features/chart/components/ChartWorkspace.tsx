"use client";

/**
 * Espace de travail du graphique : gère le mode Focus et le survol d'une carte
 * de niveau (la bande correspondante s'illumine, les autres s'atténuent).
 *
 * Le mode Focus replie le panneau latéral en 450 ms (transition de la grille),
 * sans démonter le graphique : la largeur du canvas est recalculée par
 * lightweight-charts (autoSize).
 */

import { useState } from "react";
import { RegimePanel } from "@/features/gex/components/RegimePanel";
import type { GexLevelKind, GexSnapshot } from "@/features/gex/types";
import type { Candle, CandleInterval } from "@/server/providers/types";
import { GexChart } from "./GexChart";

export function ChartWorkspace({
  snapshot,
  candles,
  interval,
  label,
  decimals,
}: {
  snapshot: GexSnapshot;
  candles: readonly Candle[];
  interval: CandleInterval;
  label: string;
  decimals: number;
}) {
  const [focus, setFocus] = useState(false);
  const [highlight, setHighlight] = useState<GexLevelKind | null>(null);
  const [levelsVisible, setLevelsVisible] = useState(true);

  return (
    <div
      className={`grid min-h-0 flex-1 grid-cols-1 overflow-hidden transition-[grid-template-columns] duration-450 ${
        focus ? "" : "lg:grid-cols-[1fr_300px]"
      }`}
    >
      <div className="relative min-h-[320px] border-b border-line lg:border-b-0">
        <GexChart
          snapshot={snapshot}
          candles={candles}
          interval={interval}
          highlight={highlight}
          onHighlight={setHighlight}
          focus={focus}
          onToggleFocus={() => setFocus((value) => !value)}
          levelsVisible={levelsVisible}
          onToggleLevels={() => setLevelsVisible((value) => !value)}
        />
      </div>
      {!focus && (
        <aside className="min-w-0 overflow-y-auto border-line lg:border-l">
          <RegimePanel
            snapshot={snapshot}
            label={label}
            decimals={decimals}
            onHighlight={setHighlight}
          />
        </aside>
      )}
    </div>
  );
}
