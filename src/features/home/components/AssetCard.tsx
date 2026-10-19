import Link from "next/link";
import { fmt, fmtGexCompact, fmtPct } from "@/lib/format";
import { t } from "@/lib/i18n";
import type { BoardRow } from "@/server/registry";
import { Chip } from "@/ui/Chip";
import { Spark } from "@/ui/Spark";

/** Carte d'actif de l'accueil : cliquer ouvre le graphique GEX de l'actif. */
export function AssetCard({ row, index }: { row: BoardRow; index: number }) {
  const up = (row.changePct ?? 0) >= 0;
  return (
    <Link
      href={`/graphique/${row.assetId}`}
      style={{ ["--i" as string]: index }}
      className="rise panel group flex flex-col p-3.5 transition-[transform,border-color] duration-250 hover:-translate-y-0.5 hover:border-[color-mix(in_srgb,var(--ac)_50%,transparent)]"
      title={t().home.clickHint}
    >
      <div className="flex items-center justify-between">
        <b className="text-[13px] font-semibold">{row.symbol}</b>
        <Chip rgb="232,216,168" title={t().metrics.netGex}>
          {fmtGexCompact(row.netGex)}
        </Chip>
      </div>

      <div className="num mt-1.5 text-xl font-semibold">
        {fmt(row.price, row.priceDecimals)}
      </div>
      <div className={`num text-xs ${up ? "text-call" : "text-put"}`}>
        {row.changePct === null ? "—" : fmtPct(row.changePct)}
        {row.expectedMovePct !== null && (
          <span className="ml-2 text-tx2">1σ {fmt(row.expectedMovePct, 2)} %</span>
        )}
      </div>

      <Spark points={row.spark} up={up} height={44} className="mt-2" />

      <div className="mt-1.5 flex items-center justify-between text-[11px] text-tx2">
        <span className={`accent ${row.regime === "long" ? "text-ac" : "text-put"}`}>
          {row.regime === "long" ? t().regime.long : t().regime.short}
        </span>
        <span className="num">
          {row.zeroGamma ? `flip ${fmt(row.zeroGamma, row.priceDecimals)}` : "—"}
        </span>
      </div>
    </Link>
  );
}
