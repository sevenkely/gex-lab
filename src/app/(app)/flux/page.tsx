import { ASSETS } from "@/config/assets";
import { FlowTable } from "@/features/flow/components/FlowTable";
import { IndexActivity } from "@/features/flow/components/IndexActivity";
import { fmt, fmtMoney } from "@/lib/format";
import { getFlow } from "@/server/registry";
import type { FlowTrade } from "@/server/providers/types";
import { nyTimeShort } from "@/lib/time";
import { Card } from "@/ui/Card";
import { DataBadge } from "@/ui/DataBadge";
import { PageHeader } from "@/ui/PageHeader";
import { ReportProvenance } from "@/ui/ReportProvenance";

export const dynamic = "force-dynamic";

// Les chaînes CBOE (jusqu’à 13 Mo) peuvent être lentes à froid : on laisse
// de la marge au rendu serveur plutôt que de couper la requête.
export const maxDuration = 60;

/** Actifs dont le flux est réellement temps réel (Deribit). */
const CRYPTO = ASSETS.filter((asset) => asset.chainSource === "deribit");

export default async function FlowPage() {
  const cryptoTrades = await Promise.all(
    CRYPTO.map((asset) => getFlow(asset, 80)),
  );
  const now = cryptoTrades[0].now;
  const trades: FlowTrade[] = cryptoTrades
    .flatMap((entry) => entry.trades)
    .sort((a, b) => b.ts - a.ts)
    .slice(0, 200);

  const totalPremium = trades.reduce((acc, trade) => acc + trade.premiumUsd, 0);
  const callPremium = trades
    .filter((trade) => trade.type === "call")
    .reduce((acc, trade) => acc + trade.premiumUsd, 0);
  const callShare = totalPremium > 0 ? (callPremium / totalPremium) * 100 : 50;
  const calls = trades.filter((trade) => trade.type === "call").length;
  const puts = trades.length - calls;
  const blocks = trades.filter(
    (trade) => trade.block || trade.premiumUsd >= 1_000_000,
  ).length;
  const largest = trades.reduce<FlowTrade | null>(
    (best, trade) => (!best || trade.premiumUsd > best.premiumUsd ? trade : best),
    null,
  );

  return (
    <div className="h-full overflow-auto">
      <div className="mx-auto max-w-[1560px] p-4 lg:p-6">
        <ReportProvenance
          provenance={cryptoTrades[0]?.provenance ?? cryptoTrades[1].provenance}
        />
        <PageHeader
          eyebrow={`Flux · ${CRYPTO.map((asset) => asset.symbol).join(" / ")} · Deribit`}
          title={
            <>
              Chaque trade, <span className="text-ac">tel qu’il est publié</span>.
            </>
          }
          lead={
            <>
              Trades publics Deribit : heure de New York, strike, taille, prime
              et côté preneur (ask = achat, bid = vente). Aucun « sweep » n’est
              déduit de ces prints — cette information n’existe pas dans le flux.
            </>
          }
          aside={
            <>
              <div className="text-right">
                <div className="font-mono text-[10px] tracking-[0.12em] text-tx2 uppercase">
                  Prime cumulée · {trades.length} trades
                </div>
                <div className="num mt-1 text-2xl leading-none font-semibold text-zero">
                  {fmtMoney(totalPremium)}
                </div>
              </div>
              <DataBadge
                provenance={cryptoTrades[0]?.provenance ?? cryptoTrades[1].provenance}
              />
            </>
          }
        />

        <div className="mb-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <div
            style={{ ["--i" as string]: 0 }}
            className="stat-in panel relative overflow-hidden px-3.5 py-3"
          >
            <div className="text-[10px] tracking-[0.1em] text-tx2 uppercase">
              Calls / puts
            </div>
            <div className="num mt-1 flex items-baseline gap-1.5 text-[21px] leading-none font-semibold">
              <span className="text-call">{calls}</span>
              <span className="text-[13px] text-tx2">/</span>
              <span className="text-put">{puts}</span>
            </div>
            <div className="mt-2.5 flex h-1 overflow-hidden rounded-full bg-white/6">
              <span
                aria-hidden="true"
                className="fill origin-left bg-call/75"
                style={{ width: `${callShare}%` }}
              />
              <span
                aria-hidden="true"
                className="fill origin-left bg-put/75"
                style={{ width: `${100 - callShare}%`, animationDelay: "80ms" }}
              />
            </div>
            <div className="mt-1.5 text-[10px] text-tx2">
              {fmt(callShare, 0)} % de la prime en calls
            </div>
          </div>

          <div
            style={{ ["--i" as string]: 1 }}
            className="stat-in panel relative overflow-hidden px-3.5 py-3"
          >
            <div className="text-[10px] tracking-[0.1em] text-tx2 uppercase">
              Blocs
            </div>
            <div className="num mt-1 text-[21px] leading-none font-semibold text-tx">
              {blocks}
            </div>
            <div className="mt-1 text-[10px] text-tx2">
              block_trade_id ou prime ≥ 1 M$
            </div>
            <div className="mt-2 h-1 overflow-hidden rounded-full bg-white/6">
              <span
                aria-hidden="true"
                className="fill block h-full origin-left bg-ac/75"
                style={{ width: `${trades.length ? (blocks / trades.length) * 100 : 0}%` }}
              />
            </div>
          </div>

          <div
            style={{ ["--i" as string]: 2 }}
            className="stat-in panel relative overflow-hidden px-3.5 py-3"
          >
            <div className="text-[10px] tracking-[0.1em] text-tx2 uppercase">
              Plus gros print
            </div>
            <div className="num mt-1 text-[21px] leading-none font-semibold text-tx">
              {largest ? fmtMoney(largest.premiumUsd) : "—"}
            </div>
            <div className="mt-1 text-[10px] text-tx2">
              {largest ? (
                <>
                  {largest.assetId} {largest.type === "call" ? "C" : "P"}{" "}
                  {fmt(largest.strike, 0)} · {nyTimeShort(largest.ts)}
                </>
              ) : (
                "aucun trade"
              )}
            </div>
          </div>

          <div
            style={{ ["--i" as string]: 3 }}
            className="stat-in panel relative overflow-hidden px-3.5 py-3"
          >
            <div className="text-[10px] tracking-[0.1em] text-tx2 uppercase">
              Dernière mise à jour
            </div>
            <div className="num mt-1 text-[21px] leading-none font-semibold text-tx">
              {trades[0] ? nyTimeShort(trades[0].ts) : "—"}
            </div>
            <div className="mt-1 text-[10px] text-tx2">
              New York · {CRYPTO.map((asset) => asset.symbol).join(" + ")}
            </div>
          </div>
        </div>

        <Card padded={false} className="overflow-hidden">
          <div className="p-3">
            <FlowTable trades={trades} now={now} animateEntrance />
          </div>
        </Card>

        <p className="mt-3 flex flex-wrap items-center gap-x-2 gap-y-1 text-[10px] text-tx2">
          <span className="rounded border border-line px-1.5 py-0.5 font-mono tracking-[0.08em] uppercase">
            Venue · Deribit
          </span>
          <span>
            Une seule place crypto est branchée (BTC, ETH). Binance, Bybit et Coinbase
            ne sont pas encore ingérés : leurs carnets d’options demandent des connecteurs
            dédiés, et un flux multi-venues ne se mélange pas sans normaliser les contrats.
          </span>
        </p>

        {/* Les chaînes CBOE ne bloquent pas le rendu : elles arrivent après
            hydratation, avec leur squelette et leur propre provenance. */}
        <IndexActivity />
      </div>
    </div>
  );
}
