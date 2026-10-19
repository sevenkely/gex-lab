import { fmt, fmtPct } from "@/lib/format";
import { t } from "@/lib/i18n";
import { DataBadge } from "@/ui/DataBadge";
import { NumberRoll } from "@/ui/NumberRoll";
import type { GexSnapshot } from "../types";
import { LevelCards } from "./LevelCards";
import { RegimeBadge } from "./RegimeBadge";

/**
 * Panneau latéral du graphique : contexte de marché estimé, niveaux clés et
 * rappel de la convention. Tous les chiffres portent leur provenance.
 */
export function RegimePanel({
  snapshot,
  label,
  decimals = 2,
  sourceLabel,
}: {
  snapshot: GexSnapshot;
  label: string;
  decimals?: number;
  sourceLabel?: string;
}) {
  const tr = t();
  const changePct =
    snapshot.prevClose && snapshot.spot
      ? (snapshot.spot / snapshot.prevClose - 1) * 100
      : null;

  return (
    <div className="w-full p-4">
      <div className="text-[15px] font-semibold">{label}</div>
      <div className="num mt-0.5 text-[11px] text-tx2">{snapshot.symbol} / USD</div>
      {/* Provenance sur sa propre ligne : le badge (source + drapeaux) ne doit
          pas comprimer le titre dans une colonne de 300 px. */}
      <div className="mt-2 flex flex-wrap items-center gap-x-2 gap-y-1">
        <DataBadge
          provenance={snapshot.provenance}
          compact
          estimated
        />
        {sourceLabel && <span className="num text-[10px] text-tx2">{sourceLabel}</span>}
      </div>

      <div className="num mt-4 text-[30px] leading-[1.1] font-semibold tracking-[-0.01em]">
        <NumberRoll
          value={snapshot.spot}
          format={{ kind: "price", decimals }}
          duration={350}
        />
      </div>
      {changePct !== null && (
        <div className={`num mt-1 text-xs ${changePct >= 0 ? "text-call" : "text-put"}`}>
          {fmtPct(changePct)}
        </div>
      )}

      <SectionTitle left={tr.home.regimeOfDay} right={tr.badges.estimated} />
      <RegimeBadge regime={snapshot.regime} className="mb-3.5" />

      <div className="text-[11px] text-tx2">
        {tr.metrics.netGexPer1pct ?? tr.metrics.netGex}
      </div>
      <div className="num mt-0.5 mb-3 text-[26px] font-semibold text-zero">
        <NumberRoll value={snapshot.netGex} format={{ kind: "gex" }} duration={900} />
      </div>

      <div className="text-[11px] text-tx2">{tr.metrics.expectedMove}</div>
      <div className="num mt-0.5 text-[15px]">
        {snapshot.expectedMove
          ? `± ${fmt(snapshot.expectedMove.points, decimals)} (${fmt(snapshot.expectedMove.pct, 2)} %)`
          : "—"}
      </div>

      <SectionTitle left={tr.levels.title} right={tr.levels.priceDistance} />
      <LevelCards levels={snapshot.levels} spot={snapshot.spot} decimals={decimals} />

      {snapshot.proxy && (
        <p className="mt-3 border-t border-line pt-3 text-[11px] text-tx2">
          Niveaux dérivés de {snapshot.proxy.underlyingId} — ratio{" "}
          <b className="num text-tx">{fmt(snapshot.proxy.ratio, 4)}</b> · spot sous-jacent{" "}
          <span className="num">{fmt(snapshot.proxy.underlyingSpot, 2)}</span>
        </p>
      )}

      <p className="mt-4 text-[11px] text-tx2">{tr.common.disclaimer}</p>
    </div>
  );
}

function SectionTitle({ left, right }: { left: string; right: string }) {
  return (
    <div className="mt-5 mb-2.5 flex items-center justify-between border-t border-line pt-3.5 text-[11px] text-tx2">
      <span>{left}</span>
      <span className="rounded-[10px] border border-line px-1.5">{right}</span>
    </div>
  );
}
