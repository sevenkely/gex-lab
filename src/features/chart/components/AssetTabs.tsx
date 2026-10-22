"use client";

/** Onglets d'actif : navigation par URL, indicateur glissant. */

import { useRouter } from "next/navigation";
import { CHART_ASSETS } from "@/config/assets";
import { AssetMark } from "@/ui/AssetMark";
import { Tabs } from "@/ui/Tabs";

/**
 * Seuls les actifs chartés sont proposés. Les chaînes d'options pures (SPX,
 * SPY, QQQ, GLD) restent des sources côté registre mais redirigent vers le
 * future correspondant : on ne trade pas l'ETF, on trade le contrat.
 */
export function AssetTabs({
  view,
  current,
}: {
  view: "chart" | "gamma";
  current: string;
}) {
  const router = useRouter();
  const assets = CHART_ASSETS;
  const items = assets.map((asset) => ({
    id: asset.id,
    label: asset.symbol,
    title: asset.label,
    icon: <AssetMark assetId={asset.id} size={16} />,
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
