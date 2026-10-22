import type { ReactNode } from "react";
import { ASSETS } from "@/config/assets";
import { Toc } from "@/features/methodology/components/Toc";
import { fmtDelay } from "@/lib/format";
import { t } from "@/lib/i18n";
import { PageHeader } from "@/ui/PageHeader";

export const metadata = { title: "Méthodologie & sources — GEX Terminal" };

const SOURCE_LABELS: Record<string, string> = {
  deribit: "Deribit (public REST + WebSocket)",
  cboe: "CBOE (delayed quotes JSON)",
  proxy: "Dérivé d’un proxy",
};

/** Sommaire : chaque entrée pointe une section de la page. */
const SECTIONS = [
  { id: "calcul", n: "01", title: "Ce que calcule le terminal" },
  { id: "formules", n: "02", title: "Formules" },
  { id: "limites", n: "03", title: "Hypothèses et limites" },
  { id: "proxies", n: "04", title: "Dérivés (proxies)" },
  { id: "dark-pool", n: "05", title: "Dark pool" },
  { id: "sources", n: "06", title: "Sources et latences" },
  { id: "avertissement", n: "07", title: "Avertissement" },
] as const;

function Section({
  id,
  n,
  title,
  index,
  children,
}: {
  id: string;
  n: string;
  title: string;
  index: number;
  children: ReactNode;
}) {
  return (
    <section
      id={id}
      style={{ ["--i" as string]: index }}
      className="rise panel scroll-mt-4 overflow-hidden"
    >
      <header className="flex items-baseline gap-3 border-b border-line px-4 py-3">
        <span className="num text-[10px] tracking-[0.1em] text-ac accent">{n}</span>
        <h2 className="text-sm font-semibold tracking-[-0.01em]">{title}</h2>
      </header>
      <div className="px-4 py-3.5 text-xs leading-relaxed text-tx2">{children}</div>
    </section>
  );
}

