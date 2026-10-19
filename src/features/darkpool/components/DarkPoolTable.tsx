import { fmt, fmtCompact, fmtMoney } from "@/lib/format";
import { t } from "@/lib/i18n";
import type { DarkPoolSnapshot } from "@/server/providers/types";
import { Chip } from "@/ui/Chip";

/**
 * Table dark pool : volumes ATS hebdomadaires FINRA, agrégés par symbole.
 * Ce ne sont PAS des prints en direct — la publication est hebdomadaire et
 * arrive avec plusieurs semaines de retard (bandeau explicite au-dessus).
 */
export function DarkPoolTable({
  snapshot,
  symbols,
}: {
  snapshot: DarkPoolSnapshot;
  symbols: readonly { symbol: string; covered: boolean }[];
}) {
  const tr = t();

  return (
    <div className="flex flex-col gap-3.5">
      {symbols.map((entry) => {
        if (!entry.covered) {
          return (
            <section key={entry.symbol} className="panel p-3.5">
              <header className="flex items-center justify-between">
                <b className="text-[13px]">{entry.symbol}</b>
                <Chip>{tr.darkPool.notCovered}</Chip>
              </header>
            </section>
          );
        }

        const rows = snapshot.rows
          .filter((row) => row.symbol === entry.symbol)
          .sort((a, b) => b.volume - a.volume);
        const totalVolume = rows.reduce((acc, row) => acc + row.volume, 0);
        const totalTrades = rows.reduce((acc, row) => acc + row.trades, 0);
        const totalNotional = rows.reduce((acc, row) => acc + row.notional, 0);
        const top = rows[0];

        return (
          <section key={entry.symbol} className="panel p-3.5">
            <header className="mb-2.5 flex flex-wrap items-center justify-between gap-2">
              <div className="flex items-baseline gap-2">
                <b className="text-[13px]">{entry.symbol}</b>
                <span className="num text-[11px] text-tx2">
                  {tr.darkPool.week} {snapshot.weekStart}
                </span>
              </div>
              <div className="flex flex-wrap items-center gap-2 text-[11px] text-tx2">
                <span>
                  {tr.darkPool.volume}{" "}
                  <b className="num text-tx">{fmtCompact(totalVolume)}</b>
                </span>
                <span>
                  {tr.darkPool.trades}{" "}
                  <b className="num text-tx">{fmtCompact(totalTrades)}</b>
                </span>
                <span>
                  {tr.darkPool.notional}{" "}
                  <b className="num text-tx">{fmtMoney(totalNotional)}</b>
                </span>
                {top && totalVolume > 0 && (
                  <Chip rgb="45,212,191" title={tr.darkPool.mainAts}>
                    {top.marketParticipantName.split(" ")[0]}{" "}
                    {fmt((top.volume / totalVolume) * 100, 1)} %
                  </Chip>
                )}
              </div>
            </header>

            <div className="grid grid-cols-[1fr_84px_84px_96px] gap-2 border-b border-line pb-1.5 text-[11px] text-tx2">
              <span>ATS</span>
              <span className="text-right">{tr.darkPool.trades}</span>
              <span className="text-right">{tr.darkPool.volume}</span>
              <span className="text-right">{tr.darkPool.notional}</span>
            </div>

            {rows.slice(0, 6).map((row, index) => (
              <div
                key={row.mpid}
                style={{ ["--i" as string]: index }}
                className="rise grid grid-cols-[1fr_84px_84px_96px] items-center gap-2 border-b border-line py-1.5 text-xs"
              >
                <div className="flex flex-col gap-1">
                  <span className="truncate">{row.marketParticipantName}</span>
                  <span className="relative h-1.5 rounded bg-white/4">
                    <i
                      aria-hidden="true"
                      className="fill absolute top-0 bottom-0 left-0 origin-left rounded bg-[rgba(var(--ac-rgb,45,212,191),.7)]"
                      style={{
                        width: `${totalVolume ? (row.volume / totalVolume) * 100 : 0}%`,
                        animationDelay: `${index * 50}ms`,
                      }}
                    />
                  </span>
                </div>
                <span className="num text-right">{fmtCompact(row.trades)}</span>
                <span className="num text-right">{fmtCompact(row.volume)}</span>
                <span className="num text-right">{fmtMoney(row.notional)}</span>
              </div>
            ))}
          </section>
        );
      })}
    </div>
  );
}
