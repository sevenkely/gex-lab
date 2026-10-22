"use client";

/**
 * Table du flux d'options. Les filtres restent volontairement limités à ce qui
 * est déductible des données : Tout / Calls / Puts / Blocs. Pas de « sweep »,
 * qui n'est pas identifiable dans les trades publics Deribit.
 */

import { useMemo, useState } from "react";
import { fmt, fmtAmount, fmtMoney } from "@/lib/format";
import { t } from "@/lib/i18n";
import { nyTimeShort } from "@/lib/time";
import type { FlowTrade } from "@/server/providers/types";
import { AssetMark } from "@/ui/AssetMark";
import { BLOCK_PREMIUM_THRESHOLD, type FlowFilterId } from "../config";

const FILTERS: { id: FlowFilterId; label: () => string }[] = [
  { id: "all", label: () => t().flow.filters.all },
  { id: "calls", label: () => t().flow.filters.calls },
  { id: "puts", label: () => t().flow.filters.puts },
  { id: "blocks", label: () => t().flow.filters.blocks },
];

export function FlowTable({
  trades,
  now,
  showFilters = true,
  animateEntrance = false,
}: {
  trades: readonly FlowTrade[];
  /** Instant de référence (ms) fourni par l'appelant : les libellés d'échéance
   *  sont ainsi déterministes et le rendu reste pur. */
  now: number;
  showFilters?: boolean;
  animateEntrance?: boolean;
}) {
  const [filter, setFilter] = useState<FlowFilterId>("all");
  const tr = t();

  const rows = useMemo(() => {
    if (filter === "all") return trades;
    if (filter === "calls") return trades.filter((trade) => trade.type === "call");
    if (filter === "puts") return trades.filter((trade) => trade.type === "put");
    return trades.filter(
      (trade) => trade.block || trade.premiumUsd >= BLOCK_PREMIUM_THRESHOLD,
    );
  }, [trades, filter]);

  return (
    <div className="flex min-h-0 flex-col">
      {showFilters && (
        <div className="mb-3 flex flex-wrap items-center gap-1.5">
          {FILTERS.map((item) => (
            <button
              key={item.id}
              type="button"
              onClick={() => setFilter(item.id)}
              aria-pressed={filter === item.id}
              className={`rounded-md border border-transparent px-2.5 py-1 text-xs whitespace-nowrap transition-colors duration-200 ${
                filter === item.id
                  ? "bg-white/8 text-tx"
                  : "text-tx2 hover:bg-white/5 hover:text-tx"
              }`}
            >
              {item.label()}
            </button>
          ))}
          <span className="ml-auto text-[11px] text-tx2">
            {rows.length} / {trades.length}
          </span>
        </div>
      )}

      <div className="min-w-0 overflow-x-auto">          <div className="sticky top-0 z-10 grid min-w-[660px] grid-cols-[62px_62px_40px_80px_56px_56px_84px_64px] items-center gap-2 border-b border-line bg-bg/90 px-3 py-2 font-mono text-[10px] tracking-[0.08em] text-tx2 uppercase backdrop-blur-sm">
          <span>{tr.flow.cols.time}</span>
          <span>{tr.flow.cols.symbol}</span>
          <span>{tr.flow.cols.type}</span>
          <span>{tr.flow.cols.strike}</span>
          <span>{tr.flow.cols.expiry}</span>
          <span className="text-right">{tr.flow.cols.size}</span>
          <span className="text-right">{tr.flow.cols.premium}</span>
          <span>{tr.flow.cols.side}</span>
        </div>

        <div>
          {rows.map((trade, index) => {
            const isBlock = trade.block || trade.premiumUsd >= BLOCK_PREMIUM_THRESHOLD;
            const expiryDays = Math.round((trade.expiry - now) / 86_400_000);
            return (
              <div
                key={trade.id}
                style={{ ["--i" as string]: Math.min(index, 12) }}
                className={`grid min-w-[660px] grid-cols-[62px_62px_40px_80px_56px_56px_84px_64px] items-center gap-2 border-b border-line px-3 py-2 text-xs transition-colors duration-150 hover:bg-white/[0.035] ${
                  animateEntrance ? "row-in" : ""
                } ${isBlock ? "shadow-[inset_2px_0_0_var(--ac)]" : ""}`}
              >
                <span className="num text-tx2">{nyTimeShort(trade.ts)}</span>
                <span className="flex items-center gap-1.5">
                  <AssetMark assetId={trade.assetId} size={14} />
                  <b>{trade.assetId}</b>
                </span>
                <span
                  className={`inline-flex items-center gap-1.5 ${
                    trade.type === "call" ? "text-call" : "text-put"
                  }`}
                >
                  <i
                    aria-hidden="true"
                    className={`size-1.5 rounded-full ${
                      trade.type === "call" ? "bg-call" : "bg-put"
                    }`}
                  />
                  {trade.type === "call" ? tr.flow.calls : tr.flow.puts}
                </span>
                <span className="num">{fmt(trade.strike, 0)}</span>
                <span className="text-tx2">
                  {expiryDays <= 0 ? "0DTE" : `+${expiryDays}j`}
                </span>
                <span className="num text-right">{fmtAmount(trade.amount)}</span>
                <span
                  className={`num text-right ${isBlock ? "font-semibold text-ac" : "text-tx"}`}
                >
                  {fmtMoney(trade.premiumUsd)}
                </span>
                <span className="flex items-center gap-1 text-tx2">
                  {trade.side === "buy"
                    ? tr.flow.ask
                    : trade.side === "sell"
                      ? tr.flow.bid
                      : "—"}
                  {isBlock && (
                    <span
                      title="Trade de bloc (block_trade_id Deribit) ou prime > 1 M$"
                      className="accent rounded border border-ac/40 px-1 text-[9px] font-semibold text-ac"
                    >
                      {tr.flow.block}
                    </span>
                  )}
                </span>
              </div>
            );
          })}
          {rows.length === 0 && (
            <p className="px-3 py-6 text-center text-xs text-tx2">{tr.common.icu}</p>
          )}
        </div>
      </div>
    </div>
  );
}
