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
import { getAsset } from "@/config/assets";
import { t } from "@/lib/i18n";
import { nyClock } from "@/lib/time";
import { useEffectiveRegime } from "@/store/ui";
import { activeNav, navLabel } from "./nav";
import { RegimeToggle } from "./RegimeToggle";

export function Header() {
  const pathname = usePathname();
  const router = useRouter();
  const clockRef = useRef<HTMLSpanElement | null>(null);
  const inputRef = useRef<HTMLInputElement | null>(null);
  const regime = useEffectiveRegime();

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
    if (asset) router.push(`/graphique/${asset.id}`);
  };

  const nav = activeNav(pathname);

  return (
    <header className="flex h-12 flex-none items-center gap-3 border-b border-line px-4">
      <h1 className="text-[15px] font-semibold">
        {nav ? navLabel(nav.id) : t().appName}
      </h1>
      <div className="flex-1" />
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
      <span className="flex items-center gap-1.5 text-[11px] text-tx2">
        <i
          aria-hidden="true"
          className="accent size-1.5 animate-[pulse_2s_ease-in-out_infinite] rounded-full bg-ac"
        />
        {t().header.live}
      </span>
      {/* Annonce vocale du changement de régime */}
      <span className="sr-only" aria-live="polite">
        {regime === "long" ? t().regime.long : t().regime.short}
      </span>
    </header>
  );
}
