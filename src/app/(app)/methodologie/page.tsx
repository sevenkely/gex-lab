import { ASSETS } from "@/config/assets";
import { fmtDelay } from "@/lib/format";
import { t } from "@/lib/i18n";
import { Card } from "@/ui/Card";

export const metadata = { title: "Méthodologie & sources — GEX Terminal" };

const SOURCE_LABELS: Record<string, string> = {
  deribit: "Deribit (public REST + WebSocket)",
  cboe: "CBOE (delayed quotes JSON)",
  proxy: "Dérivé d’un proxy",
};

export default function MethodologyPage() {
  const tr = t();

  return (
    <div className="h-full overflow-auto p-4">
      <div className="mx-auto flex max-w-[900px] flex-col gap-3 pb-8">
        <Card title={tr.methodology.title} className="text-xs leading-relaxed">
          <h2 className="mb-2 text-sm font-semibold">Ce que calcule le terminal</h2>
          <p className="mb-3 text-tx2">
            Le GEX (gamma exposure) estime la couverture théorique que les dealers
            devraient mettre en place pour rester neutres, à partir du gamma et de l’open
            interest de la chaîne d’options publique. Tout est calculé par nos soins :
            aucune donnée de positionnement dealer n’est achetée, observée ou inférée
            autrement.
          </p>

          <h3 className="mt-4 text-xs font-semibold">Formules</h3>
          <ul className="mt-2 flex flex-col gap-2 text-tx2">
            <li>
              <b className="text-tx">GEX par contrat</b> = ± Γ × OI × multiplicateur × S²
              × 0,01 <br />
              (+ pour les calls, − pour les puts). Le terme S² × 0,01 convertit le gamma
              en dollars par +1 % de mouvement du sous-jacent. Multiplicateurs : 100 pour
              les produits CBOE (100 titres par contrat), 1 pour Deribit (1 BTC / 1 ETH
              par contrat).
            </li>
            <li>
              <b className="text-tx">{tr.levels.callWall}</b> : strike au GEX call le plus
              élevé dans ± 15 % du spot. <b className="text-tx">{tr.levels.putWall}</b> :
              strike au |GEX| put le plus élevé dans la même fenêtre.
            </li>
            <li>
              <b className="text-tx">{tr.levels.zeroGamma}</b> (flip) : le Net GEX est
              recalculé sur une grille de spots hypothétiques (± 10 %, au moins 81 points,
              IV et échéances figées). Le zero gamma est l’interpolation linéaire du
              passage du Net GEX par zéro.
            </li>
            <li>
              <b className="text-tx">{tr.metrics.expectedMove}</b> = S × IV ATM (échéance
              la plus proche) × √(1/365). C’est un écart-type de mouvement, pas une
              prévision.
            </li>
            <li>
              <b className="text-tx">Régime</b> : « long gamma » si spot ≥ zero gamma, «
              short gamma » sinon. En long gamma la couverture amortit les mouvements ; en
              short gamma elle les amplifie.
            </li>
          </ul>

          <h3 className="mt-4 text-xs font-semibold">Hypothèses et limites</h3>
          <ul className="mt-2 flex list-disc flex-col gap-1.5 pl-4 text-tx2">
            <li>
              <b className="text-tx">Convention, pas observation.</b> Le signe des puts
              suppose que les dealers sont structurellement courts le gamma des puts
              achetés par les clients. Si leur position réelle diffère, les niveaux n’ont
              pas le même sens.
            </li>
            <li>
              Aucun indicateur n’est une probabilité de rebond : un mur de gamma est un
              niveau où la couverture est dense, pas une promesse de support ou de
              résistance.
            </li>
            <li>
              Les chaînes CBOE sont différées de 15 minutes ; Deribit est temps réel mais
              ne publie pas les positions, seulement OI, IV, prix et trades.
            </li>
            <li>
              Le gamma CBOE est celui fourni par la source ; pour Deribit il est recalculé
              en Black-Scholes à partir de l’IV observée (plancher de temps pour les 0DTE,
              qui évite une division par zéro).
            </li>
            <li>
              Les indices (SPX, NDX) n’ont pas de volume ATS propre : la page dark pool
              couvre les ETF et actions uniquement.
            </li>
          </ul>

          <h3 className="mt-4 text-xs font-semibold">Dérivés (proxies)</h3>
          <p className="mt-2 text-tx2">
            NQ et GC n’ont pas de chaîne d’options gratuite exploitable. Leurs niveaux
            sont dérivés de la chaîne du sous-jacent (NDX, GLD) multipliée par le ratio
            futures / sous-jacent calculé sur des cotations à timestamps alignés, puis
            arrondis au tick du contrat (0,25 pour NQ, 0,1 pour GC). L’interface affiche
            le ratio et un badge « Dérivé (proxy) » : ce sont des niveaux indicatifs, pas
            des niveaux d’options CME observés.
          </p>

          <h3 className="mt-4 text-xs font-semibold">Dark pool</h3>
          <p className="mt-2 text-tx2">
            Volumes ATS hebdomadaires publiés par FINRA (dataset weeklySummary, groupe
            otcMarket), par symbole et par ATS. Ce sont des agrégats de fin de semaine
            publiés avec plusieurs semaines de retard : ni des prints en direct, ni un
            indicateur de sens. L’interface l’indique explicitement à côté de chaque
            chiffre.
          </p>

          <h3 className="mt-4 text-xs font-semibold">Avertissement</h3>
          <p className="mt-2 text-tx2">{tr.common.disclaimer}</p>
        </Card>

        <Card title="Sources, latences et multiplicateurs">
          <div className="overflow-x-auto">
            <table className="w-full min-w-[640px] border-collapse text-xs">
              <thead>
                <tr className="text-left text-[11px] text-tx2">
                  <th className="border-b border-line py-2">Actif</th>
                  <th className="border-b border-line py-2">Chaîne d’options</th>
                  <th className="border-b border-line py-2">Prix</th>
                  <th className="border-b border-line py-2">Latence</th>
                  <th className="border-b border-line py-2 text-right">Multiplicateur</th>
                </tr>
              </thead>
              <tbody>
                {ASSETS.map((asset) => (
                  <tr key={asset.id} className="text-tx2">
                    <td className="border-b border-line py-2 font-semibold text-tx">
                      {asset.symbol}
                    </td>
                    <td className="border-b border-line py-2">
                      {SOURCE_LABELS[asset.chainSource]}
                      {asset.chainSource === "proxy" && (
                        <span className="text-zero"> → {asset.proxy?.underlyingId}</span>
                      )}
                    </td>
                    <td className="num border-b border-line py-2">{asset.priceSymbol}</td>
                    <td className="border-b border-line py-2">
                      {fmtDelay(asset.delayMs)}
                    </td>
                    <td className="num border-b border-line py-2 text-right">
                      {asset.multiplier}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="mt-3 text-[11px] text-tx2">
            Sources publiques et gratuites uniquement. Aucune clé payante n’est requise
            pour l’essentiel ; FINRA accepte les requêtes anonymes, avec OAuth2 client
            credentials optionnel pour des quotas plus confortables. Détail des endpoints,
            quotas et risques (conditions d’utilisation) dans{" "}
            <code>docs/DATA-SOURCES.md</code>.
          </p>
        </Card>
      </div>
    </div>
  );
}
