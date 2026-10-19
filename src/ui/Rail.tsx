"use client";

/**
 * Rail de navigation : vertical à gauche sur desktop, barre horizontale en bas
 * sur mobile (comme la maquette). L'indicateur d'onglet glisse vers l'élément
 * actif (transform + transition, pas de re-render des pages).
 */

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { NAV_ITEMS, activeNav, navLabel } from "./nav";

interface Indicator {
  x: number;
  y: number;
  w: number;
  h: number;
}

export function Rail() {
  const pathname = usePathname();
  const active = activeNav(pathname);
  const listRef = useRef<HTMLElement | null>(null);
  const refs = useRef<Record<string, HTMLAnchorElement | null>>({});
  const [compact, setCompact] = useState(false);
  const [indicator, setIndicator] = useState<Indicator>({ x: 8, y: 8, w: 40, h: 40 });

  useEffect(() => {
    const mq = window.matchMedia("(max-width: 760px)");
    const apply = () => setCompact(mq.matches);
    apply();
    mq.addEventListener("change", apply);
    return () => mq.removeEventListener("change", apply);
  }, []);

  const place = useCallback(() => {
    if (!active) return;
    const el = refs.current[active.id];
    if (!el) return;
    setIndicator({
      x: el.offsetLeft,
      y: el.offsetTop,
      w: el.offsetWidth,
      h: el.offsetHeight,
    });
  }, [active]);

  useLayoutEffect(() => {
    place();
  }, [place, compact, pathname]);

  useEffect(() => {
    const list = listRef.current;
    if (!list || typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(() => place());
    observer.observe(list);
    return () => observer.disconnect();
  }, [place]);

  return (
    <nav
      ref={listRef}
      aria-label="Navigation principale"
      className="relative z-5 flex flex-none items-center gap-1.5 border-line bg-transparent px-0 py-1.5 max-md:h-14 max-md:flex-row max-md:justify-around max-md:gap-0 max-md:border-t max-md:px-0 md:w-14 md:flex-col md:border-r md:py-2.5"
    >
      <span
        aria-hidden="true"
        className="accent sliding pointer-events-none absolute rounded-[10px]"
        style={{
          left: 0,
          top: 0,
          width: indicator.w,
          height: indicator.h,
          transform: `translate(${indicator.x}px, ${indicator.y}px)`,
          background: "color-mix(in srgb, var(--ac) 18%, transparent)",
        }}
      />
      <span className="mb-3.5 hidden text-lg font-extrabold md:block" aria-hidden="true">
        g<span className="text-ac">x</span>
      </span>
      {NAV_ITEMS.map((item) => {
        const isActive = active?.id === item.id;
        return (
          <Link
            key={item.id}
            href={item.href}
            ref={(el) => {
              refs.current[item.id] = el;
            }}
            aria-label={navLabel(item.id)}
            aria-current={isActive ? "page" : undefined}
            className={`accent group relative z-1 grid size-10 place-items-center rounded-[10px] hover:bg-white/5 max-md:size-11 ${
              isActive ? "text-ac" : "text-tx2"
            }`}
          >
            <svg
              viewBox="0 0 24 24"
              aria-hidden="true"
              className="size-5 fill-none stroke-current [stroke-linecap:round] [stroke-linejoin:round] [stroke-width:1.7]"
            >
              <path d={item.icon} />
            </svg>
            <span className="pointer-events-none absolute left-12 z-10 hidden whitespace-nowrap rounded-md bg-[#20293d] px-2 py-1 text-[11px] text-tx opacity-0 transition-all duration-200 group-hover:translate-x-0 group-hover:opacity-100 md:block -translate-x-1">
              {navLabel(item.id)}
            </span>
          </Link>
        );
      })}
    </nav>
  );
}
