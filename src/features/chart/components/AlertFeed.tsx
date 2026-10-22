"use client";

/**
 * Journal des alertes de niveau : approche, toucher, croisement.
 *
 * Le suivi ne concerne que les actifs dont le prix arrive par le flux temps
 * réel (BTC / ETH) — le dire explicitement évite de croire à une panne sur les
 * indices, dont la chaîne est différée de 15 minutes.
 */

import { LEVEL_RGB, levelLabel } from "@/features/gex/components/level-style";
import { fmt } from "@/lib/format";
import { t } from "@/lib/i18n";
import { nyTimeShort } from "@/lib/time";
import { useAlertsStore } from "@/store/alerts";
import { APPROACH_PCT, TOUCH_PCT, type AlertKind } from "../alerts";

const KIND_LABEL: Record<AlertKind, "approach" | "touch" | "cross"> = {
  approach: "approach",
  touch: "touch",
  cross: "cross",
};

export function AlertFeed({
  decimals = 2,
  live,
}: {
  decimals?: number;
  /** true si le prix temps réel alimente le suivi sur cet actif. */
  live: boolean;
}) {
  const tr = t();
  const enabled = useAlertsStore((state) => state.enabled);
  const alerts = useAlertsStore((state) => state.alerts);
  const toggle = useAlertsStore((state) => state.toggle);
  const clear = useAlertsStore((state) => state.clear);

  return (
    <section className="panel mb-3 p-3" aria-label={tr.alerts.title}>
      <header className="mb-2 flex items-center justify-between gap-2">
        <h3 className="text-xs font-semibold text-tx2">{tr.alerts.title}</h3>
        <div className="flex items-center gap-1.5">
          {alerts.length > 0 && (
            <button
              type="button"
              onClick={clear}
              className="rounded-md border border-line px-2 py-0.5 text-[10px] text-tx2 transition-colors duration-200 hover:bg-white/5 hover:text-tx"
            >
              {tr.alerts.clear}
            </button>
          )}
          <button
            type="button"
            onClick={toggle}
            aria-pressed={enabled}
            className={`rounded-md border px-2 py-0.5 text-[11px] transition-colors duration-200 ${
              enabled
                ? "border-line bg-white/8 text-tx"
                : "border-transparent text-tx2 hover:bg-white/5 hover:text-tx"
            }`}
          >
            {tr.alerts.enable}
          </button>
        </div>
      </header>

      {alerts.length === 0 ? (
        <p className="text-[11px] text-tx2">
          {tr.alerts.empty}
          {!live && <span className="num"> — {tr.header.delayed}</span>}
        </p>
      ) : (
        <ul className="flex flex-col" aria-live="polite">
          {alerts.map((alert, index) => (
            <li
              key={alert.id}
              style={{ ["--i" as string]: index }}
              className="row-in grid grid-cols-[52px_1fr_auto] items-center gap-x-2 border-b border-line py-1.5 text-[11px] last:border-0"
            >
              <span className="num text-tx2">{nyTimeShort(alert.ts)}</span>
              <span className="flex min-w-0 items-center gap-1.5">
                <i
                  aria-hidden="true"
                  className="size-1.5 flex-none rounded-full"
                  style={{ background: `rgb(${LEVEL_RGB[alert.level]})` }}
                />
                <b className="truncate font-semibold text-tx">{levelLabel(alert.level)}</b>
                <span className="text-tx2">{tr.alerts[KIND_LABEL[alert.kind]]}</span>
              </span>
              <span className="num text-right text-tx2">
                {fmt(alert.observed, decimals)}
              </span>
            </li>
          ))}
        </ul>
      )}

      <p className="mt-2 text-[10px] text-tx2">
        Seuils : approche ± {(APPROACH_PCT * 100).toFixed(2)} %, toucher ±{" "}
        {(TOUCH_PCT * 100).toFixed(2)} %. Délais anti-répétition : 15 min (approche), 4 s
        (toucher), 60 s (croisement).
      </p>
    </section>
  );
}
