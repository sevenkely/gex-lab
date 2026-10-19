import { ASSETS } from "@/config/assets";
import { FlowTable } from "@/features/flow/components/FlowTable";
import { IndexActivity } from "@/features/flow/components/IndexActivity";
import { getFlow } from "@/server/registry";
import type { FlowTrade } from "@/server/providers/types";
import { Card } from "@/ui/Card";
import { DataBadge } from "@/ui/DataBadge";

export const dynamic = "force-dynamic";

// Les chaînes CBOE (jusqu’à 13 Mo) peuvent être lentes à froid : on laisse
// de la marge au rendu serveur plutôt que de couper la requête.
export const maxDuration = 60;

/** Actifs dont le flux est réellement temps réel (Deribit). */
const CRYPTO = ASSETS.filter((asset) => asset.chainSource === "deribit");

export default async function FlowPage() {
  const cryptoTrades = await Promise.all(CRYPTO.map((asset) => getFlow(asset, 80)));
  const now = cryptoTrades[0].now;
  const trades: FlowTrade[] = cryptoTrades
    .flatMap((entry) => entry.trades)
    .sort((a, b) => b.ts - a.ts)
    .slice(0, 200);

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
        <DataBadge provenance={cryptoTrades[0]?.provenance ?? cryptoTrades[1].provenance} />
      </div>

      <Card padded={false} className="overflow-hidden p-3">
        <FlowTable trades={trades} now={now} />
      </Card>

      {/* Les chaînes CBOE ne bloquent plus le rendu : elles arrivent après
          hydratation, avec leur squelette et leur propre provenance. */}
      <IndexActivity />
    </div>
  );
}
