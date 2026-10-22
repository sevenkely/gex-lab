"use client";

/**
 * Palette de commandes (⌘K / Ctrl+K).
 *
 * Elle ne fait qu'une chose : amener quelque part en deux frappes — page,
 * actif, vue. Aucune donnée n'est chargée ici : tout vient de registres déjà
 * présents (`ASSETS`, `NAV_ITEMS`), donc l'ouverture est instantanée même
 * pendant le calcul d'une chaîne d'options.
 *
 * Le panneau est remonté à chaque ouverture (`key`) : la recherche repart
 * vide sans effet de synchronisation.
 */

import { useRouter } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import { CHART_ASSETS } from "@/config/assets";
import { LOCALE, t } from "@/lib/i18n";
import { usePaletteStore } from "@/store/palette";
import { NAV_ITEMS, navLabel } from "./nav";

interface Entry {
  id: string;
  label: string;
  hint: string;
  group: "pages" | "assets";
  href: string;
  /** Termes supplémentaires pour la recherche (symboles, alias). */
  terms: string;
}

function normalize(value: string): string {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .trim();
}

export function CommandPalette() {
  const open = usePaletteStore((state) => state.open);
  const openCount = usePaletteStore((state) => state.openCount);
  const toggle = usePaletteStore((state) => state.toggle);
  const setOpen = usePaletteStore((state) => state.setOpen);

  // Raccourci global : ⌘K sur macOS, Ctrl+K ailleurs.
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key.toLowerCase() === "k" && (event.metaKey || event.ctrlKey)) {
        event.preventDefault();
        toggle();
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [toggle]);

  if (!open) return null;
  return <PalettePanel key={openCount} onClose={() => setOpen(false)} />;
}

function PalettePanel({ onClose }: { onClose: () => void }) {
  const tr = t();
  const router = useRouter();
  const [query, setQuery] = useState("");
  const [active, setActive] = useState(0);

  const entries = useMemo<Entry[]>(() => {
    const pages: Entry[] = NAV_ITEMS.map((item) => ({
      id: `nav-${item.id}`,
      label: navLabel(item.id),
      hint: item.href,
      group: "pages" as const,
      href: item.href,
      terms: "page vue navigation",
    }));
    const assets: Entry[] = CHART_ASSETS.flatMap((asset) => [
      {
        id: `chart-${asset.id}`,
        label: `${asset.symbol} — ${tr.palette.chart}`,
        hint: asset.label,
        group: "assets" as const,
        href: `/graphique/${asset.id}`,
        terms: `graphique chart ${asset.id} ${asset.symbol} ${asset.label}`,
      },
      {
        id: `gamma-${asset.id}`,
        label: `${asset.symbol} — ${tr.palette.gamma}`,
        hint: asset.label,
        group: "assets" as const,
        href: `/gamma/${asset.id}`,
        terms: `gamma strike ${asset.id} ${asset.symbol} ${asset.label}`,
      },
    ]);
    return [...pages, ...assets];
  }, [tr.palette.chart, tr.palette.gamma]);

  const results = useMemo(() => {
    // Recherche par mots : « eth gamma » doit trouver « ETH — Gamma par
    // strike ». Chaque terme est cherché séparément (la ponctuation du libellé
    // — tiret cadratin, barre oblique — ne doit pas casser la correspondance).
    const words = normalize(query).split(/\s+/).filter(Boolean);
    if (words.length === 0) return entries;
    return entries.filter((entry) => {
      const haystack = normalize(`${entry.label} ${entry.hint} ${entry.terms}`).replace(
        /[^a-z0-9]+/g,
        " ",
      );
      return words.every((word) => haystack.includes(word));
    });
  }, [entries, query]);

  const go = (entry: Entry | undefined) => {
    if (!entry) return;
    onClose();
    router.push(entry.href);
  };

  let flatIndex = -1;

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label={tr.palette.title}
      className="fixed inset-0 z-50 flex items-start justify-center bg-black/45 p-4 pt-[12vh] backdrop-blur-sm"
      onClick={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <div className="panel w-full max-w-[520px] overflow-hidden bg-[#0d1424] shadow-2xl">
        <input
          autoFocus
          value={query}
          onChange={(event) => {
            setQuery(event.target.value);
            setActive(0);
          }}
          onKeyDown={(event) => {
            if (event.key === "ArrowDown") {
              event.preventDefault();
              setActive((index) => Math.min(index + 1, results.length - 1));
            } else if (event.key === "ArrowUp") {
              event.preventDefault();
              setActive((index) => Math.max(index - 1, 0));
            } else if (event.key === "Enter") {
              event.preventDefault();
              go(results[active]);
            } else if (event.key === "Escape") {
              onClose();
            }
          }}
          placeholder={tr.palette.placeholder}
          aria-label={tr.palette.placeholder}
          className="w-full border-b border-line bg-transparent px-4 py-3 text-sm text-tx placeholder:text-tx2 focus:outline-none"
        />
        <div className="max-h-[46vh] overflow-y-auto p-1.5">
          {results.length === 0 && (
            <p className="px-3 py-4 text-xs text-tx2">{tr.palette.empty}</p>
          )}
          {(["pages", "assets"] as const).map((group) => {
            const items = results.filter((entry) => entry.group === group);
            if (items.length === 0) return null;
            return (
              <div key={group}>
                <p className="px-2.5 pt-2 pb-1 text-[10px] tracking-wide text-tx2 uppercase">
                  {group === "pages" ? tr.palette.pages : tr.palette.assets}
                </p>
                <ul role="listbox" aria-label={tr.palette.title}>
                  {items.map((entry) => {
                    flatIndex += 1;
                    const index = flatIndex;
                    const selected = index === active;
                    return (
                      <li key={entry.id} role="option" aria-selected={selected}>
                        <button
                          type="button"
                          onMouseEnter={() => setActive(index)}
                          onClick={() => go(entry)}
                          className={`flex w-full items-center justify-between gap-3 rounded-md px-2.5 py-2 text-left text-xs transition-colors duration-150 ${
                            selected ? "bg-white/8 text-tx" : "text-tx2 hover:bg-white/5"
                          }`}
                        >
                          <span className="truncate">{entry.label}</span>
                          <span className="num flex-none text-[10px] text-tx2">
                            {entry.hint}
                          </span>
                        </button>
                      </li>
                    );
                  })}
                </ul>
              </div>
            );
          })}
        </div>
        <p className="flex items-center gap-3 border-t border-line px-4 py-2 text-[10px] text-tx2">
          <span>↑↓</span>
          <span>↵</span>
          <span>Esc</span>
          <span className="ml-auto">
            {LOCALE === "fr" ? "Raccourci" : "Shortcut"} ⌘{tr.palette.hint}
          </span>
        </p>
      </div>
    </div>
  );
}
