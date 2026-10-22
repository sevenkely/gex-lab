# Notes d'implémentation — pièges vérifiés et décisions

Ce fichier consigne les écarts rencontrés pendant l'implémentation, mesurés
dans un navigateur réel (pas déduits de la documentation). Il est mis à jour à
chaque phase.

---

## 1. Les frontières de chargement (`loading.tsx`, `<Suspense>` de page) ne s'hydratent pas

**Constat (mesuré, dev *et* build de production, Next 16.4.2 / React 19.3 /
Turbopack, Chromium) :**

- Une page `async` enveloppée dans une frontière Suspense (celle créée par
  `app/**/loading.tsx`, ou un `<Suspense>` placé dans la page autour du contenu)
  est bien rendue côté serveur — le HTML arrive, les données sont correctes —
  mais :
  - le fallback reste dans le DOM (squelettes fantômes) ;
  - les composants clients de la page **ne sont jamais hydratés** : aucun
    `__reactFiber$` sur leurs nœuds, `onClick` inerte, état figé ;
  - aucune erreur n'est émise (ni console, ni serveur).
- Les composants clients du *layout* (rail, en-tête) s'hydratent normalement.

**Ce qui fonctionne :** une page `async` qui attend ses données directement,
**sans** `loading.tsx` ni `<Suspense>` au-dessus du contenu. Les composants
clients de la page sont alors hydratés (vérifié : filtre de flux 160 → 80
lignes, bascule de régime, onglets d'actif).

**Décision :** toutes les pages de données sont `async` et attendent leurs
snapshots. Les squelettes sont réservés aux chargements **côté client**
(bougies du graphique, flux temps réel) et aux composants qui se rafraîchissent
seuls. Le premier rendu est calculé serveur à partir du cache applicatif
(20–60 s), donc l'attente reste courte après le premier appel.

**À revoir :** dès qu'une version de Next corrige ce comportement, réintroduire
des `loading.tsx` de segment (meilleure perception de chargement) — le reste du
code n'a pas à changer.

---

## 2. Les transitions sur custom properties enregistrées restent figées (Chromium)

**Constat (mesuré) :** avec

```css
@property --ac {
  syntax: "<color>";
  inherits: true;
  initial-value: #2dd4bf;
}
:root { --ac: var(--ac-long); transition: --ac 900ms var(--ease); }
html[data-regime="short"] { --ac: var(--ac-short); }
```

la valeur calculée de `--ac` **reste bloquée sur la couleur de départ** après la
bascule de régime, indéfiniment (vérifié sur > 3 s, dans les deux sens).
Désactiver la transition (`transition: none !important`) fait immédiatement
apparaître la bonne couleur : c'est bien la transition sur la custom property
qui bloque la valeur.

**Décision :** on n'anime pas la variable. On anime les propriétés réellement
colorées :

- classe utilitaire `.accent` sur les éléments concernés
  (`transition: color/background-color/border-color/box-shadow/opacity 900ms`) ;
- le halo est composé de **deux calques superposés** (turquoise « long » et
  braise « short ») dont l'opacité se croise — les dégradés ne sont pas
  interpolables, l'opacité l'est ;
- `--ac` est posé en valeur littérale (pas de `var()` intermédiaire), ce qui
  garantit un basculement instantané et fiable de la couleur de référence.

**Effet :** l'interface entière passe en douceur du turquoise à la braise
(vérifié : rail, onglets, pastille « Direct », badges de régime, halo).

---

## 3. Défilement d'historique : les bornes coupent l'événement d'à-coup

**Constat (mesuré, Chromium, lightweight-charts 5.2) :**

- Sans `fixLeftEdge`, un défilement latéral sort du jeu de données : le canevas
  devient vide, l'axe n'affiche plus qu'une bougie et l'utilisateur peut perdre
  le graphique de vue.
- Avec `fixLeftEdge: true`, la plage visible se bloque en butée gauche. Or le
  chargement des périodes précédentes était déclenché par
  `subscribeVisibleLogicalRangeChange` : arrivé en butée, la plage ne change
  plus, **aucun événement n'est émis** et l'historique ne se charge jamais.
- `fixRightEdge: true` **force `rightOffset` à 0** (vérifié dans le code de
  lightweight-charts 5.2 : `maxRightOffset()` renvoie 0). La dernière bougie
  est alors dessinée au-delà de la zone traçable — mesuré : centre à 800,8 px
  pour une zone de 798 px — donc invisible sous l'échelle des prix.

**Décision :** borne gauche seulement (`fixLeftEdge`), `rightOffset: 3` conservé
pour que la dernière bougie respire ; la plage est aussi vérifiée dans le geste
(`wheel`, `pointerdown`, `touchstart`). `loadOlder` reste auto-limité (1,5 s)
et marque `exhausted` sur une page vide, un plafond de 20 000 bougies ou un
404 du fournisseur.

**Effet :** la vue reste ancrée sur les mêmes dates après chaque préfixe : la
plage logique est décalée du nombre de bougies ajoutées.

---

## 4. Yahoo Finance : `range=` ne sait pas remonter le temps

**Constat :** `?range=1y&interval=1d` renvoie toujours **la dernière année**,
quelle que soit la fenêtre demandée ; le filtrage `from`/`to` côté provider
rendait donc la page précédente vide (`not_found`).

**Décision :** interroger `period1`/`period2` (secondes UNIX) avec
`includePrePost=false`. Vérifié : SPY 1D sur une fenêtre de septembre 2024
renvoie 249 bougies (2024-09-16 → 2025-09-12). L'API interne reste bornée par
`MAX_BARS` et par le `404` côté client.

**Limite :** Yahoo ne sert pas d'intraday très ancien (quelques semaines en
5m) ; c'est le 404 qui arrête proprement le chargement, pas un calcul local.

