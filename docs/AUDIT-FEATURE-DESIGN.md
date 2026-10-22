# Audit features & design — GEX Terminal face aux plateformes de référence

Comparaison du terminal avec la liste de fonctionnalités des plateformes
citées (SpotGamma, GexVision, Gexmap, Heatseeker, MenthorQ, Quant Data…),
relevée en octobre 2026. Chaque ligne indique **l'état réel dans ce dépôt**
(fichier concerné) et la décision prise.

Légende : ✅ présent · 🟡 partiel · ❌ absent

---

## 1. Socle (must-have)

| Fonction                         | État | Où / écart                                                                                                           |
| -------------------------------- | ---- | -------------------------------------------------------------------------------------------------------------------- |
| Call Wall                        | ✅   | `findWalls()` → `LevelCards`, bande + pastille d'axe, `/api/levels`                                                  |
| Put Wall                         | ✅   | idem                                                                                                                 |
| Gamma Flip / Zero Gamma          | ✅   | `computeZeroGamma()` sur grille ±10 %, 121 points                                                                    |
| Max Gamma / King Node            | ✅   | segments sur le graphique + carte dans le panneau (couleur acier dédiée)                                             |
| Max Pain                         | ✅   | **ajouté** : `computeMaxPain()` (OI calls/puts par strike), niveau, carte, API                                       |
| Vol Trigger (SpotGamma)          | 🟡   | concept identique au zero gamma ; **documenté comme tel** au lieu d'être dupliqué                                    |
| Net GEX                          | ✅   | `netGex` affiché (panneau, accueil, API)                                                                             |
| Séparation GEX positif / négatif | ✅   | barre `+X M$ / −Y M$` + part positive, sous le Net GEX                                                               |
| Régime long / short gamma        | ✅   | bascule d'accent de toute l'interface + badge + annonce vocale                                                       |
| Découpage par échéance           | 🟡   | `ALL / 0DTE / ≤7 j / ≤35 j` ; chaque échéance est une **colonne** de la heatmap, donc lisible sans changer de filtre |
| GEX par strike (ladder)          | ✅   | `/gamma/[symbol]` + `StrikeBars` (puts à gauche, calls à droite)                                                     |
| Heatmap strike × échéance        | ✅   | **ajouté** : `/gamma/[symbol]` — matrice colorée, fenêtre ±8 strikes, 6 échéances                                    |

## 2. Différenciateurs

