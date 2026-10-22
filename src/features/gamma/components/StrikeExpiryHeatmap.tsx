import type { StrikeExpiryMatrix } from "@/features/gex/compute";
import { fmt, fmtGexCompact } from "@/lib/format";
import { LOCALE, t } from "@/lib/i18n";
import { nyMidnightUtc } from "@/lib/time";

/**
 * Heatmap strike × échéance.
 *
 * Chaque cellule est le Net GEX d'un couple strike × échéance : le vert d'eau
 * amortit les mouvements, la braise les amplifie, l'intensité est
 * proportionnelle à |GEX| / pic. La fenêtre est celle du spot (± 8 %), pas la
 * totalité de la chaîne.
 *
 * Aucun état, aucun listener : la valeur exacte de chaque cellule est dans son
 * attribut `title` (info-bulle native), donc lisible au survol sans JS.
 */
export function StrikeExpiryHeatmap({
  matrix,
  spot,
  generatedAt,
  decimals = 2,
  timeframe,
}: {
  matrix: StrikeExpiryMatrix;
  spot: number;
  /** Horodatage du calcul : repère le 0DTE sans lire l'horloge au rendu. */
  generatedAt: number;
  decimals?: number;
  /** Libellé affiché à côté de la fenêtre (« toutes échéances », « 0DTE »…). */
  timeframe?: string;
}) {
  const tr = t();

  if (matrix.rows.length === 0 || matrix.expiries.length === 0) {
    return <p className="text-xs text-tx2">{tr.matrix.empty}</p>;
  }

  const today = nyMidnightUtc(generatedAt);
  const locale = LOCALE === "fr" ? "fr-FR" : "en-US";
  const label = (expiry: number) =>
    expiry === today
      ? "0DTE"
      : new Date(expiry)
          .toLocaleDateString(locale, {
            day: "2-digit",
            month: "short",
            timeZone: "UTC",
          })
          .replace(".", "");

  // Strike le plus proche du spot : ligne de repère.
  const spotStrike = matrix.rows.reduce((best, row) =>
    Math.abs(row.strike - spot) < Math.abs(best.strike - spot) ? row : best,
  ).strike;

  const grandTotal = matrix.totals.reduce((acc, value) => acc + value, 0);

  const cellStyle = (value: number) => {
    const intensity = matrix.peak > 0 ? Math.min(1, Math.abs(value) / matrix.peak) : 0;
    if (intensity <= 0.001) return { background: "rgba(160,185,230,.05)" };
    // Racine cubique plutôt que linéaire : une cellule à 10 % du pic doit
    // rester lisible. Sans cela, seuls les deux ou trois strikes dominants
    // ressortent et la matrice ressemble à un fond vide.
    const alpha = 0.1 + 0.8 * Math.pow(intensity, 0.45);
    return {
      background:
        value >= 0
          ? `rgba(var(--call), ${alpha.toFixed(3)})`
          : `rgba(var(--put), ${alpha.toFixed(3)})`,
    };
  };

  return (
    <div className="flex flex-col gap-3">
      <div className="overflow-x-auto">
        <table className="w-full min-w-[520px] border-separate border-spacing-[2px] text-[11px]">
          <caption className="sr-only">
            {tr.matrix.title} — {tr.matrix.net}
          </caption>
          <thead>
            <tr className="text-tx2">
              <th scope="col" className="px-1.5 pb-1 text-left font-normal">
                Strike
              </th>
              {matrix.expiries.map((expiry) => (
                <th
                  key={expiry}
                  scope="col"
                  className="px-1.5 pb-1 text-center font-normal whitespace-nowrap"
                >
                  {label(expiry)}
                </th>
              ))}
              <th scope="col" className="px-1.5 pb-1 text-right font-normal">
                {tr.matrix.net}
              </th>
            </tr>
          </thead>
          <tbody>
            {matrix.rows.map((row) => {
              const isSpot = row.strike === spotStrike;
              return (
                <tr key={row.strike}>
                  <th
                    scope="row"
                    className={`num px-1.5 text-left font-normal whitespace-nowrap ${
                      isSpot ? "font-semibold text-tx" : "text-tx2"
                    }`}
                  >
                    {fmt(row.strike, decimals)}
                    {isSpot && <span className="ml-1 text-ac">•</span>}
                  </th>
                  {row.cells.map((value, index) => (
                    <td
                      key={matrix.expiries[index]}
                      title={`${fmt(row.strike, decimals)} · ${label(matrix.expiries[index])} — ${fmtGexCompact(value)}`}
                      className="h-6 rounded-[3px] transition-transform duration-150 hover:scale-[1.06]"
                      style={cellStyle(value)}
                    />
                  ))}
                  <td
                    title={`${fmt(row.strike, decimals)} — ${fmtGexCompact(row.net)}`}
                    className={`num px-1.5 text-right ${
                      row.net >= 0 ? "text-call" : "text-put"
                    }`}
                  >
                    {fmtGexCompact(row.net)}
                  </td>
                </tr>
              );
            })}
          </tbody>
          <tfoot>
            <tr>
              <th
                scope="row"
                className="px-1.5 text-left text-[10px] font-normal text-tx2"
              >
                {tr.matrix.total}
              </th>
              {matrix.totals.map((value, index) => (
                <td
                  key={matrix.expiries[index]}
                  title={`${label(matrix.expiries[index])} — ${fmtGexCompact(value)}`}
                  className={`num px-1.5 text-center ${value >= 0 ? "text-call" : "text-put"}`}
                >
                  {fmtGexCompact(value)}
                </td>
              ))}
              <td
                className={`num px-1.5 text-right font-semibold ${
                  grandTotal >= 0 ? "text-call" : "text-put"
                }`}
              >
                {fmtGexCompact(grandTotal)}
              </td>
            </tr>
          </tfoot>
        </table>
      </div>

      <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5 text-[10px] text-tx2">
        <span className="flex items-center gap-1.5">
          <i
            aria-hidden="true"
            className="size-2 rounded-[2px]"
            style={{ background: "rgba(var(--put), .8)" }}
          />
          {fmtGexCompact(-matrix.peak)}
        </span>
        <span
          aria-hidden="true"
          className="h-2 w-24 rounded"
          style={{
            background:
              "linear-gradient(90deg, rgba(var(--put),.85), rgba(160,185,230,.06), rgba(var(--call),.85))",
          }}
        />
        <span className="flex items-center gap-1.5">
          {fmtGexCompact(matrix.peak)}
          <i
            aria-hidden="true"
            className="size-2 rounded-[2px]"
            style={{ background: "rgba(var(--call), .8)" }}
          />
        </span>
        <span className="ml-auto">
          ± {(matrix.windowPct * 100).toFixed(0)} % du spot
          {timeframe ? ` · ${timeframe}` : ""}
        </span>
      </div>

      <p className="max-w-[80ch] text-[11px] text-tx2">{tr.matrix.note}</p>
    </div>
  );
}
