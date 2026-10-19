"use client";

/** Onglets d'actif : navigation par URL, indicateur glissant. */

import { useRouter } from "next/navigation";
import { ASSETS } from "@/config/assets";
import { Tabs } from "@/ui/Tabs";

export function AssetTabs({
  view,
  current,
  onlyPrimary = false,
}: {
  view: "chart" | "gamma";
  current: string;
  onlyPrimary?: boolean;
}) {
  const router = useRouter();
  const assets = onlyPrimary ? ASSETS.filter((a) => a.primary) : ASSETS;
  const items = assets.map((asset) => ({
    id: asset.id,
    label: asset.symbol,
    title: asset.label,
  }));

  return (
    <Tabs
      items={items}
      value={current}
      size="md"
      ariaLabel="Choix de l’actif"
      onChange={(id) => router.push(`/${view === "chart" ? "graphique" : "gamma"}/${id}`)}
    />
  );
}
