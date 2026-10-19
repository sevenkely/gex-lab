"use client";

/**
 * « Rolling digits » : la valeur s'anime par interpolation et s'écrit
 * directement dans le DOM (aucun re-render React par frame).
 *
 * Le formatage est décrit par un **descripteur sérialisable** (`RollFormat`) et
 * non par une fonction : les composants serveur peuvent donc l'utiliser sans
 * franchir la frontière RSC avec une closure.
 */

import { useEffect, useRef } from "react";

export type RollFormat =
  | { kind: "number"; decimals?: number }
  | { kind: "gex" }
  | { kind: "money" }
  | { kind: "price"; decimals?: number };

function formatWith(format: RollFormat, value: number): string {
  switch (format.kind) {
    case "number":
      return value.toLocaleString("en-US", {
        minimumFractionDigits: format.decimals ?? 2,
        maximumFractionDigits: format.decimals ?? 2,
      });
    case "price":
      return value.toLocaleString("en-US", {
        minimumFractionDigits: format.decimals ?? 2,
        maximumFractionDigits: format.decimals ?? 2,
      });
    case "money": {
      const abs = Math.abs(value);
      if (abs >= 1e9) return `${value < 0 ? "−" : ""}$${(abs / 1e9).toFixed(2)} Md`;
      if (abs >= 1e6) return `${value < 0 ? "−" : ""}$${(abs / 1e6).toFixed(2)} M`;
      if (abs >= 1e3) return `${value < 0 ? "−" : ""}$${Math.round(abs / 1e3)} k`;
      return `${value < 0 ? "−" : ""}$${Math.round(abs)}`;
    }
    case "gex": {
      const abs = Math.abs(value);
      const sign = value < 0 ? "−" : "+";
      if (abs >= 1e9) return `${sign}${(abs / 1e9).toFixed(2)} Md$`;
      if (abs >= 1e6) return `${sign}${(abs / 1e6).toFixed(1)} M$`;
      if (abs >= 1e3) return `${sign}${(abs / 1e3).toFixed(1)} k$`;
      return `${sign}${abs.toFixed(0)}$`;
    }
  }
}

export function NumberRoll({
  value,
  format,
  duration = 400,
  className = "",
  flash = false,
}: {
  value: number;
  format: RollFormat;
  duration?: number;
  className?: string;
  /** Flashe brièvement la valeur quand elle change (ticks de prix). */
  flash?: boolean;
}) {
  const ref = useRef<HTMLSpanElement | null>(null);
  const fromRef = useRef(value);
  const rafRef = useRef(0);
  // Le descripteur est un objet : on le sérialise pour ne pas relancer
  // l'animation à chaque rendu (nouvelle référence d'objet).
  const key = JSON.stringify(format);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const descriptor = JSON.parse(key) as RollFormat;
    const from = fromRef.current;
    const to = value;
    cancelAnimationFrame(rafRef.current);

    const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

    if (reduced || from === to || duration <= 0) {
      el.textContent = formatWith(descriptor, to);
      fromRef.current = to;
      return;
    }

    const start = performance.now();
    const step = (now: number) => {
      const progress = Math.min(1, (now - start) / duration);
      const eased = 1 - (1 - progress) ** 3;
      el.textContent = formatWith(descriptor, from + (to - from) * eased);
      if (progress < 1) rafRef.current = requestAnimationFrame(step);
      else fromRef.current = to;
    };
    rafRef.current = requestAnimationFrame(step);
    return () => cancelAnimationFrame(rafRef.current);
  }, [value, duration, key]);

  useEffect(() => {
    const el = ref.current;
    if (!el || !flash) return;
    el.classList.remove("flash-value");
    void el.offsetWidth;
    el.classList.add("flash-value");
  }, [value, flash]);

  return (
    <span ref={ref} className={className}>
      {formatWith(format, value)}
    </span>
  );
}
