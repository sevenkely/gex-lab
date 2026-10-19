"use client";

/** Onglets avec indicateur qui glisse (mesuré sur le bouton actif). */

import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";

export interface TabItem<T extends string> {
  id: T;
  label: string;
  title?: string;
  color?: string;
}

export function Tabs<T extends string>({
  items,
  value,
  onChange,
  size = "md",
  ariaLabel,
  className = "",
}: {
  items: readonly TabItem<T>[];
  value: T;
  onChange: (id: T) => void;
  size?: "sm" | "md";
  ariaLabel?: string;
  className?: string;
}) {
  const refs = useRef<Record<string, HTMLButtonElement | null>>({});
  const [indicator, setIndicator] = useState({ x: 0, w: 0, ready: false });

  const place = useCallback(() => {
    const el = refs.current[value];
    if (!el) return;
    setIndicator({ x: el.offsetLeft, w: el.offsetWidth, ready: true });
  }, [value]);

  useLayoutEffect(() => {
    place();
  }, [place, items.length]);

  useEffect(() => {
    const onResize = () => place();
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, [place]);

  const pad = size === "sm" ? "px-2.5 py-1 text-[11px]" : "px-3 py-1.5 text-xs";

  return (
    <div
      role="tablist"
      aria-label={ariaLabel}
      className={`relative flex gap-0.5 rounded-lg border border-line bg-surf p-[3px] ${className}`}
    >
      <span
        aria-hidden="true"
        className="accent sliding pointer-events-none absolute top-[3px] bottom-[3px] left-0 rounded-md"
        style={{
          width: indicator.w,
          transform: `translateX(${indicator.x}px)`,
          opacity: indicator.ready ? 1 : 0,
          background: "color-mix(in srgb, var(--ac) 18%, transparent)",
        }}
      />
      {items.map((item) => {
        const isActive = item.id === value;
        return (
          <button
            key={item.id}
            ref={(el) => {
              refs.current[item.id] = el;
            }}
            type="button"
            role="tab"
            aria-selected={isActive}
            title={item.title}
            onClick={() => onChange(item.id)}
            className={`accent relative z-1 rounded-md font-semibold whitespace-nowrap ${pad} ${
              isActive ? "text-tx" : "text-tx2 hover:text-tx"
            }`}
            style={item.color ? { color: isActive ? item.color : undefined } : undefined}
          >
            {item.label}
          </button>
        );
      })}
    </div>
  );
}
