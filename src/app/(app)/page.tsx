import Link from "next/link";
import { CHART_ASSETS, getAsset } from "@/config/assets";
import { AutoRegime } from "@/features/gex/components/AutoRegime";
import { RegimeBadge } from "@/features/gex/components/RegimeBadge";
import { AssetCard } from "@/features/home/components/AssetCard";
import { fmt, fmtAmount, fmtGexCompact, fmtMoney } from "@/lib/format";
import { t } from "@/lib/i18n";
import { nyDateLabel, nyTimeShort } from "@/lib/time";
import { getBoard, getFlow } from "@/server/registry";
import { Card } from "@/ui/Card";
import { DataBadge } from "@/ui/DataBadge";
import { GexBars } from "@/ui/GexBars";
import { PageHeader } from "@/ui/PageHeader";

export const dynamic = "force-dynamic";

// Les chaînes CBOE (jusqu’à 13 Mo) peuvent être lentes à froid : on laisse
// de la marge au rendu serveur plutôt que de couper la requête.
export const maxDuration = 60;

/**
 * Les données sont attendues dans le composant de page (pas de `loading.tsx`,
 * pas de <Suspense> autour du contenu) : c'est la seule configuration où
 * l'hydratation des composants clients de la page est garantie avec la version
 * courante de Next/Turbopack. Voir docs/DATA-SOURCES.md.
 */
