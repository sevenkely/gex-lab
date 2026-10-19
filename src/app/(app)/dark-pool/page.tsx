import { DarkPoolTable } from "@/features/darkpool/components/DarkPoolTable";
import { t } from "@/lib/i18n";
import { getDarkPoolSnapshot } from "@/server/registry";
import { DataBadge } from "@/ui/DataBadge";

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
  const { snapshot, provenance } = await getDarkPoolSnapshot(
    SYMBOLS.filter((entry) => entry.covered).map((entry) => entry.symbol),
  );

  return (
    <div className="h-full overflow-auto p-4">
      <div className="panel mb-3 flex flex-wrap items-center justify-between gap-3 p-3.5">
        <div>
          <h2 className="text-sm font-semibold">{tr.darkPool.title}</h2>
          <p className="max-w-[80ch] text-[11px] text-tx2">{tr.darkPool.banner}</p>
        </div>
        <DataBadge provenance={provenance} />
      </div>

      <div className="max-w-[980px]">
        <DarkPoolTable snapshot={snapshot} symbols={SYMBOLS} />
      </div>

      <p className="mt-4 max-w-[90ch] text-[11px] text-tx2">
        Les volumes ATS sont publiés par FINRA par participant de marché (ATS) et par
        semaine. Ils couvrent les actions et ETF américains — un indice comme SPX n’a pas
        de volume ATS propre : seuls ses ETF (SPY) en ont. Ces chiffres ne disent rien du
        sens (achat/vente) ni du moment exact des transactions.
      </p>
    </div>
  );
}
