import { notFound } from "next/navigation";
import { getAsset } from "@/config/assets";
import { AssetTabs } from "@/features/chart/components/AssetTabs";
import { IntervalTabs } from "@/features/chart/components/IntervalTabs";
import { AutoRegime } from "@/features/gex/components/AutoRegime";
import { ExpiryFilterTabs } from "@/features/gex/components/ExpiryFilterTabs";
import { RegimePanel } from "@/features/gex/components/RegimePanel";
import { t } from "@/lib/i18n";
import { firstParam, parseExpiryFilter, parseInterval } from "@/lib/params";
import { getGexSnapshot } from "@/server/registry";
import { DataBadge } from "@/ui/DataBadge";
import { Skeleton } from "@/ui/Skeleton";

export const dynamic = "force-dynamic";

// Les chaînes CBOE (jusqu’à 13 Mo) peuvent être lentes à froid : on laisse
// de la marge au rendu serveur plutôt que de couper la requête.
export const maxDuration = 60;

type PageParams = { symbol: string };
type PageSearch = Record<string, string | string[] | undefined>;

export default async function ChartPage({
  params,
  searchParams,
}: {
  params: Promise<PageParams>;
  searchParams: Promise<PageSearch>;
}) {
  const { symbol } = await params;
  const search = await searchParams;
  const asset = getAsset(symbol);
  if (!asset) notFound();

  const filter = parseExpiryFilter(firstParam(search.exp));
  const interval = parseInterval(firstParam(search.tf));
  const snapshot = await getGexSnapshot(asset.id, { filter });
  const tr = t();

  return (
    <div className="flex h-full flex-col max-md:overflow-auto">
      <AutoRegime regime={snapshot.regime} />

      <div className="flex flex-none flex-wrap items-center gap-2 overflow-x-auto border-b border-line px-3.5 py-2">
        <AssetTabs view="chart" current={asset.id} />
        <IntervalTabs value={interval} />
        <ExpiryFilterTabs value={filter} />
        <div className="flex-1" />
        <DataBadge provenance={snapshot.provenance} estimated />
      </div>

      <div className="grid min-h-0 flex-1 grid-cols-1 overflow-hidden lg:grid-cols-[1fr_300px]">
        <div className="relative min-h-[320px] border-b border-line lg:border-b-0">
          {/* Phase 3 : lightweight-charts + primitive de bandes GEX */}
          <div className="absolute inset-0 grid place-items-center p-6">
            <div className="w-full max-w-[520px]">
              <p className="mb-3 text-center text-xs text-tx2">{tr.chart.loading}</p>
              <Skeleton className="h-3 w-2/3" />
              <Skeleton className="mt-2 h-3 w-1/2" />
              <Skeleton className="mt-6 h-40 w-full" />
            </div>
          </div>
        </div>
        <aside className="min-w-0 overflow-y-auto border-line lg:border-l">
          <RegimePanel
            snapshot={snapshot}
            label={asset.label}
            decimals={asset.priceDecimals}
          />
        </aside>
      </div>
    </div>
  );
}
