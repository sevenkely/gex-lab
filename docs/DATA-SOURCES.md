# Sources de données — vérifications, écarts et risques

Toutes les sources sont **gratuites et sans clé payante**. Chaque réponse API
expose `{ asOf, delayMs, source, derived, stale, demo }` : l'interface affiche
ces champs, et un repli sur les fixtures est toujours étiqueté `demo: true`.

Vérifications effectuées le **2026-10-19** avec `curl`, avant l'implémentation.

| Actif | Options | Prix / bougies | Latence annoncée |
|---|---|---|---|
| BTC, ETH | Deribit REST | Deribit (perpétuel + bougies) | temps réel (`delayMs: 0`) |
| SPX, NDX | CBOE delayed quotes | Yahoo Finance (`^GSPC`, `^NDX`) | 15 min (`900 000`) |
| SPY, QQQ, GLD | CBOE delayed quotes | Yahoo Finance | 15 min |
| NQ | NDX (proxy) | Yahoo `NQ=F` | 15 min, `derived: true` |
| GC | GLD (proxy) | Yahoo `GC=F` | 15 min, `derived: true` |
| Dark pool | FINRA ATS hebdomadaire | — | ~3-5 semaines |

---

## Deribit (BTC, ETH)

Endpoints utilisés (public, sans clé) :

| Endpoint | Usage | Réponse observée |
|---|---|---|
| `/public/get_book_summary_by_currency?currency=BTC&kind=option` | chaîne complète + OI + IV | 928 instruments, 413 Ko, ~0,4 s |
| `/public/ticker?instrument_name=BTC-PERPETUAL` | prix (dernier) + `stats.price_change` 24 h | `index_price` inclus |
| `/public/get_tradingview_chart_data?…&resolution=5` | bougies | tableaux parallèles `ticks/open/high/low/close/volume` |
| `/public/get_last_trades_by_currency?currency=BTC&kind=option&count=100` | flux (REST) | `direction`, `block_trade_id` (4/100 trades) |

Points vérifiés :

- **`open_interest` est en contrats** (1 contrat = 1 BTC ou 1 ETH) → multiplicateur `1`.
- **`mark_iv` est en pourcent** (84.6 = 84,6 %) → divisé par 100.
- **Aucun gamma n'est fourni** : il est recalculé en Black-Scholes à partir de
  `mark_iv`, du strike et de l'échéance (`timeToExpiryYears`, plancher 1 h pour
  les 0DTE). C'est la seule partie « calculée » de la chaîne crypto.
- L'échéance est encodée dans `instrument_name` (`BTC-27NOV26-82000-P`) et
  correspond à **08:00 UTC**.
- Les trades REST sont limités (~100 plus récents, jusqu'à ~40 min d'ancienneté
  en marché calme) : le temps réel viendra du WebSocket côté navigateur
  (`trades.option.*.100ms`), pas de ce endpoint.

## CBOE — options différées 15 min (SPX, NDX, SPY, QQQ, GLD)

```
https://cdn.cboe.com/api/global/delayed_quotes/options/_SPX.json
  → 307 vers https://cdn-api.cboe.com/api/global/delayed_quotes/options/_SPX.json
```

Le host `cdn-api.cboe.com` est appelé directement. Volumes observés :

| Symbole | Taille | Contrats | `current_price` |
|---|---|---|---|
| `_SPX` | 13,2 Mo | 29 650 | 7 659,44 |
| `_NDX` | 7,2 Mo | 16 730 | 29 187,55 |
| `SPY` | 5,7 Mo | 12 730 | 763,25 |
| `QQQ` | 4,8 Mo | 10 876 | 707,87 |
| `GLD` | 3,3 Mo | 7 468 | 382,01 |

Structure : `{ timestamp: "YYYY-MM-DD HH:MM:SS", data: { symbol,
current_price, prev_day_close, iv30, options: [...] } }`. Chaque option porte un
symbole OCC (`SPX261120C00400000`), `gamma`, `open_interest`, `volume`, `bid`,
`ask`, `last_trade_price`.

**Écarts constatés avec le cahier des charges** :

1. **Le champ `iv` est inutilisable.** Pour un call ATM 30 jours coté
   ≈ 18,6 % d'IV implicite (inversion Black-Scholes sur le mid), le champ vaut
   `0,001471` — soit 0,147 %. Le rapport implicite/champ varie de 75 à 145
   selon les séries : ce n'est pas un simple changement d'unité. On **ignore
   `iv`** et on recalcule l'IV depuis le mid bid/ask (`bsImpliedVol`). Sans
   cotation exploitable, `iv` reste `undefined` — sans effet sur le GEX, qui
   utilise le gamma fourni.
2. **`gamma` est par action** et arrondi à 4 décimales (0,0009 pour un ATM
   30 j) : la médiane du rapport gamma_source / gamma_BS vaut 0,96 sur 15 000
   contrats. Le calcul applique donc `Γ × OI × 100 × S² × 0,01`, conformément
   à la convention.
