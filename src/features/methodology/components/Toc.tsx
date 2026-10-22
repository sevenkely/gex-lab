"use client";

/**
 * Sommaire de la méthodologie : suit la section visible et la met en avant.
 *
 * L'observateur écoute les titres de section, pas le document : la page défile
 * dans son propre conteneur, donc on prend ce conteneur comme racine quand il
 * existe. Sans cela, la section active resterait figée sur la première.
 */

import { useEffect, useRef, useState } from "react";

interface TocEntry {
  id: string;
  n: string;
  title: string;
}

export function Toc({
  sections,
  note,
}: {
  sections: readonly TocEntry[];
  note?: string;
}) {
  const [active, setActive] = useState(sections[0]?.id ?? "");
  const navRef = useRef<HTMLElement | null>(null);

  useEffect(() => {
    const nav = navRef.current;
    const root = nav?.closest(".overflow-auto") as HTMLElement | null;
    const targets = sections
      .map((section) => document.getElementById(section.id))
      .filter((element): element is HTMLElement => element !== null);
    if (targets.length === 0 || typeof IntersectionObserver === "undefined") return;

    // Plusieurs sections peuvent être visibles : on retient la plus haute.
    const visible = new Set<string>();
    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (entry.isIntersecting) visible.add(entry.target.id);
          else visible.delete(entry.target.id);
        }
        const first = sections.find((section) => visible.has(section.id));
        if (first) setActive(first.id);
      },
      { root, rootMargin: "-8% 0px -62% 0px", threshold: 0 },
    );
    for (const target of targets) observer.observe(target);
    return () => observer.disconnect();
  }, [sections]);

  return (
    <nav ref={navRef} aria-label="Sommaire" className="sticky top-4 flex flex-col gap-0.5">
      <p className="mb-1.5 px-2 font-mono text-[9px] tracking-[0.18em] text-tx2 uppercase">
        Sommaire
      </p>
      {sections.map((section) => {
        const isActive = section.id === active;
        return (
          <a
            key={section.id}
            href={`#${section.id}`}
            aria-current={isActive ? "true" : undefined}
            className={`group relative flex items-baseline gap-2 rounded-md px-2 py-1.5 text-[11px] transition-colors duration-200 ${
              isActive ? "bg-ac/8 text-tx" : "text-tx2 hover:bg-white/4 hover:text-tx"
            }`}
          >
            <span
              aria-hidden="true"
              className={`absolute inset-y-1.5 left-0 w-px rounded-full transition-all duration-300 ${
                isActive ? "bg-ac" : "bg-transparent"
              }`}
            />
            <span
              className={`num text-[9px] transition-colors ${isActive ? "text-ac" : "text-tx2/70 group-hover:text-ac"}`}
            >
              {section.n}
            </span>
            <span className="truncate">{section.title}</span>
          </a>
        );
      })}
      <span
        aria-hidden="true"
        className="mt-3 h-px w-full bg-gradient-to-r from-ac/50 to-transparent"
      />
      {note && (
        <p className="mt-2 px-2 text-[10px] leading-relaxed text-tx2">{note}</p>
      )}
    </nav>
  );
}
