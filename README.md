# GEX Lab — terminal de niveaux gamma

Terminal de marché orienté **niveaux d'exposition gamma** : bandes GEX sur le
graphique, échelle de strikes (zero gamma, call/put walls, pOC/pVAH/pVAL, pLO),
flux d'options crypto, dark pool et lecture de régime. Next.js 16 (App Router),
React 19, Tailwind v4, `lightweight-charts`.

## Pages

| Route | Contenu |
| --- | --- |
| `/` | Accueil : cartes actifs, régime, niveaux clés |
| `/graphique/[symbol]` | Graphique + bandes GEX, échelle de strikes, outils de dessin, alertes |
| `/gamma/[symbol]` | Détail gamma : barres par strike, heatmap par échéance, narration, export |
| `/flux` | Flux d'options Deribit (BTC, ETH) + activité indices |
| `/dark-pool` | Imprimés dark pool (proxy FINRA) |
| `/methodologie` | Définition des niveaux, hypothèses de calcul, sources |

Actifs suivis : `ES` (proxy SPX), `NQ` (proxy QQQ), `GC` (proxy GLD), `BTC`,
`ETH`, `SPX`, `NDX`, `SPY`, `QQQ`, `GLD`. Voir `src/config/assets.ts`.

## API

`/api/gex/[symbol]`, `/api/levels/[symbol]`, `/api/chain/[symbol]`,
`/api/candles/[symbol]`, `/api/flow-indices`, `/api/darkpool`.

## Développement

```bash
npm install
npm run dev      # http://localhost:3000
```

Aucune clé n'est nécessaire : toutes les sources (CBOE, Deribit, Yahoo, FINRA)
sont publiques. Copier `.env.example` en `.env.local` pour changer de mode :

- `DATA_MODE=auto` (défaut) — sources réelles, repli sur fixtures si une source échoue ;
- `DATA_MODE=live` — sources réelles uniquement, les erreurs remontent ;
- `DATA_MODE=mock` — fixtures uniquement (hors ligne, tests).

Détail des sources et de leurs limites : [`docs/DATA-SOURCES.md`](docs/DATA-SOURCES.md).

## Vérifications

```bash
npm run typecheck
npm test           # vitest (calcul GEX, proxies, niveaux, dessins, alertes)
npm run test:e2e   # playwright
npm run build
```

## Déploiement sur Vercel

Le projet est un Next.js standard : Vercel détecte le framework, `npm install`
puis `npm run build` suffisent, aucune variable d'environnement n'est requise.

[![Deploy with Vercel](https://vercel.com/button)](https://vercel.com/new/clone?repository-url=https://github.com/sevenkely/gex-lab)

Déploiement depuis le tableau de bord :

1. **Add New → Project**, importer `sevenkely/gex-lab`.
2. Framework preset **Next.js**, root directory `.`, build `npm run build`.
3. Déployer. Chaque push sur `main` redéploie en production, les autres branches
   produisent une preview.

### Cache partagé (recommandé en production)

Le serveur met en cache les réponses des providers avec trois niveaux
(`src/server/cache.ts`) : mémoire du process, puis un driver Upstash Redis REST
si `UPSTASH_REDIS_REST_URL` / `UPSTASH_REDIS_REST_TOKEN` sont définies.

En serverless, chaque instance froide repart avec une mémoire vide : la première
requête d'une instance recharge la chaîne d'options complète depuis CBOE
(plusieurs Mo, plusieurs secondes). Brancher Upstash Redis rend ce cache partagé
entre invocations et supprime ces pics de latence. Les deux variables sont donc
optionnelles mais recommandées dès qu'il y a du trafic.

`FINRA_CLIENT_ID` / `FINRA_CLIENT_SECRET` restent facultatifs (le dataset
`weeklySummary` répond aujourd'hui sans authentification).

## Notes d'implémentation

- [`docs/IMPLEMENTATION-NOTES.md`](docs/IMPLEMENTATION-NOTES.md) — décisions de calcul et de rendu.
- [`docs/AUDIT-FEATURE-DESIGN.md`](docs/AUDIT-FEATURE-DESIGN.md) — audit fonctionnel et design.
