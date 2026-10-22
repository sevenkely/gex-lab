import { DarkPoolTable } from "@/features/darkpool/components/DarkPoolTable";
import { fmt, fmtCompact, fmtMoney } from "@/lib/format";
import { t } from "@/lib/i18n";
import { getDarkPoolSnapshot } from "@/server/registry";
import { DataBadge } from "@/ui/DataBadge";
import { PageHeader, Stat } from "@/ui/PageHeader";

export const dynamic = "force-dynamic";

/** Symboles ATS couverts par le dataset FINRA (les indices n'y figurent pas). */
const SYMBOLS = [
  { symbol: "SPY", covered: true },
  { symbol: "QQQ", covered: true },
  { symbol: "GLD", covered: true },
  { symbol: "SPX", covered: false },
] as const;

export default async function DarkPoolPage() {
  const tr = t();
  const covered = SYMBOLS.filter((entry) => entry.covered);
  const { snapshot, provenance } = await getDarkPoolSnapshot(
    covered.map((entry) => entry.symbol),
  );

  const rows = snapshot.rows;
  const totalVolume = rows.reduce((acc, row) => acc + row.volume, 0);
  const totalTrades = rows.reduce((acc, row) => acc + row.trades, 0);
  const totalNotional = rows.reduce((acc, row) => acc + row.notional, 0);
  const venues = new Set(rows.map((row) => row.mpid)).size;
  const leader = [...rows].sort((a, b) => b.notional - a.notional)[0];
  const leaderShare = leader && totalNotional > 0 ? (leader.notional / totalNotional) * 100 : 0;

  return (
    <div className="h-full overflow-auto">
      <div className="mx-auto max-w-[1180px] p-4 lg:p-6">
        <PageHeader
          eyebrow={`FINRA · ATS · semaine du ${snapshot.weekStart}`}
          title={
            <>
              Ce qui se traite <span className="text-ac">loin du carnet</span>.
            </>
          }
          lead={tr.darkPool.banner}
          aside={<DataBadge provenance={provenance} />}
        />

        <div className="mb-5 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <Stat
            index={0}
            label="Notionnel ATS"
            value={totalNotional > 0 ? fmtMoney(totalNotional) : "—"}
            hint={`${covered.length} symboles · ${venues} ATS`}
            rgb="232,216,168"
          />
          <Stat
            index={1}
            label={tr.darkPool.volume}
            value={totalVolume > 0 ? fmtCompact(totalVolume) : "—"}
            hint="actions échangées sur la semaine"
          />
          <Stat
            index={2}
            label={tr.darkPool.trades}
            value={totalTrades > 0 ? fmtCompact(totalTrades) : "—"}
            hint="prints déclarés par les participants"
          />
          <Stat
            index={3}
            label="ATS dominant"
            value={leader ? leader.marketParticipantName.split(" ")[0] : "—"}
            hint={leader ? `${fmt(leaderShare, 1)} % du notionnel` : "aucune donnée"}
            rgb="45,212,191"
          />
        </div>

        <div className="mb-2.5 flex flex-wrap items-baseline justify-between gap-2 border-b border-line pb-2">
          <h3 className="font-mono text-[10px] tracking-[0.16em] text-tx2 uppercase">
            Détail par symbole
          </h3>
          <span className="num text-[10px] text-tx2">
            {tr.darkPool.week} {snapshot.weekStart} · publication hebdomadaire
          </span>
        </div>

        <DarkPoolTable snapshot={snapshot} symbols={SYMBOLS} />

        <p className="mt-5 max-w-[92ch] border-t border-line pt-3 text-[11px] leading-relaxed text-tx2">
          Les volumes ATS sont publiés par FINRA par participant de marché (ATS) et par
          semaine. Ils couvrent les actions et ETF américains — un indice comme SPX n’a pas
          de volume ATS propre : seuls ses ETF (SPY) en ont. Ces chiffres ne disent rien du
          sens (achat/vente) ni du moment exact des transactions : une part élevée de
          volume ATS décrit un lieu d’exécution, pas une intention.
        </p>
      </div>
    </div>
  );
}