export default async function HomePage() {
  const tr = t();
  const [board, flow] = await Promise.all([
    getBoard(CHART_ASSETS),
    getFlow(getAsset("BTC")!, 8),
  ]);

  const primary = board.filter((row) => row.primary);
  const secondary = board.filter((row) => !row.primary);
  const reference = primary.find((row) => row.assetId === "ES") ?? primary[0];
  const all = [...primary, ...secondary];
  const longs = all.filter((row) => row.regime === "long").length;
  const shorts = all.length - longs;

  const flip = reference.zeroGamma;
  const flipDistance =
    flip && reference.price ? (reference.price / flip - 1) * 100 : null;
  // Position du spot sur une échelle ±2 % autour du flip : au-delà, le point
  // reste collé au bord, l'information est la direction, pas l'amplitude.
  const flipPosition =
    flipDistance === null ? 50 : Math.max(4, Math.min(96, 50 + (flipDistance / 2) * 50));

  return (
    <div className="h-full overflow-auto">
      <div className="mx-auto max-w-[1560px] p-4 lg:p-6">
        <AutoRegime regime={reference?.regime ?? "long"} />

        <PageHeader
          eyebrow={`Séance · ${nyDateLabel(new Date(reference.provenance.asOf))} · New York`}
          title={
            <>
              Le régime, <span className="text-ac">actif par actif</span>.
            </>
          }
          lead={
            <>
              {longs} actif{longs > 1 ? "s" : ""} au-dessus du flip, {shorts} en dessous.
              Sous le zero gamma, la couverture des dealers amplifie les mouvements ;
              au-dessus, elle les amortit. Chaque carte ouvre le graphique de l’actif.
            </>
          }
          aside={
            <>
              <div className="text-right">
                <div className="font-mono text-[10px] tracking-[0.12em] text-tx2 uppercase">
                  Net GEX · {reference.symbol}
                </div>
                <div className="num mt-1 text-2xl leading-none font-semibold text-zero">
                  {fmtGexCompact(reference.netGex)}
                </div>
              </div>
              <DataBadge provenance={reference.provenance} />
            </>
          }
        />

        <div className="mb-5">
          <div className="mb-2.5 flex items-baseline justify-between">
            <h3 className="font-mono text-[10px] tracking-[0.16em] text-tx2 uppercase">
              {tr.home.tape}
            </h3>
            <span className="num text-[10px] text-tx2">
              {all.length} actifs · CBOE 15 min
            </span>
          </div>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
            {primary.map((row, index) => (
              <AssetCard key={row.assetId} row={row} index={index} />
            ))}
            {secondary.map((row, index) => (
              <AssetCard key={row.assetId} row={row} index={index + primary.length} />
            ))}
          </div>
        </div>

        <div className="grid items-start gap-4 lg:grid-cols-[minmax(0,1.65fr)_minmax(0,1fr)]">
          <div className="flex min-w-0 flex-col gap-4">
            <Card
              title={tr.home.netGexByTicker}
              aside={<span className="text-[10px] text-tx2">$ / +1 % de spot</span>}
            >
              <div className="py-1">
                <GexBars
                  rows={all.map((row) => ({
                    symbol: row.symbol,
                    value: row.netGex,
                  }))}
                />
              </div>
              <p className="mt-3 border-t border-line pt-2.5 text-[11px] text-tx2">
                Positif = la couverture dealer amortit les mouvements (long gamma).
                Négatif = elle les amplifie (short gamma).
              </p>
            </Card>

            <Card
              title={tr.home.recentFlow}
              aside={
                <Link
                  href="/flux"
                  className="group inline-flex items-center gap-1 text-[11px] text-tx2 transition-colors hover:text-ac"
                >
                  {tr.nav.flow}
                  <span
                    aria-hidden="true"
                    className="transition-transform duration-200 group-hover:translate-x-0.5"
                  >
                    →
                  </span>
                </Link>
              }
            >
              <ul className="flex flex-col">
                {flow.trades.slice(0, 7).map((trade, index) => (
                  <li
                    key={trade.id}
                    style={{ ["--i" as string]: index }}
                    className="rise grid grid-cols-[44px_1fr_auto] items-center gap-3 border-b border-line py-2 text-xs last:border-0"
                  >
                    <span className="num text-[10px] text-tx2">
                      {nyTimeShort(trade.ts)}
                    </span>
                    <span className="flex min-w-0 items-center gap-2">
                      <i
                        aria-hidden="true"
                        className={`size-1.5 flex-none rounded-full ${
                          trade.type === "call" ? "bg-call" : "bg-put"
                        }`}
                      />
                      <b>{trade.assetId}</b>
                      <span className={trade.type === "call" ? "text-call" : "text-put"}>
                        {trade.type === "call" ? "C" : "P"} {fmt(trade.strike, 0)}
                      </span>
                      <span className="hidden truncate text-[10px] text-tx2 sm:inline">
                        {fmtAmount(trade.amount)} × {fmt(trade.price, 2)}
                      </span>
                    </span>
                    <span className="num text-right text-tx">
                      {fmtMoney(trade.premiumUsd)}
                    </span>
                  </li>
                ))}
              </ul>
              <div className="mt-2.5 flex items-center justify-between gap-2 border-t border-line pt-2.5">
                <DataBadge provenance={flow.provenance} compact />
                <span className="text-[10px] text-tx2">Deribit · REST</span>
              </div>
            </Card>
          </div>

          <div className="flex min-w-0 flex-col gap-4">
            <Card
              title={tr.home.regimeOfDay}
              aside={<DataBadge provenance={reference.provenance} compact estimated />}
            >
              <RegimeBadge regime={reference.regime} className="mb-3" />

              {flip && (
                <div className="mb-4">
                  <div className="mb-1.5 flex items-center justify-between text-[10px] text-tx2">
                    <span>sous le flip</span>
                    <span>au-dessus</span>
                  </div>
                  <div className="relative h-1.5 rounded-full bg-white/6">
                    <span
                      aria-hidden="true"
                      className="absolute inset-y-0 left-1/2 w-px bg-tx2/50"
                    />
                    <span
                      aria-hidden="true"
                      className="absolute top-1/2 size-2.5 -translate-x-1/2 -translate-y-1/2 rounded-full border border-bg bg-tx shadow-[0_0_10px_rgba(230,236,245,.35)]"
                      style={{ left: `${flipPosition}%` }}
                    />
                  </div>
                  <div className="mt-1.5 flex items-center justify-between text-[10px]">
                    <span className="num text-tx2">
                      flip {fmt(flip, reference.priceDecimals)}
                    </span>
                    <span
                      className={`num ${
                        (flipDistance ?? 0) >= 0 ? "text-call" : "text-put"
                      }`}
                    >
                      {flipDistance === null
                        ? "—"
                        : `${flipDistance >= 0 ? "+" : "−"}${fmt(
                            Math.abs(flipDistance),
                            2,
                          )} %`}
                    </span>
                  </div>
                </div>
              )}

              <dl className="grid grid-cols-2 gap-x-3 gap-y-2.5 text-xs">
                <div>
                  <dt className="text-[10px] tracking-[0.08em] text-tx2 uppercase">
                    {tr.metrics.spot}
                  </dt>
                  <dd className="num mt-0.5">
                    {fmt(reference.price, reference.priceDecimals)}
                  </dd>
                </div>
                <div>
                  <dt className="text-[10px] tracking-[0.08em] text-tx2 uppercase">
                    {tr.levels.zeroGamma}
                  </dt>
                  <dd className="num mt-0.5">
                    {flip ? fmt(flip, reference.priceDecimals) : "—"}
                  </dd>
                </div>
                <div>
                  <dt className="text-[10px] tracking-[0.08em] text-tx2 uppercase">
                    {tr.metrics.netGex}
                  </dt>
                  <dd className="num mt-0.5">{fmtGexCompact(reference.netGex)}</dd>
                </div>
                <div>
                  <dt className="text-[10px] tracking-[0.08em] text-tx2 uppercase">
                    {tr.metrics.expectedMove}
                  </dt>
                  <dd className="num mt-0.5">
                    {reference.expectedMovePct !== null
                      ? `± ${fmt(reference.expectedMovePct, 2)} %`
                      : "—"}
                  </dd>
                </div>
              </dl>

              <p className="mt-3 border-t border-line pt-2.5 text-[11px] leading-relaxed text-tx2">
                Le régime compare le spot au zero gamma de {reference.symbol}.
                {reference.regime === "long"
                  ? " Au-dessus du flip, la couverture amortit les mouvements."
                  : " Sous le flip, la couverture amplifie les mouvements."}
              </p>
            </Card>

            <Card
              title={`Distance au flip · ${all.length} actifs`}
              aside={<span className="text-[10px] text-tx2">spot / zero γ</span>}
            >
              <ul className="flex flex-col gap-2.5">
                {all.map((row, index) => {
                  const distance =
                    row.zeroGamma && row.price
                      ? (row.price / row.zeroGamma - 1) * 100
                      : null;
                  return (
                    <li
                      key={row.assetId}
                      style={{ ["--i" as string]: index }}
                      className="rise grid grid-cols-[40px_1fr_58px] items-center gap-2 text-[11px]"
                    >
                      <b className="text-xs">{row.symbol}</b>
                      <span className="relative h-1 rounded-full bg-white/5">
                        <span
                          aria-hidden="true"
                          className="absolute inset-y-0 left-1/2 w-px bg-line"
                        />
                        <span
                          aria-hidden="true"
                          className={`absolute top-1/2 size-1.5 -translate-y-1/2 rounded-full ${
                            (distance ?? 0) >= 0 ? "bg-call" : "bg-put"
                          }`}
                          style={{
                            left: `${Math.max(
                              2,
                              Math.min(98, 50 + (distance ?? 0) * 8),
                            )}%`,
                          }}
                        />
                      </span>
                      <span
                        className={`num text-right ${
                          (distance ?? 0) >= 0 ? "text-call" : "text-put"
                        }`}
                      >
                        {distance === null
                          ? "—"
                          : `${distance >= 0 ? "+" : "−"}${fmt(Math.abs(distance), 2)} %`}
                      </span>
                    </li>
                  );
                })}
              </ul>
              <p className="mt-3 border-t border-line pt-2.5 text-[10px] leading-relaxed text-tx2">
                Écart entre le prix et le zero gamma calculé sur chaque actif. Le régime
                bascule dès que le spot traverse ce niveau.
              </p>
            </Card>
          </div>
        </div>
      </div>
    </div>
  );
}
