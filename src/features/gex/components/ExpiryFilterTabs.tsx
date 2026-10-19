"use client";

/**
 * Filtre d'échéance. L'état vit dans l'URL (`?exp=ALL|0DTE|7D|35D`) :
 * les snapshots sont calculés côté serveur, donc l'URL est la source de vérité
 * (partageable, cacheable, et le retour arrière fonctionne).
 */

import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useTransition } from "react";
import { EXPIRY_FILTERS, type ExpiryFilter } from "@/config/assets";
import { t } from "@/lib/i18n";
import { Tabs } from "@/ui/Tabs";

export function ExpiryFilterTabs({ value }: { value: ExpiryFilter }) {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const [pending, startTransition] = useTransition();

  const items = EXPIRY_FILTERS.map((filter) => ({
    id: filter.id,
    label: filter.id === "ALL" ? t().common.all : filter.label,
  }));

  return (
    <div className={pending ? "opacity-70 transition-opacity" : ""}>
      <Tabs
        items={items}
        value={value}
        size="sm"
        ariaLabel="Filtre d’échéance"
        onChange={(id) => {
          const next = new URLSearchParams(params.toString());
          if (id === "ALL") next.delete("exp");
          else next.set("exp", id);
          startTransition(() => {
            router.replace(`${pathname}?${next.toString()}`, { scroll: false });
          });
        }}
      />
    </div>
  );
}
