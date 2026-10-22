import { fmtGexCompact } from "@/lib/format";
import { t } from "@/lib/i18n";

/**
 * Séparation du Net GEX : masse positive (strikes qui amortissent) contre masse
 * négative (strikes qui amplifient).
 *
 * Un Net GEX proche de zéro peut cacher deux blocs opposés très denses — c'est
 * exactement ce que cette barre rend visible, et ce que le seul chiffre net ne
 * dit pas.
 */
export function GexSplitBar({
  positive,
  negative,
  positiveShare,
  className = "",
}: {
  positive: number;
  negative: number;
  positiveShare: number | null;
  className?: string;
}) {
  const total = positive - negative;
  const positivePct = total > 0 ? (positive / total) * 100 : 50;

  return (
    <div className={className}>
      <div className="flex h-2 overflow-hidden rounded bg-white/4">
        <i
          aria-hidden="true"
          className="fill h-full origin-left"
          style={{
            width: `${positivePct}%`,
            background: "rgba(var(--call),.7)",
          }}
        />
        <i
          aria-hidden="true"
          className="fill h-full flex-1 origin-right"
          style={{ background: "rgba(var(--put),.7)" }}
        />
      </div>
      <dl className="mt-2 grid grid-cols-2 gap-x-3 gap-y-0.5 text-[11px]">
        <div className="flex items-center gap-1.5">
          <i
            aria-hidden="true"
            className="size-1.5 flex-none rounded-full"
            style={{ background: "rgb(var(--call))" }}
          />
          <dt className="text-tx2">{t().gex.positive}</dt>
        </div>
        <div className="flex items-center justify-end gap-1.5">
          <dt className="text-tx2">{t().gex.negative}</dt>
          <i
            aria-hidden="true"
            className="size-1.5 flex-none rounded-full"
            style={{ background: "rgb(var(--put))" }}
          />
        </div>
        <dd className="num text-call">{fmtGexCompact(positive)}</dd>
        <dd className="num text-right text-put">{fmtGexCompact(negative)}</dd>
        <div className="num col-span-2 mt-0.5 text-tx2">
          {positiveShare === null
            ? "—"
            : `${t().gex.positiveShare} ${(positiveShare * 100).toFixed(0)} %`}
        </div>
      </dl>
    </div>
  );
}
