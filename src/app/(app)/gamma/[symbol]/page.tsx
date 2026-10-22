import { notFound, redirect } from "next/navigation";
import { getAsset } from "@/config/assets";
import { AssetTabs } from "@/features/chart/components/AssetTabs";
import { AutoRegime } from "@/features/gex/components/AutoRegime";
import { ExpiryFilterTabs } from "@/features/gex/components/ExpiryFilterTabs";
import { FilterEmpty } from "@/features/gex/components/FilterEmpty";
import { LEVEL_RGB, levelLabel } from "@/features/gex/components/level-style";
import { ExportLinks } from "@/features/gamma/components/ExportLinks";
import { StrikeBars } from "@/features/gamma/components/StrikeBars";
import { StrikeExpiryHeatmap } from "@/features/gamma/components/StrikeExpiryHeatmap";
import { fmt, fmtGexCompact } from "@/lib/format";
import { firstParam, parseExpiryFilter } from "@/lib/params";
import { t } from "@/lib/i18n";
import { getGexSnapshot, getStrikeExpiryMatrix } from "@/server/registry";
import { AssetMark } from "@/ui/AssetMark";
import { Card } from "@/ui/Card";
import { DataBadge } from "@/ui/DataBadge";
import { PageHeader, Stat } from "@/ui/PageHeader";
import { AutoRefresh } from "@/ui/AutoRefresh";
import { ReportProvenance } from "@/ui/ReportProvenance";

export const dynamic = "force-dynamic";

// Les chaînes CBOE (jusqu’à 13 Mo) peuvent être lentes à froid : on laisse
// de la marge au rendu serveur plutôt que de couper la requête.
export const maxDuration = 60;

type PageParams = { symbol: string };
type PageSearch = Record<string, string | string[] | undefined>;

