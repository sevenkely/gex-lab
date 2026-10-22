import { fmt, fmtCompact, fmtMoney } from "@/lib/format";
import { t } from "@/lib/i18n";
import type { DarkPoolSnapshot } from "@/server/providers/types";
import { Chip } from "@/ui/Chip";

/**
 * Table dark pool : volumes ATS hebdomadaires FINRA, agrégés par symbole.
 * Ce ne sont PAS des prints en direct — la publication est hebdomadaire et
 * arrive avec plusieurs semaines de retard (bandeau explicite au-dessus).
 *
 * Chaque symbole est une plaque : identité à gauche, agrégats à droite, puis
 * un classement d'ATS où la part de volume sert de barre de fond. La barre est
 * le seul élément coloré : la donnée reste lisible sans surcharger la page.
 */
export function DarkPoolTable({
  snapshot,
  symbols,
}: {
  snapshot: DarkPoolSnapshot;
  symbols: readonly { symbol: string; covered: boolean }[];
}) {
  const tr = t();
  const covered = symbols.filter((entry) => entry.covered);

  return (
    <div className="grid gap-3 lg:grid-cols-2">
      {symbols.map((entry, panelIndex) => {
        if (!entry.covered) {
          return (
            <section
              key={entry.symbol}
              style={{ ["--i" as string]: panelIndex }}
              className="rise panel flex flex-col gap-3 self-start p-4"
            >
              <header className="flex items-center justify-between gap-2">
                <div className="flex items-center gap-2.5">
                  <span
                    aria-hidden="true"
                    className="num grid size-8 place-items-center rounded-md border border-line bg-white/4 text-[11px] text-tx2"
                  >
                    {entry.symbol.slice(0, 2)}
                  </span>
                  <b className="text-sm font-semibold">{entry.symbol}</b>
                </div>
                <Chip>{tr.darkPool.notCovered.split(" (")[0]}</Chip>
              </header>
              <p className="text-[11px] leading-relaxed text-tx2">
                Un indice n’a pas de volume ATS propre : seuls ses ETF (SPY) sont
                déclarés. Les niveaux de {entry.symbol} se lisent donc dans le GEX, pas
                ici.
              </p>
            </section>
          );
        }

        const rows = snapshot.rows
          .filter((row) => row.symbol === entry.symbol)
          .sort((a, b) => b.volume - a.volume);
        const volume = rows.reduce((acc, row) => acc + row.volume, 0);
        const trades = rows.reduce((acc, row) => acc + row.trades, 0);
        const notional = rows.reduce((acc, row) => acc + row.notional, 0);
        const top = rows[0];
        const shown = rows.slice(0, 6);
        const rest = rows.slice(6);
        const restVolume = rest.reduce((acc, row) => acc + row.volume, 0);
        const restNotional = rest.reduce((acc, row) => acc + row.notional, 0);
        const restTrades = rest.reduce((acc, row) => acc + row.trades, 0);

        return (
          <section
            key={entry.symbol}
            style={{ ["--i" as string]: panelIndex }}
            className="rise panel overflow-hidden"
          >
            <header className="flex flex-wrap items-center justify-between gap-3 border-b border-line px-4 py-3">
              <div className="flex items-center gap-2.5">
                <span
                  aria-hidden="true"
                  className="num grid size-8 place-items-center rounded-md border border-ac/30 bg-ac/10 text-[11px] font-semibold text-ac accent"
                >
                  {entry.symbol.slice(0, 2)}
                </span>
                <div className="leading-tight">
                  <b className="text-sm font-semibold">{entry.symbol}</b>
                  <div className="num text-[10px] text-tx2">{snapshot.weekStart}</div>
                </div>
              </div>
              <div className="flex items-center gap-3 text-[10px] text-tx2">
                <span className="flex flex-col items-end">
                  <span className="num text-[13px] leading-none font-semibold text-tx">
                    {fmtMoney(notional)}
                  </span>
                  <span className="mt-0.5">{tr.darkPool.notional}</span>
                </span>
                <span className="h-6 w-px bg-line" aria-hidden="true" />
                <span className="flex flex-col items-end">
                  <span className="num text-[13px] leading-none font-semibold text-tx">
                    {fmtCompact(volume)}
                  </span>
                  <span className="mt-0.5">{tr.darkPool.volume}</span>
                </span>
              </div>
            </header>

            <div className="px-4">
              <div className="grid grid-cols-[18px_1fr_62px_72px_82px] items-center gap-2 border-b border-line py-2 font-mono text-[9px] tracking-[0.08em] text-tx2 uppercase">
                <span>#</span>
                <span>ATS</span>
                <span className="text-right">{tr.darkPool.trades}</span>
                <span className="text-right">{tr.darkPool.volume}</span>
                <span className="text-right">{tr.darkPool.notional}</span>
              </div>

              {shown.map((row, rank) => (
                <div
                  key={row.mpid}
                  className="group grid grid-cols-[18px_1fr_62px_72px_82px] items-center gap-2 border-b border-line py-2 text-xs transition-colors hover:bg-white/[0.035]"
                >
                  <span className="num text-[10px] text-tx2">{rank + 1}</span>
                  <span className="relative flex min-w-0 flex-col gap-1">
                    <span className="truncate pr-1">
                      {row.marketParticipantName}
                      {rank === 0 && top && volume > 0 && (
                        <span className="num ml-1.5 text-[10px] text-tx2">
                          {fmt((row.volume / volume) * 100, 1)} %
                        </span>
                      )}
                    </span>
                    <span className="relative h-1 overflow-hidden rounded-full bg-white/5">
                      <i
                        aria-hidden="true"
                        className="fill absolute inset-y-0 left-0 origin-left rounded-full bg-ac/70 accent"
                        style={{
                          width: `${volume ? Math.max(1.5, (row.volume / volume) * 100) : 0}%`,
                          ["--d" as string]: `${rank * 60}ms`,
                        }}
                      />
                    </span>
                  </span>
                  <span className="num text-right text-[11px] text-tx2">
                    {fmtCompact(row.trades)}
                  </span>
                  <span className="num text-right text-[11px]">
                    {fmtCompact(row.volume)}
                  </span>
                  <span className="num text-right">{fmtMoney(row.notional)}</span>
                </div>
              ))}

              {rest.length > 0 && (
                <div className="grid grid-cols-[18px_1fr_62px_72px_82px] items-center gap-2 py-2 text-[11px] text-tx2">
                  <span aria-hidden="true">＋</span>
                  <span>{rest.length} autres ATS</span>
                  <span className="num text-right">{fmtCompact(restTrades)}</span>
                  <span className="num text-right">{fmtCompact(restVolume)}</span>
                  <span className="num text-right">{fmtMoney(restNotional)}</span>
                </div>
              )}

              {rows.length === 0 && (
                <p className="py-6 text-center text-[11px] text-tx2">
                  Aucune déclaration ATS pour {entry.symbol} cette semaine.
                </p>
              )}
            </div>

            <footer className="flex items-center justify-between gap-2 border-t border-line bg-white/[0.015] px-4 py-2 text-[10px] text-tx2">
              <span>{tr.darkPool.relative}</span>
              <span className="num">
                {fmtCompact(trades)} {tr.darkPool.trades.toLowerCase()} ·{" "}
                {fmt(volume ? (notional / volume) : 0, 2)} $/action
              </span>
            </footer>
          </section>
        );
      })}

      {covered.length === 0 && (
        <p className="panel p-4 text-xs text-tx2">
          Aucun symbole ATS couvert par le fournisseur pour cette exécution.
        </p>
      )}
    </div>
  );
}
