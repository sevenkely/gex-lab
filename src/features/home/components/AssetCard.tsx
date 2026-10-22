import Link from "next/link";
import { fmt, fmtGexCompact, fmtPct } from "@/lib/format";
import { t } from "@/lib/i18n";
import type { BoardRow } from "@/server/registry";
import { AssetMark } from "@/ui/AssetMark";
import { Spark } from "@/ui/Spark";

/** Carte d'actif de l'accueil : cliquer ouvre le graphique GEX de l'actif. */
export function AssetCard({ row, index }: { row: BoardRow; index: number }) {
  const up = (row.changePct ?? 0) >= 0;
  const long = row.regime === "long";
  const above = row.zeroGamma !== null && row.price >= row.zeroGamma;

  return (
    <Link
      href={`/graphique/${row.assetId}`}
      style={{ ["--i" as string]: index }}
      className="rise panel group relative flex flex-col overflow-hidden p-3.5 transition-[transform,border-color,background-color] duration-300 hover:-translate-y-0.5 hover:border-[color-mix(in_srgb,var(--ac)_45%,transparent)] hover:bg-white/[0.025]"
      title={t().home.clickHint}
    >
      <span
        aria-hidden="true"
        className="absolute inset-x-0 top-0 h-px origin-left scale-x-0 bg-gradient-to-r from-ac via-ac/40 to-transparent transition-transform duration-500 group-hover:scale-x-100"
      />

      <div className="flex items-center justify-between gap-2">
        <span className="flex items-center gap-2">
          <AssetMark assetId={row.assetId} size={24} />
          <b className="text-[13px] font-semibold tracking-[0.01em]">{row.symbol}</b>
        </span>
        <span
          className={`inline-flex items-center gap-1.5 font-mono text-[9px] tracking-[0.08em] uppercase ${
            long ? "text-call" : "text-put"
          }`}
        >
          <i
            aria-hidden="true"
            className={`size-1.5 rounded-full ${long ? "bg-call" : "bg-put"}`}
          />
          {long ? t().regime.long : t().regime.short}
        </span>
      </div>

      <div className="num mt-2 text-[22px] leading-none font-semibold">
        {fmt(row.price, row.priceDecimals)}
      </div>
      <div
        className={`num mt-1 flex items-baseline gap-2 text-[11px] ${up ? "text-call" : "text-put"}`}
      >
        {row.changePct === null ? "—" : fmtPct(row.changePct)}
        {row.expectedMovePct !== null && (
          <span className="text-[10px] text-tx2">1σ {fmt(row.expectedMovePct, 2)} %</span>
        )}
      </div>

      <Spark points={row.spark} up={up} height={52} className="mt-2.5" />

      <div className="mt-2 flex items-end justify-between gap-2 border-t border-line pt-2">
        <span className="flex flex-col gap-0.5">
          <span className="text-[9px] tracking-[0.08em] text-tx2 uppercase">Net GEX</span>
          <b className="num text-[11px] font-semibold text-tx">
            {fmtGexCompact(row.netGex)}
          </b>
        </span>
        <span className="flex flex-col items-end gap-0.5">
          <span className="text-[9px] tracking-[0.08em] text-tx2 uppercase">flip</span>
          <span className="num text-[11px]">
            <span className={above ? "text-call" : "text-put"} aria-hidden="true">
              {above ? "↑" : "↓"}{" "}
            </span>
            {row.zeroGamma ? fmt(row.zeroGamma, row.priceDecimals) : "—"}
          </span>
        </span>
      </div>
    </Link>
  );
}