---

## 5. Calque de dessin : ancrer sur les données, pas sur les pixels

**Constat (mesuré, Chromium, lightweight-charts 5.2) :**

- `timeToCoordinate(t)` renvoie `null` dès que `t` n’est pas **exactement**
  l’horodatage d’une bougie chargée (week-end sur les indices, horodatage
  au-delà de la dernière bougie après un déplacement). Le dessin disparaît
  alors **en entier**, y compris la partie visible.
- Un `pointerdown` sur le conteneur du graphique part aussi vers le canvas de
  lightweight-charts : sans interception, tracer une tendance déplace la vue
  en même temps.
- Les boutons de la barre d’outils sont dans le même conteneur que le canvas :
  un écouteur en capture qui ne filtre pas la cible crée un dessin au clic sur
  un bouton.

**Décision :**

- ancres stockées en `{ time, price }`, projetées en SVG à chaque changement
  d’échelle (`subscribeVisibleLogicalRangeChange` + signature de plage) ;
- projection par **barre la plus proche** (`nearestBarTime`, recherche
  binaire) : un dessin reste visible et se cale au bord du jeu de données ;
- interception des gestes en phase de capture, uniquement si l’outil est actif
  ou si un dessin est visé, et seulement quand la cible est un `canvas` ;
- persistance `localStorage` par actif **et** unité de temps, lecture
  tolérante (schéma zod, entrée corrompue → liste vide), plafond 200 dessins ;
- refs d’état synchronisées dans un effet (les règles React interdisent de les
  écrire pendant le rendu).

**Limite :** les dessins ne suivent pas un changement d’unité de temps (clé
séparée, comme sur TradingView) ; aucun historique d’annulation (Ctrl+Z).

---

## 6. Niveaux GEX : des lignes franches, pas des rubans

**Constat (maquette de référence) :** le niveau est une ligne au prix exact,
doublée d'une bande translucide pleine largeur ; l'épaisseur et le motif
distinguent les familles (murs pleins et épais, flip tireté, max pain
pointillé). Le rendu précédent — deux sinusoïdes déphasées sur ~20 px, bords
tracés, dégradé qui s'éteint aux extrémités — empilait des rubans flous dès que
deux niveaux se rapprochaient : illisible sur 0DTE, où pPOC, pVAL et pLO
peuvent tenir dans 8 points d'indice.

**Décision :**

- une seule ligne par niveau, alignée sur la grille de pixels (`+0,5` pour les
  traits impairs) ; `LineStyle` propre à chaque famille : plein 2 px pour
  `callWall`/`putWall`, tireté `[7,4]` pour `zeroGamma`, pointillé `[2,3]` pour
  `maxPain`, segments `[18,12]` pour `maxGamma` ;
- bande plate, sans dégradé, **pleine largeur** jusqu'à l'axe, hauteur et
  opacité par famille (13 px / 15 % pour les murs, 17 px / 14 % pour le flip) ;
- `maxGamma` reste en segments discrets pour ne pas masquer la bande d'un mur
  au même strike ;
- le nom du niveau quitte le panneau (plus de texte à gauche) : pastille collée
  contre la colonne des prix dans `LevelTags`, **avec son prix**.

**Un texte = un endroit — mais l'axe reste la colonne de prix.** Masquer
l'échelle de droite au profit du ladder supprimait deux repères : la colonne de
prix et la case du dernier prix. Le ladder n'écrit pourtant pas des prix mais
des **strikes** (et les trois métriques) : les deux colonnes ne doublonnent
rien. L'axe est donc visible à toutes les largeurs, avec la ligne du prix en
cours et sa case colorée sur l'axe (`priceLineVisible`), et la primitive ne
dessine plus de case de prix en desktop (`axisTags` à `false`) : chaque niveau
s'écrit une seule fois, dans sa pastille `LevelTags`.

