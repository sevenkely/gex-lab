"use client";

/**
 * Filtre d'échéance. L'état vit dans l'URL (`?exp=0DTE|1DTE|7D|35D`) :
 * les snapshots sont calculés côté serveur, donc l'URL est la source de vérité
 * (partageable, cacheable, et le retour arrière fonctionne).
 *
 * 0DTE et 1DTE désignent la première et la deuxième échéance **listée** : la
 * date réelle est rappelée en info-bulle, car après la clôture ou le vendredi
 * ce n'est plus « aujourd'hui » ni « demain » au sens calendaire.
 */

import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useTransition } from "react";
import {
  EXPIRY_FILTERS,
  type ExpiryFilter,
} from "@/config/assets";
import { t } from "@/lib/i18n";
import { formatExpiry } from "@/lib/time";
import { Tabs } from "@/ui/Tabs";

export function ExpiryFilterTabs({
  value,
  filters,
  expiryDates = [],
  defaultValue = "ALL",
}: {
  value: ExpiryFilter;
  /** Sous-ensemble affiché ; par défaut, tous les filtres. */
  filters?: readonly ExpiryFilter[];
  /** Deux échéances frontales (ms) pour documenter 0DTE / 1DTE. */
  expiryDates?: readonly number[];
  /**
   * Filtre de la page quand `?exp` est absent : c'est lui qui s'efface de
   * l'URL pour garder des liens courts. Sans ce réglage, une page qui ouvre
   * en 0DTE ramènerait « Toutes » à 0DTE au rechargement.
   */
  defaultValue?: ExpiryFilter;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const [pending, startTransition] = useTransition();
  const tr = t();

  const items = (filters ?? EXPIRY_FILTERS.map((filter) => filter.id)).flatMap((id) => {
    const filter = EXPIRY_FILTERS.find((entry) => entry.id === id);
    if (!filter) return [];
    const index = id === "0DTE" ? 0 : id === "1DTE" ? 1 : -1;
    const date = index >= 0 ? expiryDates[index] : undefined;
    return [
      {
        id: filter.id,
        label: filter.id === "ALL" ? tr.common.all : filter.label,
        title: date ? `${tr.chart.expiry} ${formatExpiry(date)}` : undefined,
      },
    ];
  });

  return (
    <div className={pending ? "opacity-70 transition-opacity" : ""}>
      <Tabs
        items={items}
        value={value}
        size="sm"
        ariaLabel="Filtre d’échéance"
        onChange={(id) => {
          const next = new URLSearchParams(params.toString());
          if (id === defaultValue) next.delete("exp");
          else next.set("exp", id);
          startTransition(() => {
            router.replace(`${pathname}?${next.toString()}`, { scroll: false });
          });
        }}
      />
    </div>
  );
}
