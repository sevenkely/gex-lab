"use client";

/** Unité de temps du graphique, mémorisée dans l'URL (`?tf=5m`). */

import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useTransition } from "react";
import { INTERVALS } from "@/lib/params";
import type { CandleInterval } from "@/server/providers/types";
import { Tabs } from "@/ui/Tabs";

export function IntervalTabs({ value }: { value: CandleInterval }) {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const [pending, startTransition] = useTransition();

  return (
    <div className={pending ? "opacity-70 transition-opacity" : ""}>
      <Tabs
        items={INTERVALS.map((interval) => ({ id: interval, label: interval }))}
        value={value}
        size="sm"
        ariaLabel="Unité de temps"
        onChange={(id) => {
          const next = new URLSearchParams(params.toString());
          next.set("tf", id);
          startTransition(() => {
            router.replace(`${pathname}?${next.toString()}`, { scroll: false });
          });
        }}
      />
    </div>
  );
}