/** Libellé court de l'échéance filtrée. */
function filterLabel(filter: string): string {
  if (filter === "ALL") return "toutes échéances";
  if (filter === "0DTE") return "0DTE";
  return filter;
}

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
  if (asset.redirectTo) redirect(`/gamma/${asset.redirectTo}`);

  const filter = parseExpiryFilter(firstParam(search.exp));
  const [snapshot, heatmap] = await Promise.all([
    getGexSnapshot(asset.id, { filter }),
    getStrikeExpiryMatrix(asset.id, { filter }),
  ]);
  const tr = t();

  const ofKind = (kind: string) =>
    snapshot.levels
      .filter((level) => level.kind === kind)
      .sort((a, b) => (a.rank ?? 1) - (b.rank ?? 1));
  const walls = [...ofKind("callWall"), ...ofKind("putWall")];
  const flip = ofKind("zeroGamma")[0];
  const maxPain = ofKind("maxPain")[0];
  const longRegime = snapshot.regime === "long";

  // Une carte par niveau principal : le rang 2 (second mur) vit dans le
  // panneau des murs, sinon deux étiquettes porteraient le même nom.
  const cards = [
    {
      key: "netGex",
      label: tr.metrics.netGex,
      value: fmtGexCompact(snapshot.netGex),
      rgb: snapshot.netGex >= 0 ? LEVEL_RGB.callWall : LEVEL_RGB.putWall,
      hint: "couverture / +1 %",
    },
    {
      key: "flip",
      label: tr.levels.zeroGamma,
      value: flip ? fmt(flip.price, asset.priceDecimals) : "—",
      rgb: LEVEL_RGB.zeroGamma,
      hint: "flip du régime",
    },
    {
      key: "spot",
      label: tr.metrics.spot,
      value: fmt(snapshot.spot, asset.priceDecimals),
      rgb: "230,236,245",
      hint: "sous-jacent",
    },
    {
      key: "em",
      label: tr.metrics.expectedMove,
      value: snapshot.expectedMove
        ? `± ${fmt(snapshot.expectedMove.points, asset.priceDecimals)}`
        : "—",
      rgb: "160,185,230",
      hint: "1 écart-type",
    },
    {
      key: "maxPain",
      label: tr.levels.maxPain,
      value: maxPain ? fmt(maxPain.price, asset.priceDecimals) : "—",
      rgb: LEVEL_RGB.maxPain,
      hint: "strike de douleur minimale",
    },
  ];

  return (
    <div className="h-full overflow-auto">
      <ReportProvenance provenance={snapshot.provenance} />
      <AutoRefresh />
      <AutoRegime regime={snapshot.regime} />
      <div className="mx-auto max-w-[1180px] p-4 lg:p-6">
        <PageHeader
          eyebrow={
            <span className="flex items-center gap-2">
              <AssetMark assetId={asset.id} size={18} />
              <span>
                {snapshot.symbol} · {filterLabel(filter)} · {snapshot.contracts} contrats
              </span>
            </span>
          }
          title={
            <>
              Où le gamma pèse, <span className="text-ac">strike par strike</span>.
            </>
          }
          lead={
            <>
              Chaque barre est le GEX du strike à ± 1 % de spot : puts à gauche (rouge),
              calls à droite (vert), spot surligné. La matrice croise ensuite ces mêmes
              strikes avec les échéances pour montrer quelle date porte l’exposition.
            </>
          }
          aside={<DataBadge provenance={snapshot.provenance} estimated />}
        />

        <div
          className={`rise mb-4 flex flex-wrap items-center gap-x-3 gap-y-1.5 rounded-lg border px-3.5 py-2.5 text-[11px] ${
            longRegime ? "border-call/30 bg-call/8" : "border-put/30 bg-put/8"
          }`}
        >
          <span
            className={`flex items-center gap-1.5 font-mono tracking-[0.14em] uppercase ${
              longRegime ? "text-call" : "text-put"
            }`}
          >
            <i
              aria-hidden="true"
              className="size-1.5 animate-[pulse_2.4s_ease-in-out_infinite] rounded-full bg-current"
            />
            {longRegime ? tr.regime.long : tr.regime.short}
          </span>
          <span className="text-tx2">
            {longRegime
              ? "La couverture des dealers amortit les mouvements : le prix gravite autour des murs."
              : "La couverture des dealers amplifie les mouvements : les murs deviennent des accélérateurs."}
          </span>
          <span className="num ml-auto text-tx2">
            flip {flip ? fmt(flip.price, asset.priceDecimals) : "—"} · spot{" "}
            {fmt(snapshot.spot, asset.priceDecimals)}
          </span>
        </div>

        <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
          <AssetTabs view="gamma" current={asset.id} />
          <div className="flex flex-wrap items-center gap-3">
            <ExpiryFilterTabs value={filter} expiryDates={snapshot.frontExpiries} />
            <ExportLinks assetId={asset.id} filter={filter} />
          </div>
        </div>

        {snapshot.contracts === 0 ? (
          <FilterEmpty
            symbol={snapshot.symbol}
            filter={snapshot.filter}
            className="max-w-[560px]"
          />
        ) : (
          <>
            <div className="flex flex-col gap-3 lg:flex-row lg:items-start">
              <div className="grid flex-1 grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
                {cards.map((card, index) => (
                  <Stat
                    key={card.key}
                    index={index}
                    label={card.label}
                    value={card.value}
                    rgb={card.rgb}
                    hint={card.hint}
                  />
                ))}
              </div>

              <Card
                padded={false}
                className="flex-none self-start overflow-hidden lg:w-[268px]"
              >
                <header className="flex items-baseline justify-between border-b border-line px-3.5 py-2">
                  <h3 className="text-[11px] font-semibold text-tx2">Murs de gamma</h3>
                  <span className="num text-[9px] text-tx2">± 15 % du spot</span>
                </header>
                {walls.map((wall) => {
                  const distance = (wall.price / snapshot.spot - 1) * 100;
                  const rank = wall.rank ?? 1;
                  return (
                    <div
                      key={`${wall.kind}-${rank}`}
                      className="grid grid-cols-[auto_1fr_auto_auto] items-center gap-2 border-b border-line px-3.5 py-1.5 text-[11px] last:border-0"
                    >
                      <i
                        aria-hidden="true"
                        className="size-1.5 rounded-full"
                        style={{ background: `rgb(${LEVEL_RGB[wall.kind]})` }}
                      />
                      <span className="truncate text-tx2">
                        {levelLabel(wall.kind)}
                        {rank > 1 ? ` ${rank}` : ""}
                      </span>
                      <span className="num text-tx">
                        {fmt(wall.price, asset.priceDecimals)}
                      </span>
                      <span
                        className={`num w-[54px] text-right text-[10px] ${
                          distance >= 0 ? "text-call" : "text-put"
                        }`}
                      >
                        {`${distance >= 0 ? "+" : "−"}${fmt(Math.abs(distance), 2)} %`}
                      </span>
                    </div>
                  );
                })}
                {walls.length === 0 && (
                  <p className="px-3.5 py-3 text-[11px] text-tx2">
                    Aucun mur dans la fenêtre autour du spot.
                  </p>
                )}
              </Card>
            </div>

            <section className="mt-6">
              <div className="mb-2.5 flex flex-wrap items-baseline justify-between gap-2">
                <div>
                  <p className="flex items-center gap-2 font-mono text-[10px] tracking-[0.16em] text-tx2 uppercase">
                    <span aria-hidden="true" className="h-px w-6 bg-ac/60" />
                    Profil par strike
                  </p>
                  <h3 className="mt-1.5 text-base font-semibold tracking-[-0.02em]">
                    {tr.gamma.subtitle}
                  </h3>
                </div>
                <span className="num text-[10px] text-tx2">
                  ± 8 strikes · spot {fmt(snapshot.spot, asset.priceDecimals)}
                </span>
              </div>

              <Card padded>
                <StrikeBars
                  rows={snapshot.byStrike}
                  spot={snapshot.spot}
                  decimals={asset.priceDecimals}
                />
                <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-1.5 border-t border-line pt-2.5 text-[10px] text-tx2">
                  <span className="flex items-center gap-1.5">
                    <i aria-hidden="true" className="size-2 rounded-[2px] bg-put/80" />
                    puts · GEX négatif
                  </span>
                  <span className="flex items-center gap-1.5">
                    <i aria-hidden="true" className="size-2 rounded-[2px] bg-call/80" />
                    calls · GEX positif
                  </span>
                  <span className="num ml-auto">
                    net {fmtGexCompact(snapshot.netGex)}
                  </span>
                </div>
              </Card>
            </section>
          </>
        )}

        <section className="mt-6">
          <div className="mb-2.5 flex flex-wrap items-baseline justify-between gap-2">
            <div>
              <p className="flex items-center gap-2 font-mono text-[10px] tracking-[0.16em] text-tx2 uppercase">
                <span aria-hidden="true" className="h-px w-6 bg-ac/60" />
                Strike × échéance
              </p>
              <h3 className="mt-1.5 text-base font-semibold tracking-[-0.02em]">
                {tr.matrix.title}
              </h3>
            </div>
            <span className="num text-[10px] text-tx2">
              {heatmap.matrix.expiries.length} échéances · {heatmap.matrix.rows.length}{" "}
              strikes
            </span>
          </div>

          <Card padded>
            <StrikeExpiryHeatmap
              matrix={heatmap.matrix}
              spot={heatmap.spot}
              generatedAt={heatmap.generatedAt}
              decimals={asset.priceDecimals}
              timeframe={heatmap.filter === "ALL" ? "toutes échéances" : heatmap.filter}
            />
          </Card>
        </section>
      </div>
    </div>
  );
}