3. **L'échéance n'est pas dans la réponse** : elle est reconstruite depuis le
   symbole OCC, à **16:00 heure de New York**, en calculant l'offset d'été/hiver
   (`usCloseUtc`). Une marge d'un jour couvre les échéances déjà passées.
4. **Poids réseau** : 13 Mo par rafraîchissement pour SPX, cache serveur 60 s
   (conforme au cahier des charges). Un premier appel à froid peut prendre
   2 à 7 s selon le CDN ; c'est la principale source de latence de l'app.

Le parsing OCC : racine + `AAMMJJ` + `C/P` + strike sur 8 chiffres avec 3
décimales (`00400000` → 400,0 ; `09800000` → 9 800,0), soit `/ 1000`.

## Yahoo Finance — prix et bougies (non officiel)

```
https://query1.finance.yahoo.com/v8/finance/chart/^GSPC?range=5d&interval=15m
```

Contraintes vérifiées :

- **User-Agent navigateur obligatoire** (sinon 429/403) ;
- intervalles **en minuscules** : `1m, 5m, 15m, 60m, 1d` (`15M` ou `1D` → 400) ;
- `meta.previousClose` + `meta.regularMarketTime` fournissent variation et
  horodatage réels, sans recalcul depuis les bougies.

**Risque assumé** : endpoint non contractuel, hors CGU commerciales, schéma
susceptible de changer sans préavis. Le registre sert le dernier cache marqué
`stale`, puis un prix marqué « prix indisponible ». Implémentations
échangeables prévues derrière `PriceProvider` :

| Alternative | Tier gratuit | Remarque |
|---|---|---|
| Twelve Data | 800 req/jour | clé requise, indices US couverts |
| Finnhub | 60 req/min | `^GSPC` via `/quote` |
| Alpha Vantage | 25 req/jour | trop limité pour du temps réel |

Aucune n'est branchée : il suffit d'ajouter un fichier dans
`src/server/providers/` et de l'ajouter à `priceProviders`.

## FINRA — dark pool ATS hebdomadaire

```
POST https://api.finra.org/data/group/otcMarket/name/weeklySummary
```

**Écarts majeurs avec le cahier des charges** :

1. **Aucune authentification nécessaire.** Le dataset répond `200` sans OAuth
   (vérifié). L'endpoint OAuth (`ews.fip.finra.org/.../access_token`) existe et
   renvoie bien `invalid_client` avec de faux identifiants : le support
   `FINRA_CLIENT_ID` / `FINRA_CLIENT_SECRET` est conservé au cas où FINRA
   l'exigerait, mais ces variables sont facultatives.
2. **`Accept: application/json` est obligatoire.** Avec
   `application/json, text/plain, */*`, l'API renvoie **du CSV**. C'est la cause
   d'un repli silencieux sur les fixtures lors du premier essai.
3. **Le tri serveur exige les clés de partition** (`weekStartDate` +
   `tierIdentifier`) en `EQUAL` — impossible à combiner avec un filtre par
   symbole. On récupère donc une fenêtre glissante de 70 jours et on prend la
   semaine maximale côté serveur.
4. **Le filtre `IN` n'est pas supporté** (`Unable to parse request body`) :
   une requête par symbole, en parallèle.
5. **Latence réelle** : la semaine du 2026-09-21 a été publiée le 2026-10-12,
   soit ~3 semaines de retard. L'interface doit parler de « volumes
   hebdomadaires », jamais de prints en direct.
6. **SPX n'est pas couvert** (pas de volume ATS pour un indice) : l'interface
   l'indique explicitement ; seuls SPY, QQQ, GLD (et les actions/ETF) le sont.

Champs utilisés : `issueSymbolIdentifier`, `weekStartDate`,
`summaryTypeCode = ATS_W_SMBL_FIRM` (une ligne par ATS et par symbole),
`MPID`, `marketParticipantName`, `totalWeeklyShareQuantity`,
`totalWeeklyTradeCount`, `totalNotionalSum`, `initialPublishedDate`.

## Cache et latences

| Donnée | TTL | Fichier |
|---|---|---|
| Chaîne CBOE | 60 s | `src/server/cache.ts` (`TTL.cboeChain`) |
| Chaîne Deribit | 20 s | `TTL.deribitChain` |
| Cotations | 5 s | `TTL.quote` |
| Bougies | 30 s | `TTL.candles` |
| FINRA | 1 h | `TTL.finra` |

`cached()` applique un **stale-while-error** : si le chargeur échoue et qu'une
valeur existe, elle est servie avec `stale: true` et un badge « dernier cache »
plutôt qu'une page d'erreur. Un driver Redis (Upstash REST) peut être branché
via `setCacheDriver` sans toucher aux providers.

## Proxies NQ / GC

`ratio = prix_futures / prix_sous_jacent`, calculé sur deux cotations dont les
horodatages sont comparés (`computeRatio`). Les niveaux sont multipliés par le
ratio puis arrondis au tick du contrat (NQ 0,25 ; GC 0,1) **pour l'affichage
uniquement**. La réponse porte `derived: true` et le couple de prix utilisés.
