"use client";

/**
 * En-tête : titre de la vue, recherche d'actif, bascule de régime, horloge de
 * New York et état de connexion.
 *
 * L'horloge et l'état ne provoquent aucun re-render React : ils écrivent
 * directement dans le DOM via des refs.
 */

import { usePathname, useRouter } from "next/navigation";
import { useEffect, useRef } from "react";
import { chartTarget, getAsset } from "@/config/assets";
import { t } from "@/lib/i18n";
import { nyClock } from "@/lib/time";
import { usePaletteStore } from "@/store/palette";
import { useEffectiveRegime } from "@/store/ui";
import { CacheBadge } from "./CacheBadge";
import { activeNav, navLabel } from "./nav";
import { RegimeToggle } from "./RegimeToggle";

export function Header({
  cacheDriver,
  dataMode,
}: {
  /** Cache serveur configuré (propriété d'environnement, donc global). */
  cacheDriver: "upstash" | "memory";
  dataMode: "auto" | "live" | "mock";
}) {
  const pathname = usePathname();
  const router = useRouter();
  const clockRef = useRef<HTMLSpanElement | null>(null);
  const inputRef = useRef<HTMLInputElement | null>(null);
  const regime = useEffectiveRegime();
  const togglePalette = usePaletteStore((state) => state.toggle);

  useEffect(() => {
    const write = () => {
      if (clockRef.current) {
        clockRef.current.textContent = `${nyClock()} New York`;
      }
    };
    write();
    const id = window.setInterval(write, 1000);
    return () => window.clearInterval(id);
  }, []);

  const submit = () => {
    const value = inputRef.current?.value.trim().toUpperCase();
    if (!value) return;
    const asset = getAsset(value);
    if (asset) router.push(`/graphique/${chartTarget(asset)}`);
  };

  const nav = activeNav(pathname);

  /**
   * Latence réelle de la vue, pas un voyant decoratif : l'indicateur « Direct »
   * sur une page CBOE différée de 15 min était un mensonge d'interface. On lit
   * l'actif de l'URL et sa latence déclarée dans le registre.
   */
  const viewAsset =
    pathname.startsWith("/graphique/") || pathname.startsWith("/gamma/")
      ? getAsset(pathname.split("/")[2] ?? "")
      : undefined;
  const latency: "live" | "delayed" | "weekly" | "mixed" = viewAsset
    ? viewAsset.delayMs === 0
      ? "live"
      : "delayed"
    : pathname.startsWith("/flux")
      ? "live"
      : pathname.startsWith("/dark-pool")
        ? "weekly"
        : "mixed";
  const latencyLabel = {
    live: t().header.live,
    delayed: t().header.delayed,
    weekly: t().header.weekly,
    mixed: t().header.mixed,
  }[latency];
  const latencyDot = {
    live: "bg-call accent animate-[pulse_2s_ease-in-out_infinite]",
    delayed: "bg-zero",
    weekly: "bg-tx2/60",
    mixed: "bg-zero/70",
  }[latency];

  return (
    <header className="flex h-12 flex-none items-center gap-3 border-b border-line px-4">
      <h1 className="text-[15px] font-semibold">
        {nav ? navLabel(nav.id) : t().appName}
      </h1>
      <div className="flex-1" />
      <button
        type="button"
        onClick={togglePalette}
        aria-keyshortcuts="Meta+K Control+K"
        className="flex items-center gap-2 rounded-full border border-line px-3 py-1.5 text-[11px] text-tx2 transition-colors duration-200 hover:bg-white/5 hover:text-tx max-md:hidden"
      >
        {t().palette.title}
        <kbd className="num rounded border border-line px-1 text-[10px]">⌘{t().palette.hint}</kbd>
      </button>
      <RegimeToggle />
      <input
        ref={inputRef}
        type="search"
        placeholder={t().header.search}
        aria-label={t().header.search}
        onKeyDown={(event) => {
          if (event.key === "Enter") submit();
        }}
        className="w-[200px] rounded-full border border-line bg-transparent px-3.5 py-1.5 text-xs text-tx placeholder:text-tx2 focus:border-ac focus:outline-none max-md:hidden"
      />
      <span ref={clockRef} className="num text-[11px] text-tx2 max-md:hidden" />
      <span
        className="flex items-center gap-1.5 text-[11px] text-tx2"
        title={t().header.latencyHint}
      >
        <i aria-hidden="true" className={`size-1.5 flex-none rounded-full ${latencyDot}`} />
        {latencyLabel}
      </span>
      <span aria-hidden="true" className="h-3 w-px bg-line max-md:hidden" />
      <CacheBadge cacheDriver={cacheDriver} dataMode={dataMode} />
      {/* Annonce vocale du changement de régime */}
      <span className="sr-only" aria-live="polite">
        {regime === "long" ? t().regime.long : t().regime.short}
      </span>
    </header>
  );
}
