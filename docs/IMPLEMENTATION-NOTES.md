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

## 3. Contraintes d'environnement

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