**Zoom vertical :** lightweight-charts ne notifie rien quand l'échelle des prix
change (glisser sur l'axe, pincement, molette). Pendant un geste et durant les
400 ms qui suivent, les pastilles sont donc repeintes à chaque frame ; au
repos, aucune boucle ne tourne. Les collisions sont résolues par `stackSlots`
(empilement vers le bas, puis reconstruction depuis le bas du panneau), couvert
par `level-tags.test.ts`.

La précision suit la grille lue : `strikeDecimals` écrit `84 000` pour des
strikes entiers et `7 821.75` quand le proxy SPX → ES retombe sur le quart de
point, et les pastilles adoptent la même précision.

**Effet :** à 1440 px, GC 0DTE affiche neuf niveaux lisibles dans 40 points, et
le ladder retrouve sa première colonne de strikes, que les pastilles
recouvraient auparavant.

---

## 7. Contraintes d'environnement

- **CBOE impose une redirection** `cdn.cboe.com` → `cdn-api.cboe.com` : les
  appels serveur doivent suivre les redirections (`redirect: "follow"`, ce que
  fait `fetch` par défaut).
- **Yahoo Finance exige un `User-Agent`** : sans en-tête navigateur, la réponse
  est vide.
- **FINRA accepte les requêtes anonymes** sur `POST /data/group/otcMarket/
  name/weeklySummary` ; les clés de partition `weekStartDate` et
  `tierIdentifier` doivent être fournies en `EQUAL` pour pouvoir trier.
- **Les fichiers `.next/dev` sur ce poste sont lus lentement** (disque réseau /
  antivirus) : Turbopack le signale, cela ralentit les compilations de dev sans
  affecter la production.

---

## 8. Cache partagé : une enveloppe compressée dans Redis

Le cache mémoire suffit à une instance unique, pas en serverless : chaque
instance froide repart vide et recharge la chaîne d'options (≈ 2 Mo une fois
normalisée, 13 Mo bruts pour SPX). Quatre décisions en découlent.

**Lecture partagée, pas seulement écriture.** `cached()` interroge le cache
partagé dès que la mémoire du process est vide, *avant* d'appeler le provider.
Un driver qui ne servirait qu'au repli en erreur ne supprimerait aucun cold
start.

**Enveloppe `{ t, ttl, v }`.** La fraîcheur est décidée côté application, et le
TTL Redis est plus long (30× le TTL applicatif, borné entre 15 min et 24 h).
Une instance froide peut donc encore servir la dernière valeur connue quand la
source est en panne — c'est ce qui alimente « Données en retard ».

**gzip + base64 (`gz:`).** Une chaîne SPX (21 000 contrats) dépasse 2 Mo de
JSON, au-delà de la limite d'une requête REST Upstash. Compressée, elle tombe
sous 900 Ko — vérifié par un test de forme réaliste dans `cache.test.ts`. Les
petites valeurs restent en clair (l'en-tête gzip coûterait plus que le gain).

**Écriture attendue.** En serverless, une promesse flottante peut être
abandonnée dès la réponse envoyée : l'écriture est attendue, mais bornée (4 s)
et son échec ignoré — un cache indisponible ne casse jamais un rendu.

Les chargements concurrents d'une même clé sont fusionnés (single-flight) : une
page qui demande ES côté serveur et l'API GEX en parallèle ne déclenche qu'une
seule récupération CBOE.

---

## 9. Ladder : des chiffres, pas seulement des barres

**Constat :** trois colonnes de barres se lisaient comme une texture — on voyait
où le gamma s'accumulait, pas combien. Sur un strike donné, impossible de dire
si le net GEX valait 120 M ou 400 M sans passer la souris.

**Décision :**

- chaque cellule porte sa valeur, dans une colonne de 46 px réservée à droite :
  la barre ne passe jamais dessous, et les chiffres s'alignent d'une rangée à
  l'autre (colonnes tabulaires) ;
- les barres glissent d'une mise à jour à l'autre (transition sur `width` /
  `left`, 420 ms) au lieu de sauter d'un coup ;
- la rangée du spot reçoit un rail accentué, un point et un prix en gras ; les
  niveaux gardent leur pastille et un filet coloré ;
- le pied du tableau additionne la fenêtre affichée (Σ DEX, Σ GEX, Σ OI) et
  rappelle le nombre de strikes : la forme vient des barres, l'ordre de grandeur
  vient du total.

**Effet :** la colonne se lit comme un carnet — prix, valeur, magnitude — sans
survol, y compris sur une capture d'écran.

## 10. Les pastilles de niveau avaient besoin d'une largeur intrinsèque

**Constat :** `LevelTags` vit dans un hôte de 0 px de large (`w-0`), positionné
par `right` uniquement. La pastille, elle, prenait la largeur restante : elle se
faisait écraser et son prix était coupé dès que le libellé s'allongeait
(« CALL WALL 7,800.75 »).

**Décision :** `w-max` sur la pastille — elle se dimensionne sur son contenu et
déborde vers la gauche, ce qui est exactement le comportement voulu contre
l'axe. Au premier rendu, la largeur de l'axe vaut parfois 0 avant la mise en
page : une reprise unique à 150 ms replace la pastille une fois l'axe mesuré.