export default function MethodologyPage() {
  const tr = t();

  return (
    <div className="h-full scroll-smooth overflow-auto">
      <div className="mx-auto max-w-[1120px] p-4 lg:p-6">
        <PageHeader
          eyebrow="Méthodologie · sources · limites"
          title={
            <>
              Ce que le terminal <span className="text-ac">calcule vraiment</span>.
            </>
          }
          lead={
            <>
              Aucun positionnement dealer n’est acheté ni deviné : tout part du gamma et
              de l’open interest publics. Les formules, les conventions et les angles
              morts sont écrits ici, en clair.
            </>
          }
          aside={
            <a
              href="#sources"
              className="rounded-full border border-line px-3 py-1.5 text-[11px] text-tx2 transition-colors duration-200 hover:border-ac/50 hover:text-ac"
            >
              Sources & latences ↓
            </a>
          }
        />

        <div className="grid items-start gap-6 lg:grid-cols-[190px_minmax(0,1fr)]">
          <div className="hidden lg:block">
            <Toc
              sections={SECTIONS}
              note={`${ASSETS.length} actifs suivis · ${
                new Set(ASSETS.map((asset) => asset.chainSource)).size
              } familles de sources`}
            />
          </div>

          <div className="flex min-w-0 flex-col gap-3">
            <Section id="calcul" n="01" title="Ce que calcule le terminal" index={0}>
              <p>
                Le GEX (gamma exposure) estime la couverture théorique que les dealers
                devraient mettre en place pour rester neutres, à partir du gamma et de
                l’open interest de la chaîne d’options publique. Tout est calculé par nos
                soins : aucune donnée de positionnement dealer n’est achetée, observée ou
                inférée autrement.
              </p>
            </Section>

            <Section id="formules" n="02" title="Formules" index={1}>
              <ul className="flex flex-col gap-2.5">
                <li className="border-l border-line pl-3">
                  <b className="text-tx">GEX par contrat</b> = ± Γ × OI × multiplicateur ×
                  S² × 0,01
                  <br />
                  (+ pour les calls, − pour les puts). Le terme S² × 0,01 convertit le
                  gamma en dollars par +1 % de mouvement du sous-jacent. Multiplicateurs :
                  100 pour les produits CBOE (100 titres par contrat), 1 pour Deribit (1
                  BTC / 1 ETH par contrat).
                </li>
                <li className="border-l border-line pl-3">
                  <b className="text-tx">{tr.levels.callWall}</b> : strike au GEX call le
                  plus élevé dans ± 15 % du spot.{" "}
                  <b className="text-tx">{tr.levels.putWall}</b> : strike au |GEX| put le
                  plus élevé dans la même fenêtre.
                </li>
                <li className="border-l border-line pl-3">
                  <b className="text-tx">{tr.levels.zeroGamma}</b> (flip) : le Net GEX est
                  recalculé sur une grille de spots hypothétiques (± 10 %, au moins 81
                  points, IV et échéances figées). Le zero gamma est l’interpolation
                  linéaire du passage du Net GEX par zéro.
                </li>
                <li className="border-l border-line pl-3">
                  <b className="text-tx">{tr.metrics.expectedMove}</b> = S × IV ATM (échéance
                  la plus proche) × √(1/365). C’est un écart-type de mouvement, pas une
                  prévision.
                </li>
                <li className="border-l border-line pl-3">
                  <b className="text-tx">Régime</b> : « long gamma » si spot ≥ zero gamma, «
                  short gamma » sinon. En long gamma la couverture amortit les mouvements ;
                  en short gamma elle les amplifie.
                </li>
              </ul>
            </Section>

            <Section id="limites" n="03" title="Hypothèses et limites" index={2}>
              <ul className="flex list-disc flex-col gap-1.5 pl-4 marker:text-ac/60">
                <li>
                  <b className="text-tx">Convention, pas observation.</b> Le signe des puts
                  suppose que les dealers sont structurellement courts le gamma des puts
                  achetés par les clients. Si leur position réelle diffère, les niveaux
                  n’ont pas le même sens.
                </li>
                <li>
                  Aucun indicateur n’est une probabilité de rebond : un mur de gamma est un
                  niveau où la couverture est dense, pas une promesse de support ou de
                  résistance.
                </li>
                <li>
                  Les chaînes CBOE sont différées de 15 minutes ; Deribit est temps réel
                  mais ne publie pas les positions, seulement OI, IV, prix et trades.
                </li>
                <li>
                  Le gamma CBOE est celui fourni par la source ; pour Deribit il est
                  recalculé en Black-Scholes à partir de l’IV observée (plancher de temps
                  pour les 0DTE, qui évite une division par zéro).
                </li>
                <li>
                  Les indices (SPX, NDX) n’ont pas de volume ATS propre : la page dark pool
                  couvre les ETF et actions uniquement.
                </li>
              </ul>
            </Section>

            <Section id="proxies" n="04" title="Dérivés (proxies)" index={3}>
              <p>
                NQ et GC n’ont pas de chaîne d’options gratuite exploitable. Leurs niveaux
                sont dérivés de la chaîne du sous-jacent (NDX, GLD) multipliée par le
                ratio futures / sous-jacent calculé sur des cotations à timestamps alignés,
                puis arrondis au tick du contrat (0,25 pour NQ, 0,1 pour GC). L’interface
                affiche le ratio et un badge « Dérivé (proxy) » : ce sont des niveaux
                indicatifs, pas des niveaux d’options CME observés.
              </p>
            </Section>

            <Section id="dark-pool" n="05" title="Dark pool" index={4}>
              <p>
                Volumes ATS hebdomadaires publiés par FINRA (dataset weeklySummary, groupe
                otcMarket), par symbole et par ATS. Ce sont des agrégats de fin de semaine
                publiés avec plusieurs semaines de retard : ni des prints en direct, ni un
                indicateur de sens. L’interface l’indique explicitement à côté de chaque
                chiffre.
              </p>
            </Section>

            <Section id="sources" n="06" title="Sources et latences" index={5}>
              <div className="-mx-4 -my-3.5 overflow-x-auto">
                <table className="w-full min-w-[640px] border-collapse text-xs">
                  <thead>
                    <tr className="font-mono text-[9px] tracking-[0.1em] text-tx2 uppercase">
                      <th className="border-b border-line px-4 py-2 text-left">Actif</th>
                      <th className="border-b border-line px-2 py-2 text-left">
                        Chaîne d’options
                      </th>
                      <th className="border-b border-line px-2 py-2 text-left">Prix</th>
                      <th className="border-b border-line px-2 py-2 text-left">Latence</th>
                      <th className="border-b border-line px-2 py-2 pr-4 text-right">
                        Multiplicateur
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {ASSETS.map((asset) => (
                      <tr
                        key={asset.id}
                        className="text-tx2 transition-colors hover:bg-white/[0.035]"
                      >
                        <td className="border-b border-line px-4 py-2 font-semibold text-tx">
                          {asset.symbol}
                        </td>
                        <td className="border-b border-line px-2 py-2">
                          {SOURCE_LABELS[asset.chainSource]}
                          {asset.chainSource === "proxy" && (
                            <span className="text-zero"> → {asset.proxy?.underlyingId}</span>
                          )}
                        </td>
                        <td className="num border-b border-line px-2 py-2">
                          {asset.priceSymbol}
                        </td>
                        <td className="border-b border-line px-2 py-2">
                          {asset.delayMs === 0 ? (
                            <span className="text-call">temps réel</span>
                          ) : (
                            fmtDelay(asset.delayMs)
                          )}
                        </td>
                        <td className="num border-b border-line px-2 py-2 pr-4 text-right">
                          {asset.multiplier}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <p className="mt-3 text-[11px]">
                Sources publiques et gratuites uniquement. Aucune clé payante n’est requise
                pour l’essentiel ; FINRA accepte les requêtes anonymes, avec OAuth2 client
                credentials optionnel pour des quotas plus confortables. Détail des
                endpoints, quotas et risques (conditions d’utilisation) dans{" "}
                <code className="rounded bg-white/5 px-1 py-0.5 font-mono text-[10px] text-tx">
                  docs/DATA-SOURCES.md
                </code>
                .
              </p>
            </Section>

            <Section id="avertissement" n="07" title="Avertissement" index={6}>
              <p className="border-l-2 border-put/60 pl-3 text-tx2">
                {tr.common.disclaimer}
              </p>
            </Section>

            <p className="mt-1 flex flex-wrap items-center justify-between gap-2 px-1 text-[10px] text-tx2">
              <span>
                Chiffres arrondis à l’affichage ; les exports CSV/JSON gardent la précision
                complète.
              </span>
              <span className="num">
                {SECTIONS.length.toString().padStart(2, "0")} sections
              </span>
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}
