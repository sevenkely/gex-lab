import Link from "next/link";
import { ASSETS, getAsset } from "@/config/assets";
import { AutoRegime } from "@/features/gex/components/AutoRegime";
import { RegimeBadge } from "@/features/gex/components/RegimeBadge";
import { AssetCard } from "@/features/home/components/AssetCard";
import { fmt, fmtGexCompact, fmtMoney } from "@/lib/format";
import { t } from "@/lib/i18n";
import { nyTimeShort } from "@/lib/time";
import { getBoard, getFlow } from "@/server/registry";
import { Card } from "@/ui/Card";
import { DataBadge } from "@/ui/DataBadge";
import { GexBars } from "@/ui/GexBars";

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
    getBoard(ASSETS),
    getFlow(getAsset("BTC")!, 8),
  ]);

  const primary = board.filter((row) => row.primary);
  const secondary = board.filter((row) => !row.primary);
  const reference = primary.find((row) => row.assetId === "SPX") ?? primary[0];
  const all = [...primary, ...secondary];

  return (
    <div className="h-full overflow-auto p-4">
      <AutoRegime regime={reference?.regime ?? "long"} />

      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-sm font-semibold">{tr.home.primary}</h2>
        <DataBadge provenance={reference?.provenance ?? board[0].provenance} />
      </div>

      <div className="grid grid-cols-[repeat(auto-fit,minmax(200px,1fr))] gap-3">
        {primary.map((row, index) => (
          <AssetCard key={row.assetId} row={row} index={index} />
        ))}
      </div>

      <h2 className="mt-6 mb-3 text-sm font-semibold">{tr.home.secondary}</h2>
      <div className="grid grid-cols-[repeat(auto-fit,minmax(180px,1fr))] gap-3">
        {secondary.map((row, index) => (
          <AssetCard key={row.assetId} row={row} index={index + primary.length} />
        ))}
      </div>

      <div className="mt-3 grid grid-cols-1 gap-3 lg:grid-cols-[3fr_2fr]">
        <Card title={`${tr.home.netGexByTicker} — $ / +1 % de spot`}>
          <GexBars
            rows={all.map((row) => ({
              symbol: row.symbol,
              value: row.netGex,
            }))}
          />
          <p className="mt-3 text-[11px] text-tx2">
            Positif = les couvertures amortissent les mouvements (long gamma). Négatif =
            elles les amplifient (short gamma).
          </p>
        </Card>

        <div className="flex flex-col gap-3">
          {reference && (
            <Card
              title={tr.home.regimeOfDay}
              aside={<DataBadge provenance={reference.provenance} compact estimated />}
            >
              <RegimeBadge regime={reference.regime} className="mb-3" />
              <dl className="grid grid-cols-2 gap-2 text-xs">
                <div>
                  <dt className="text-[11px] text-tx2">{tr.metrics.spot}</dt>
                  <dd className="num">{fmt(reference.price, reference.priceDecimals)}</dd>
                </div>
                <div>
                  <dt className="text-[11px] text-tx2">{tr.levels.zeroGamma}</dt>
                  <dd className="num">
                    {reference.zeroGamma
                      ? fmt(reference.zeroGamma, reference.priceDecimals)
                      : "—"}
                  </dd>
                </div>
                <div>
                  <dt className="text-[11px] text-tx2">{tr.metrics.netGex}</dt>
                  <dd className="num">{fmtGexCompact(reference.netGex)}</dd>
                </div>
                <div>
                  <dt className="text-[11px] text-tx2">{tr.metrics.expectedMove}</dt>
                  <dd className="num">
                    {reference.expectedMovePct !== null
                      ? `± ${fmt(reference.expectedMovePct, 2)} %`
                      : "—"}
                  </dd>
                </div>
              </dl>
              <p className="mt-3 text-[11px] text-tx2">
                Le régime compare le spot au zero gamma calculé sur {reference.symbol}.{" "}
                {reference.regime === "long"
                  ? "Au-dessus du flip, la couverture des dealers amortit les mouvements."
                  : "Sous le flip, la couverture des dealers amplifie les mouvements."}
              </p>
            </Card>
          )}

          <Card
            title={tr.home.recentFlow}
            aside={
              <Link href="/flux" className="accent text-[11px] text-ac hover:underline">
                {tr.nav.flow} →
              </Link>
            }
          >
            <ul className="flex flex-col">
              {flow.trades.slice(0, 7).map((trade) => (
                <li
                  key={trade.id}
                  className="flex items-center justify-between border-b border-line py-1.5 text-xs last:border-0"
                >
                  <span className="flex items-center gap-2">
                    <b>{trade.assetId}</b>
                    <span className={trade.type === "call" ? "text-call" : "text-put"}>
                      {trade.type === "call" ? "C" : "P"} {fmt(trade.strike, 0)}
                    </span>
                  </span>
                  <span className="flex items-center gap-3 text-tx2">
                    <span className="num">{nyTimeShort(trade.ts)}</span>
                    <span className="num text-tx">{fmtMoney(trade.premiumUsd)}</span>
                  </span>
                </li>
              ))}
            </ul>
            <div className="mt-2">
              <DataBadge provenance={flow.provenance} />
            </div>
          </Card>
        </div>
      </div>
    </div>
  );
}
