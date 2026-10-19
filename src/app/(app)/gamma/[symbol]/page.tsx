import { notFound } from "next/navigation";
import { getAsset } from "@/config/assets";
import { AssetTabs } from "@/features/chart/components/AssetTabs";
import { AutoRegime } from "@/features/gex/components/AutoRegime";
import { ExpiryFilterTabs } from "@/features/gex/components/ExpiryFilterTabs";
import { LEVEL_RGB, levelLabel } from "@/features/gex/components/level-style";
import { StrikeBars } from "@/features/gamma/components/StrikeBars";
import { fmt, fmtGexCompact } from "@/lib/format";
import { firstParam, parseExpiryFilter } from "@/lib/params";
import { t } from "@/lib/i18n";
import { getGexSnapshot } from "@/server/registry";
import { Card } from "@/ui/Card";
import { DataBadge } from "@/ui/DataBadge";

export const dynamic = "force-dynamic";

// Les chaînes CBOE (jusqu’à 13 Mo) peuvent être lentes à froid : on laisse
// de la marge au rendu serveur plutôt que de couper la requête.
export const maxDuration = 60;

type PageParams = { symbol: string };
type PageSearch = Record<string, string | string[] | undefined>;

export default async function GammaPage({
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
  const snapshot = await getGexSnapshot(asset.id, { filter });
  const tr = t();

  const cards = [
    {
      label: tr.metrics.netGex,
      value: fmtGexCompact(snapshot.netGex),
      rgb: "232,216,168",
    },
    ...snapshot.levels
      .filter((level) => level.kind !== "maxGamma")
      .map((level) => ({
        label: levelLabel(level.kind),
        value: fmt(level.price, asset.priceDecimals),
        rgb: LEVEL_RGB[level.kind],
      })),
    {
      label: tr.metrics.spot,
      value: fmt(snapshot.spot, asset.priceDecimals),
      rgb: "230,236,245",
    },
    {
      label: tr.metrics.expectedMove,
      value: snapshot.expectedMove
        ? `± ${fmt(snapshot.expectedMove.points, asset.priceDecimals)}`
        : "—",
      rgb: "160,185,230",
    },
  ];

  return (
    <div className="h-full overflow-auto p-4">
      <AutoRegime regime={snapshot.regime} />
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <AssetTabs view="gamma" current={asset.id} />
        <div className="flex items-center gap-2">
          <ExpiryFilterTabs value={filter} />
          <DataBadge provenance={snapshot.provenance} estimated />
        </div>
      </div>

      <div className="grid grid-cols-[repeat(auto-fit,minmax(150px,1fr))] gap-3">
        {cards.map((card, index) => (
          <div
            key={card.label}
            style={{ ["--i" as string]: index }}
            className="rise panel p-3.5"
          >
            <div className="text-[11px] text-tx2">{card.label}</div>
            <div
              className="num mt-1 text-xl font-semibold"
              style={{ color: `rgb(${card.rgb})` }}
            >
              {card.value}
            </div>
          </div>
        ))}
      </div>

      <Card
        className="mt-3 max-w-[900px]"
        title={tr.gamma.subtitle}
        aside={
          <span className="num text-[11px] text-tx2">{snapshot.contracts} contrats</span>
        }
      >
        <StrikeBars
          rows={snapshot.byStrike}
          spot={snapshot.spot}
          decimals={asset.priceDecimals}
        />
        <p className="mt-3 text-[11px] text-tx2">
          Fenêtre de ± 8 strikes autour du spot. Barres à gauche : puts (GEX négatif), à
          droite : calls (GEX positif). Le calcul est le même que celui du graphique —
          seules les échéances du filtre changent.
        </p>
      </Card>
    </div>
  );
}
