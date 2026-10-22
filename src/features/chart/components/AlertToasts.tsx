"use client";

/**
 * Toasts des alertes de niveau : une apparition brève dans le graphique, sans
 * jamais recouvrir les commandes (elles sont décalées sous la barre d'outils).
 *
 * Le composant s'abonne au journal (store) mais garde sa propre durée de vie :
 * chaque toast disparaît après 7 s, et le nettoyage est fait au démontage.
 */

import { useEffect, useRef, useState } from "react";
import { LEVEL_RGB, levelLabel } from "@/features/gex/components/level-style";
import { fmt } from "@/lib/format";
import { t } from "@/lib/i18n";
import { useAlertsStore } from "@/store/alerts";
import type { AlertKind, LevelAlert } from "../alerts";

const TOAST_MS = 7_000;
const MAX_VISIBLE = 3;

const KIND_KEY: Record<AlertKind, "approach" | "touch" | "cross"> = {
  approach: "approach",
  touch: "touch",
  cross: "cross",
};

export function AlertToasts({ decimals = 2 }: { decimals?: number }) {
  const tr = t();
  const alerts = useAlertsStore((state) => state.alerts);
  const [visible, setVisible] = useState<LevelAlert[]>([]);
  const timers = useRef<number[]>([]);
  const seen = useRef<string | null>(null);

  useEffect(() => {
    const latest = alerts[0];
    if (!latest || latest.id === seen.current) return;
    seen.current = latest.id;
    setVisible((current) => [latest, ...current].slice(0, MAX_VISIBLE));
    const timer = window.setTimeout(() => {
      setVisible((current) => current.filter((alert) => alert.id !== latest.id));
    }, TOAST_MS);
    timers.current.push(timer);
  }, [alerts]);

  useEffect(
    () => () => {
      for (const timer of timers.current) window.clearTimeout(timer);
      timers.current = [];
    },
    [],
  );

  if (visible.length === 0) return null;

  return (
    <div
      className="pointer-events-none absolute top-11 right-[92px] z-20 flex w-[260px] flex-col gap-1.5"
      aria-live="polite"
    >
      {visible.map((alert) => (
        <div
          key={alert.id}
          className="panel flex items-center gap-2 px-2.5 py-1.5 text-[11px] shadow-lg"
          style={{ borderColor: `rgba(${LEVEL_RGB[alert.level]},.45)` }}
        >
          <i
            aria-hidden="true"
            className="size-1.5 flex-none rounded-full"
            style={{ background: `rgb(${LEVEL_RGB[alert.level]})` }}
          />
          <b className="font-semibold">{levelLabel(alert.level)}</b>
          <span className="text-tx2">{tr.alerts[KIND_KEY[alert.kind]]}</span>
          <span className="num ml-auto text-tx2">{fmt(alert.observed, decimals)}</span>
        </div>
      ))}
    </div>
  );
}
