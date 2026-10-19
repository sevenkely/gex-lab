"use client";

/**
 * Activité d'options des indices — chargée APRÈS l'hydratation.
 *
 * Les chaînes CBOE pèsent 3 à 13 Mo chacune : bloquer le rendu de la page de
 * flux sur cinq téléchargements donnait 20 à 25 s de page blanche. Ici les
 * trades Deribit s'affichent immédiatement et cette section arrive ensuite,
 * avec son propre squelette et sa provenance.
 *
 * Ce n'est PAS un flux de trades : on lit la variation du volume cumulé entre
 * deux snapshots CBOE, et l'interface le dit.
 */

import { useEffect, useState } from "react";
import { fmt, fmtCompact } from "@/lib/format";
import { t } from "@/lib/i18n";
import { Card } from "@/ui/Card";
import { DataBadge } from "@/ui/DataBadge";
import { Skeleton } from "@/ui/Skeleton";
import type { Provenance } from "@/server/providers/types";

interface IndexRow {
  assetId: string;
  symbol: string;
  volume: number;
  oi: number;
  /** Variation depuis le snapshot précédent ; null tant qu'il n'y en a pas. */
  deltaVolume: number | null;
  volumeOiRatio: number | null;
  contracts: number;
  topStrikes: { strike: number; volume: number; oi: number }[];
}

interface IndexActivityPayload {
  rows: IndexRow[];
  provenance: Provenance;
  note: string;
}

export function IndexActivity() {
  const tr = t();
  const [data, setData] = useState<IndexActivityPayload | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let alive = true;
    fetch("/api/flow-indices")
      .then((response) => {
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        return response.json() as Promise<IndexActivityPayload>;
      })
      .then((payload) => {
        if (alive) setData(payload);
      })
      .catch(() => {
        if (alive) setFailed(true);
      });
    return () => {
      alive = false;
    };
  }, []);

  return (
    <>
      <div className="mt-6 mb-3 flex flex-wrap items-center justify-between gap-2">
        <div>
          <h2 className="text-sm font-semibold">Activité d’options (volume) — indices</h2>
          <p className="max-w-[70ch] text-[11px] text-tx2">{tr.flow.indexNote}</p>
        </div>
        {data ? (
          <DataBadge provenance={data.provenance} />
        ) : (
          <span className="text-[10px] text-tx2">CBOE (différé 15 min)</span>
        )}
      </div>

      {failed && (
        <Card className="text-xs text-tx2">
          Activité indisponible : la source CBOE n’a pas répondu. Réessayez dans quelques
          instants.
        </Card>
      )}

      <div className="grid grid-cols-[repeat(auto-fit,minmax(280px,1fr))] gap-3">
        {!data &&
          !failed &&
          Array.from({ length: 3 }).map((_, index) => (
            <Card key={index}>
              <Skeleton className="h-3 w-24" />
              <Skeleton className="mt-3 h-3 w-full" />
              <Skeleton className="mt-2 h-3 w-5/6" />
              <Skeleton className="mt-2 h-3 w-4/6" />
            </Card>
          ))}

        {data?.rows.map((row) => (
          <Card key={row.assetId} title={`${row.symbol} — volume du jour`}>
            <div className="grid grid-cols-[1fr_70px_70px] gap-2 border-b border-line pb-1.5 text-[11px] text-tx2">
              <span>Strike</span>
              <span className="text-right">Volume</span>
              <span className="text-right">OI</span>
            </div>
            {row.topStrikes.map((strike) => (
              <div
                key={strike.strike}
                className="grid grid-cols-[1fr_70px_70px] gap-2 border-b border-line py-1.5 text-xs last:border-0"
              >
                <span className="num">{fmt(strike.strike, 0)}</span>
                <span className="num text-right">{fmtCompact(strike.volume)}</span>
                <span className="num text-right text-tx2">{fmtCompact(strike.oi)}</span>
              </div>
            ))}
            <div className="mt-2 flex items-center justify-between text-[11px] text-tx2">
              <span
                title={
                  row.deltaVolume === null
                    ? "En attente d’un second snapshot CBOE (≈ 15 min)"
                    : "Contrats échangés depuis le snapshot précédent"
                }
              >
                Δ volume{" "}
                <b className="num text-tx">
                  {row.deltaVolume === null ? "—" : fmtCompact(row.deltaVolume)}
                </b>
              </span>
              <span>
                {row.contracts} contrats · OI {fmtCompact(row.oi)}
              </span>
            </div>
          </Card>
        ))}
      </div>
    </>
  );
}