| Fonction                         | État | Décision                                                                                                                                |
| -------------------------------- | ---- | --------------------------------------------------------------------------------------------------------------------------------------- |
| Temps réel (prix)                | ✅   | WebSocket Deribit partagé, appliqué ≤ 1×/frame (BTC/ETH) ; la dernière bougie se met à jour et une nouvelle s'ouvre au changement d'intervalle |
| Historique de bougies            | ✅   | **ajouté** : périodes précédentes chargées au défilement (butée gauche), dédupliquées et plafonnées à 20 000 bougies ; Yahoo via `period1/period2` |
| Fenêtres de temps                | ✅   | **ajouté** : 5m = 3 jours, 15m = 7 jours, 1H = 30 jours, 1D = **1 an** (au lieu d'une séance)                                            |
| Évolution intraday du Net GEX    | ❌   | nécessite un historique serveur : **hors périmètre** (voir §4)                                                                          |
| Vanna (VEX) / Charm / DEX        | ❌   | calculables (Black-Scholes déjà présent) mais aucun ancrage visuel utile sans heatmap dédiée → phase suivante                           |
| Narrateur (commentaire en clair) | ✅   | **ajouté** : `narrator.ts` (règles déterministes) → `MarketRead` sous le régime : régime, corridor, mouvement attendu vs murs ; 6 tests |
| Alertes intelligentes            | ✅   | **ajouté** : approche / toucher / croisement de niveau + journal sur le graphique                                                       |
| Replay historique                | ❌   | suppose un stockage de snapshots (hors périmètre, dépend d'une base)                                                                    |
| Multi-ticker                     | 🟡   | tableau de bord d'accueil (`GexBars`, cartes par actif) ; pas de vue côte à côte → phase suivante                                       |
| Flux options + dark pool         | 🟡   | deux pages distinctes ; pas de superposition sur le graphique → phase suivante                                                          |
| Screener                         | ❌   | phase suivante (dépend d'un univers plus large que 9 actifs)                                                                            |
| Workspace personnalisable        | 🟡   | mode Focus + filtres mémorisés ; pas de drag & drop → assumé                                                                            |
| Overlays plateformes             | 🟡   | niveaux exportables en CSV, mais pas d'indicateur TradingView / Sierra Chart natif                                                      |
| Export / API                     | ✅   | trois liens sur `/gamma` : profil par strike (CSV), niveaux (CSV), snapshot (JSON)                                                      |
| 3D / surface gamma               | ❌   | hors périmètre (rendu 3D canvas/WebGL disproportionné pour l'usage)                                                                     |

## 3. Design & UX

| Principe                    | État | Détail                                                                                                                    |
| --------------------------- | ---- | ------------------------------------------------------------------------------------------------------------------------- |
| Sombre par défaut           | ✅   | tokens Gamma Field, `--bg` unique                                                                                         |
| Lisibilité instantanée      | ✅   | niveaux colorés (turquoise / braise / sable), pastilles d'axes, bandes                                                    |
| Système de couleurs         | ✅   | positif = turquoise, négatif = braise, flip = sable ; **jamais** le duo vert/rouge                                        |
| Chiffres tabulaires         | ✅   | utilitaire `num` (JetBrains Mono) partout                                                                                 |
| Hiérarchie                  | ✅   | panneau réordonné : spot → régime → lecture → Net GEX → niveaux → alertes ; le journal d'alertes ne repousse plus le prix |
| Tooltips riches             | 🟡   | `Tooltip` (CSS pur) utilisé sur le flux ; **ajouté** sur les niveaux (définition + fenêtre de calcul)                     |
| Filtres cliquables          | ✅   | `Tabs` (actif, unité de temps, échéance)                                                                                  |
| Palette de commandes ⌘K     | ✅   | **ajoutée** : actifs et pages, recherche multi-mots, navigation clavier                                                   |
| Dashboard 3 colonnes        | ✅   | rail + contenu + panneau ; journal d'alertes en bas du panneau, toasts au-dessus du graphique                             |
| Barre de métriques collante | 🟡   | la légende OHLC + chips de niveaux du graphique en tient lieu                                                             || Dessin sur le graphique     | ✅   | **ajouté** : ligne horizontale, tendance, zone, texte ; couleur, épaisseur, pointillés ; déplacement, suppression, persistance par actif + unité de temps |
| Libellés des zones          | ✅   | **ajouté** : nom du niveau écrit sur chaque bande (« CALL WALL », « ZERO GAMMA »…) + bascule « Textes » dans l’en-tête du graphique          |
| Micro-interactions          | ✅   | `rise`, `NumberRoll`, halo de régime, pulsation du point « Direct », délai animé de la palette                                              |
| Couche pédagogique          | ✅   | `/methodologie` + info-bulles sur chaque niveau + lecture du marché en trois phrases                                      |
| Accessibilité               | ✅   | focus visible, `aria-pressed`, `aria-live` du régime, cibles clavier                                                      |

## 4. Ce qui manque encore après cette itération

1. **Vanna / Charm / DEX** : le moteur Black-Scholes est déjà là ; il faut une
   seconde matrice et une bascule GEX ↔ VEX ↔ Charm.
2. **Évolution intraday du Net GEX** : stockage en mémoire côté serveur
   (anneau glissant) + sparkline. Attention : perdu au redémarrage, à présenter
   comme « session ».
3. **Narrateur enrichi** : la version livrée lit le snapshot courant ; la
   suivante comparera deux snapshots (mur qui se renforce, King Node qui glisse)
   une fois l'historique serveur en place.
4. **Multi-ticker côte à côte** (SPX / SPY / QQQ) et conversion futures sur le
   graphique.
5. **Replay / interval map** : suppose une base de snapshots horodatés.
6. **Screener** : n'a de sens qu'avec plusieurs centaines de symboles.

## 5. Vérifications de cette itération

| Contrôle                | Résultat                                                                                                                                                                                   |
| ----------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `tsc --noEmit`          | 0 erreur                                                                                                                                                                                   |
| `eslint src`            | 0 avertissement                                                                                                                                                                            |
| `vitest run`            | **122 tests / 11 fichiers** verts (dont 10 alertes, 6 narrateur, 31 calcul, 5 fusion d'historique, 6 application d'un tick, 17 dessins)                                                     |
| `next build`            | succès, 13 routes                                                                                                                                                                          |
| Historique au défilement | BTC 5m : défilement à gauche → `GET /api/candles/BTC?…&to=…` 200, vue conservée sur les mêmes dates ; SPY 1D : 2025 puis 2024 servis via `period1/period2` ; butée gauche tenue (plus de canevas vide) |
| Outils de dessin        | BTC 5m : ligne, tendance, zone et texte créés à la souris ; couleur/épaisseur/pointillés appliqués ; sélection puis corbeille (5 → 4) ; « Tout effacer » en deux temps ; persistance après rechargement ; dessins distincts par unité de temps |
| Ancrage des dessins     | Zoom (molette) : les abscisses des dessins suivent les bougies, les ordonnées restent sur le prix ; un dessin déplacé au-delà de la dernière bougie reste rendu (barre la plus proche) |
| Export HTTP             | `/api/gex/BTC?format=csv` → `text/csv`, pièce jointe, 3 lignes de métadonnées ; `/api/levels/BTC?format=csv` → `niveau,type,prix,source` ; `format=7D` répercuté dans le nom de fichier    |
| Navigateur (1440 × 900) | `/`, `/graphique/BTC`, `/gamma/BTC`, `/gamma/ETH` en 200 ; ⌘K ouvre la palette, « eth gamma » → ETH, Entrée navigue ; heatmap, cartes, narrateur et journal d'alertes présents dans le DOM |     | Navigateur (390 × 844) | aucun débordement horizontal ; la heatmap défile dans son cadre ; toutes les pages restent défilables |

Captures de l'état vérifié : `docs/audit-chart-desktop.png` (1440 × 900,
`/graphique/BTC`, panneau et narrateur visibles) et
`docs/chart-history-desktop.png` (même taille, après chargement de la période
précédente au défilement : les bougies du 15 au 17 octobre sont servies par
l'API et la vue reste lisible) et `docs/drawings-desktop.png` (outils de
dessin ouverts, tendance, zone, texte et libellés de zones).

Défauts corrigés pendant la vérification :

- la palette ne trouvait pas « eth gamma » (correspondance sur la chaîne
  entière, tiret cadratin) → recherche **par mots**, ponctuation neutralisée ;
- le placeholder promettait des « filtres » absents → « Actif ou page… » ;
- la hiérarchie du panneau plaçait le journal d'alertes avant le spot ;
- la heatmap s'éteignait sous 20 % du pic → échelle en puissance 0,45 ;
- le narrateur répétait la distance au mur dans deux phrases ;
- sur mobile, la colonne de contenu refusait de rétrécir (`min-h-0` manquant) :
  la fin des pages longues était coupée sans possibilité de défiler ;
- le défilement horizontal sortait du jeu de données (canevas vide) → borne
  gauche `fixLeftEdge`, et chargement déclenché par le geste puisque la borne
  supprime l'événement de plage à l'arrêt ;
- `fixRightEdge` masquait la **dernière bougie** (centre tracé au-delà de la
  zone, sous l'échelle des prix) → supprimé, `rightOffset: 3` de nouveau actif ;
- Yahoo Finance avec `range=` ne renvoyait jamais que la période récente →
  `period1/period2`, sinon « année précédente » restait vide ;
- une page d'historique en 404 (limite du fournisseur) relançait une requête
  à chaque défilement → historique marqué épuisé.

## 6. Limites assumées (à ne pas « corriger » par erreur)

- Le GEX est une **convention** (dealers vendeurs nets d'options), pas du
  positionnement observé. Toute présentation qui suggérerait une observation
  directe serait fausse.
- Le 0DTE Crypto (Deribit) n'existe pas : le filtre 0DTE est vide par
  construction sur ces actifs.
- Les indices n'ont pas de dark pool propre (seuls les ETF/actions sont couverts
  par les ATS FINRA).
- Les chaînes CBOE sont différées de 15 min : aucun niveau affiché ne peut être
  « temps réel » sur ces actifs, quelle que soit l'interface.
