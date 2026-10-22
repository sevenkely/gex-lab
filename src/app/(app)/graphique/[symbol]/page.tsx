import { notFound, redirect } from "next/navigation";
import { CHART_EXPIRY_FILTERS, getAsset } from "@/config/assets";
import { AssetTabs } from "@/features/chart/components/AssetTabs";
import { ChartWorkspace } from "@/features/chart/components/ChartWorkspace";
import { IntervalTabs } from "@/features/chart/components/IntervalTabs";
import { AutoRegime } from "@/features/gex/components/AutoRegime";
import { ExpiryFilterTabs } from "@/features/gex/components/ExpiryFilterTabs";
import { WINDOW_HOURS } from "@/lib/candles";
import { firstParam, parseExpiryFilter, parseInterval } from "@/lib/params";
import type { CandleInterval } from "@/server/providers/types";
import { getCandleSeries, getGexSnapshot } from "@/server/registry";
import { DataBadge } from "@/ui/DataBadge";

export const dynamic = "force-dynamic";

// Les chaînes CBOE (jusqu’à 13 Mo) peuvent être lentes à froid : on laisse
// de la marge au rendu serveur plutôt que de couper la requête.
export const maxDuration = 60;

type PageParams = { symbol: string };
type PageSearch = Record<string, string | string[] | undefined>;

/** Charge les données du graphique (hors rendu : pas d'appel impur dans le composant). */
async function loadChart(
  asset: NonNullable<ReturnType<typeof getAsset>>,
  filter: ReturnType<typeof parseExpiryFilter>,
  interval: CandleInterval,
) {
  const to = Date.now();
  const from = to - WINDOW_HOURS[interval] * 3_600_000;
  const [snapshot, candleResult] = await Promise.all([
    getGexSnapshot(asset.id, { filter }),
    getCandleSeries(asset, interval, { from, to }),
  ]);
  return { snapshot, candles: candleResult.data.candles };
}

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

  // Les ETF/indices ne sont plus des vues : leur chaîne d'options alimente le
  // future mappé. L'ancien lien continue de fonctionner.
  if (asset.redirectTo) redirect(`/graphique/${asset.redirectTo}`);

  // `0DTE` par défaut : on ouvre sur l'échéance qui fait bouger le prix du
  // jour (murs, flip, max pain de la séance). « Toutes » reste à un clic et
  // son choix est écrit dans l'URL (`?exp=ALL`), donc il ne se perd pas.
  const filter = parseExpiryFilter(firstParam(search.exp), "0DTE");
  const interval = parseInterval(firstParam(search.tf));
  const { snapshot, candles } = await loadChart(asset, filter, interval);

  return (
    <div className="flex h-full flex-col max-md:overflow-auto">
      <AutoRegime regime={snapshot.regime} />

      <div className="flex flex-none flex-wrap items-center gap-2 overflow-x-auto border-b border-line px-3.5 py-2">
        <AssetTabs view="chart" current={asset.id} />
        <IntervalTabs value={interval} />
        <ExpiryFilterTabs
          value={filter}
          filters={CHART_EXPIRY_FILTERS}
          expiryDates={snapshot.frontExpiries}
          defaultValue="0DTE"
        />
        <div className="flex-1" />
        <DataBadge provenance={snapshot.provenance} estimated />
      </div>

      <ChartWorkspace
        snapshot={snapshot}
        candles={candles}
        interval={interval}
        label={asset.label}
        decimals={asset.priceDecimals}
      />
    </div>
  );
}
