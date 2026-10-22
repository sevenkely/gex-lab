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
 *
 * Un snapshot CBOE peut arriver sans volume (champ absent) : on affiche alors
 * « — », jamais « 0 », et la section se rafraîchit toutes les 60 s — un zéro
 * silencieux faisait passer une donnée manquante pour une absence de trades.
 */

import { useEffect, useState } from "react";
import { fmt, fmtAgo, fmtCompact } from "@/lib/format";
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

const REFRESH_MS = 60_000;

export function IndexActivity() {
  const tr = t();
  const [data, setData] = useState<IndexActivityPayload | null>(null);
  const [failed, setFailed] = useState(false);
  const [updatedAt, setUpdatedAt] = useState<number | null>(null);

  useEffect(() => {
    let alive = true;

    const load = () => {
      fetch("/api/flow-indices", { cache: "no-store" })
        .then((response) => {
          if (!response.ok) throw new Error(`HTTP ${response.status}`);
          return response.json() as Promise<IndexActivityPayload>;
        })
        .then((payload) => {
          if (!alive) return;
          setData(payload);
          setFailed(false);
          setUpdatedAt(Date.now());
        })
        .catch(() => {
          if (alive) setFailed(true);
        });
    };

    load();
    const id = window.setInterval(load, REFRESH_MS);
    return () => {
      alive = false;
      window.clearInterval(id);
    };
  }, []);

  const volumeMissing = data?.rows.some((row) => row.volume <= 0) ?? false;

  return (
    <>
      <section className="mt-8 border-t border-line pt-5">
        <div className="mb-3 flex flex-wrap items-end justify-between gap-3">
          <div>
            <p className="flex items-center gap-2 font-mono text-[10px] tracking-[0.16em] text-tx2 uppercase">
              <span aria-hidden="true" className="h-px w-6 bg-ac/60" />
              CBOE · volume du jour
            </p>
            <h2 className="mt-1.5 text-lg font-semibold tracking-[-0.02em]">
              L’activité des indices
            </h2>
            <p className="mt-1 max-w-[70ch] text-[11px] text-tx2">{tr.flow.indexNote}</p>
          </div>
          <div className="flex flex-col items-start gap-1.5 sm:items-end">
            {data ? (
              <DataBadge provenance={data.provenance} />
            ) : (
              <span className="font-mono text-[10px] text-tx2">CBOE (différé 15 min)</span>
            )}
            {updatedAt && (
              <span className="num text-[10px] text-tx2">
                actualisé {fmtAgo(updatedAt)} · auto 60 s
              </span>
            )}
          </div>
        </div>

        {volumeMissing && (
          <p className="mb-3 rounded-md border border-zero/30 bg-zero/8 px-3 py-2 text-[11px] text-tx2">
            Ce snapshot CBOE ne publie pas le volume : les valeurs concernées restent en
            « — » jusqu’au prochain rafraîchissement (60 s). L’open interest, lui, est
            complet.
          </p>
        )}

        {failed && (
          <Card className="text-xs text-tx2">
            Activité indisponible : la source CBOE n’a pas répondu. Réessayez dans quelques
            instants.
          </Card>
        )}

        <div className="grid grid-cols-[repeat(auto-fit,minmax(min(100%,270px),1fr))] gap-3">
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

          {data?.rows.map((row, index) => {
            const known = row.volume > 0;
            const peak = row.topStrikes[0]?.volume ?? 0;
            return (
              <Card
                key={row.assetId}
                padded={false}
                className="rise overflow-hidden"
                style={{ ["--i" as string]: index }}
              >
                <div className="flex items-baseline justify-between gap-2 border-b border-line px-3.5 py-2.5">
                  <b className="text-[13px] font-semibold">{row.symbol}</b>
                  <span className="num text-[10px] text-tx2">
                    {row.contracts} contrats · OI {fmtCompact(row.oi)}
                  </span>
                </div>

                <div className="grid grid-cols-[1fr_70px_70px] gap-2 px-3.5 pt-2 pb-1.5 font-mono text-[9px] tracking-[0.08em] text-tx2 uppercase">
                  <span>Strike</span>
                  <span className="text-right">Volume</span>
                  <span className="text-right">OI</span>
                </div>

                <div className="px-3.5">
                  {row.topStrikes.map((strike, line) => (
                    <div
                      key={strike.strike}
                      style={{ ["--d" as string]: `${line * 70}ms` }}
                      className="relative grid grid-cols-[1fr_70px_70px] gap-2 border-b border-line py-1.5 text-xs transition-colors last:border-0 hover:bg-white/[0.035]"
                    >
                      {known && (
                        <span
                          aria-hidden="true"
                          className="fill absolute inset-y-1 right-0 origin-right rounded-sm bg-gradient-to-l from-call/15 to-transparent"
                          style={{ width: `${Math.max(4, (strike.volume / peak) * 92)}%` }}
                        />
                      )}
                      <span className="num relative">{fmt(strike.strike, 0)}</span>
                      <span className="num relative text-right">
                        {known ? fmtCompact(strike.volume) : "—"}
                      </span>
                      <span className="num relative text-right text-tx2">
                        {fmtCompact(strike.oi)}
                      </span>
                    </div>
                  ))}
                </div>

                <div className="mt-2 flex items-center justify-between gap-2 border-t border-line px-3.5 py-2 text-[10px] text-tx2">
                  <span
                    title={
                      row.deltaVolume === null
                        ? "En attente d’un second snapshot CBOE (≈ 15 min)"
                        : "Contrats échangés depuis le snapshot précédent"
                    }
                  >
                    Δ volume{" "}
                    <b className="num text-tx">
                      {row.deltaVolume === null || !known
                        ? "—"
                        : fmtCompact(row.deltaVolume)}
                    </b>
                  </span>
                  <span className="num">{row.contracts} contrats</span>
                </div>
              </Card>
            );
          })}
        </div>
      </section>
    </>
  );
}
