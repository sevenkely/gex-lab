"use client";

/**
 * Espace de travail du graphique : le chart occupe toute la largeur, le ladder
 * de strikes vit à droite, et l'ancien panneau d'analyse devient un tiroir
 * (fermé par défaut) qui recouvre le ladder sans démonter le graphique.
 */

import { useState } from "react";
import { RegimePanel } from "@/features/gex/components/RegimePanel";
import type { GexLevelKind, GexSnapshot } from "@/features/gex/types";
import { t } from "@/lib/i18n";
import type { Candle, CandleInterval } from "@/server/providers/types";
import { useAlertsStore } from "@/store/alerts";
import { AlertFeed } from "./AlertFeed";
import { AlertToasts } from "./AlertToasts";
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
  const tr = t();
  const [panelOpen, setPanelOpen] = useState(false);
  const [highlight, setHighlight] = useState<GexLevelKind | null>(null);
  const [levelsVisible, setLevelsVisible] = useState(true);
  const pushAlert = useAlertsStore((state) => state.push);
  // Seuls BTC et ETH reçoivent un prix par le flux temps réel : le suivi
  // d'approche n'a de sens que sur eux (les indices sont différés).
  const live = snapshot.assetId === "BTC" || snapshot.assetId === "ETH";

  return (
    <div className="relative min-h-[420px] flex-1 overflow-hidden lg:min-h-0">
      <GexChart
        snapshot={snapshot}
        candles={candles}
        interval={interval}
        decimals={decimals}
        highlight={highlight}
        panelOpen={panelOpen}
        onTogglePanel={() => setPanelOpen((value) => !value)}
        levelsVisible={levelsVisible}
        onToggleLevels={() => setLevelsVisible((value) => !value)}
        onAlert={pushAlert}
      />
      <AlertToasts decimals={decimals} />

      {panelOpen && (
        <aside
          aria-label={tr.chart.analysis}
          className="absolute inset-y-0 right-0 z-30 w-[380px] max-w-[88vw] overflow-y-auto border-l border-line bg-bg/95 shadow-[-12px_0_32px_rgba(0,0,0,.35)] backdrop-blur-md"
        >
          <div className="flex items-center justify-between border-b border-line px-4 py-2">
            <span className="text-[11px] tracking-[0.08em] text-tx2 uppercase">
              {tr.chart.analysis}
            </span>
            <button
              type="button"
              onClick={() => setPanelOpen(false)}
              aria-label={tr.common.close}
              className="grid size-7 place-items-center rounded-md text-lg leading-none text-tx2 transition-colors hover:bg-white/5 hover:text-tx"
            >
              ×
            </button>
          </div>
          <RegimePanel
            snapshot={snapshot}
            label={label}
            decimals={decimals}
            onHighlight={setHighlight}
          />
          <div className="px-4 pb-4">
            <AlertFeed decimals={decimals} live={live} />
          </div>
        </aside>
      )}
    </div>
  );
}
