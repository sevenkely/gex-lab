import { ASSETS, chainAssets, getAsset } from "@/config/assets";
import { FlowTable } from "@/features/flow/components/FlowTable";
import { fmt, fmtCompact } from "@/lib/format";
import { t } from "@/lib/i18n";
import { getFlow, getGexSnapshot } from "@/server/registry";
import type { FlowTrade } from "@/server/providers/types";
import { Card } from "@/ui/Card";
import { DataBadge } from "@/ui/DataBadge";

export const dynamic = "force-dynamic";

/** Actifs dont le flux est réellement temps réel (Deribit). */
const CRYPTO = ASSETS.filter((asset) => asset.chainSource === "deribit");

export default async function FlowPage() {
  const tr = t();
  const cryptoTrades = await Promise.all(CRYPTO.map((asset) => getFlow(asset, 80)));
  const now = cryptoTrades[0]?.now ?? 0;
  const trades: FlowTrade[] = cryptoTrades
    .flatMap((entry) => entry.trades)
    .sort((a, b) => b.ts - a.ts)
    .slice(0, 200);

  const indexAssets = chainAssets().filter((asset) => asset.chainSource === "cboe");
  const indexSnapshots = await Promise.all(
    indexAssets.map((asset) => getGexSnapshot(asset.id, { filter: "0DTE" })),
  );

  return (
    <div className="h-full overflow-auto p-4">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <div>
          <h2 className="text-sm font-semibold">
            Trades d’options — {CRYPTO.map((a) => a.symbol).join(" / ")}
          </h2>
          <p className="text-[11px] text-tx2">
            Trades publics Deribit : heure, strike, taille, prime et côté preneur (ask =
            achat, bid = vente). Aucun « sweep » : il n’est pas déductible des trades
            publics.
          </p>
        </div>
        <DataBadge
          provenance={cryptoTrades[0]?.provenance ?? indexSnapshots[0].provenance}
        />
      </div>

      <Card padded={false} className="overflow-hidden p-3">
        <FlowTable trades={trades} now={now} />
      </Card>

      <div className="mt-6 mb-3 flex flex-wrap items-center justify-between gap-2">
        <div>
          <h2 className="text-sm font-semibold">Activité d’options (volume) — indices</h2>
          <p className="max-w-[70ch] text-[11px] text-tx2">{tr.flow.indexNote}</p>
        </div>
        <DataBadge provenance={indexSnapshots[0].provenance} />
      </div>

      <div className="grid grid-cols-[repeat(auto-fit,minmax(280px,1fr))] gap-3">
        {indexSnapshots.map((snapshot) => {
          const asset = getAsset(snapshot.assetId)!;
          const top = [...snapshot.byStrike]
            .sort((a, b) => b.volume - a.volume)
            .slice(0, 6);
          return (
            <Card key={snapshot.assetId} title={`${asset.symbol} — volume du jour`}>
              <div className="grid grid-cols-[1fr_70px_70px] gap-2 border-b border-line pb-1.5 text-[11px] text-tx2">
                <span>Strike</span>
                <span className="text-right">Volume</span>
                <span className="text-right">OI</span>
              </div>
              {top.map((row) => (
                <div
                  key={row.strike}
                  className="grid grid-cols-[1fr_70px_70px] gap-2 border-b border-line py-1.5 text-xs last:border-0"
                >
                  <span className="num">{fmt(row.strike, asset.priceDecimals)}</span>
                  <span className="num text-right">{fmtCompact(row.volume)}</span>
                  <span className="num text-right text-tx2">{fmtCompact(row.oi)}</span>
                </div>
              ))}
              <div className="mt-2 flex items-center justify-between text-[11px] text-tx2">
                <span>{snapshot.filter === "0DTE" ? "0DTE" : tr.common.all}</span>
                <span>
                  {snapshot.contracts} contrats · OI {fmtCompact(snapshot.totalOi)}
                </span>
              </div>
            </Card>
          );
        })}
      </div>
    </div>
  );
}
