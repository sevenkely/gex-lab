"use client";

/**
 * Badge discret de l'état de la donnée, dans l'en-tête.
 *
 * Trois informations, une ligne :
 *  - le cache serveur configuré — `partagé` (Upstash) ou `mémoire` (instance
 *    seule) : propriété de l'environnement, donc la même dans toutes les
 *    fonctions serverless ;
 *  - l'âge de la donnée affichée, publié par la page courante via
 *    `ReportProvenance` : pas une mesure du cache, mais la fraîcheur réelle du
 *    chiffre à l'écran, qui est ce qui compte ;
 *  - `fixtures` lorsque la vue est retombée sur des données de démonstration.
 *
 * Aucun rendu avant le montage : l'âge dépend de l'horloge, le peindre côté
 * serveur ferait diverger l'hydratation.
 */

import { useEffect, useState, useSyncExternalStore } from "react";
import { t } from "@/lib/i18n";
import { useUiStore } from "@/store/ui";

/**
 * false pendant le rendu serveur et la première passe d'hydratation, true
 * ensuite : l'âge affiché dépend de l'horloge du client, le peindre au SSR
 * ferait diverger le HTML du serveur (mismatch React).
 */
const subscribeNoop = () => () => {};
function useMounted(): boolean {
  return useSyncExternalStore(
    subscribeNoop,
    () => true,
    () => false,
  );
}

const TICK_MS = 2_000;

export function fmtAge(ms: number): string {
  if (ms < 1_000) return "< 1 s";
  if (ms < 60_000) return `${Math.round(ms / 1_000)} s`;
  const min = Math.round(ms / 60_000);
  if (min < 60) return `${min} min`;
  return `${Math.round(min / 60)} h`;
}

export function CacheBadge({
  cacheDriver,
  dataMode,
}: {
  cacheDriver: "upstash" | "memory";
  dataMode: "auto" | "live" | "mock";
}) {
  const tr = t().cache;
  const provenance = useUiStore((state) => state.provenance);
  const mounted = useMounted();
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    const tick = window.setInterval(() => setNow(Date.now()), TICK_MS);
    return () => window.clearInterval(tick);
  }, []);

  if (!mounted) return null;

  const fixtures = dataMode === "mock" || provenance?.demo === true;
  const label = fixtures ? tr.fixtures : cacheDriver === "upstash" ? tr.shared : tr.memory;
  const dot = fixtures ? "bg-zero" : cacheDriver === "upstash" ? "bg-call" : "bg-tx2/50";
  const age = provenance ? Math.max(0, now - provenance.fetchedAt) : null;

  const tooltip = [
    `${tr.label} : ${label}`,
    provenance ? `${tr.source} : ${provenance.provider}` : "",
    age === null ? "" : `${tr.fresh} : ${fmtAge(age)}`,
    provenance?.stale ? tr.stale : "",
    `DATA_MODE : ${dataMode}`,
  ]
    .filter(Boolean)
    .join("\n");

  return (
    <span
      title={tooltip}
      aria-label={`${tr.label} ${label}`}
      className="hidden items-center gap-1.5 font-mono text-[10px] text-tx2/80 md:flex"
    >
      <i aria-hidden="true" className={`size-1.5 flex-none rounded-full ${dot}`} />
      <span>{tr.label}</span>
      <span className={fixtures ? "text-zero" : cacheDriver === "upstash" ? "text-call/80" : ""}>
        {label}
      </span>
      <span className="num text-tx2/60">{age === null ? tr.empty : fmtAge(age)}</span>
    </span>
  );
}
