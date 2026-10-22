import { describe, expect, it } from "vitest";
import { bsGamma, normPdf } from "@/lib/black-scholes";
import { nyMidnightUtc } from "@/lib/time";
import type { OptionContract } from "@/server/providers/types";
import { DAY, NOW, contract, largeChain, symmetricChain } from "@/test/chain";
import {
  MAX_PAIN_WINDOW_PCT,
  aggregateByStrike,
  aggregateByStrikeExpiry,
  computeExpectedMove,
  computeGexCore,
  computeGexSplit,
  computeMaxPain,
  computeZeroGamma,
  contractGex,
  filterContracts,
  findWalls,
} from "./index";

const MULT = 100;
const T30 = 30 / 365;

describe("contractGex — convention et formule", () => {
  it("vaut Γ × OI × multiplicateur × S² × 0,01 pour un call ATM", () => {
    const spot = 100;
    const c = contract({ type: "call", strike: 100, oi: 10, iv: 0.2 });
    // référence reconstruite depuis la définition
    const gammaRef = normPdf(0.5 * 0.2 * Math.sqrt(T30)) / (spot * 0.2 * Math.sqrt(T30));
    const expected = gammaRef * 10 * MULT * spot * spot * 0.01;
    expect(contractGex(c, spot, MULT, NOW)).toBeCloseTo(expected, 6);
    // garde-fou indépendant : Γ ≈ 0,0695485 calculé à la main sur la même donnée
    expect(contractGex(c, spot, MULT, NOW)).toBeCloseTo(6954.85, 1);
  });

  it("les calls sont positifs, les puts négatifs (convention dealers vendeurs)", () => {
    const call = contract({ type: "call", strike: 100, oi: 10 });
    const put = contract({ type: "put", strike: 100, oi: 10 });
    expect(contractGex(call, 100, MULT, NOW)).toBeGreaterThan(0);
    expect(contractGex(put, 100, MULT, NOW)).toBeLessThan(0);
    expect(contractGex(call, 100, MULT, NOW)).toBeCloseTo(
      -contractGex(put, 100, MULT, NOW),
      9,
    );
  });

  it("est linéaire en open interest et en multiplicateur", () => {
    const base = contract({ type: "call", strike: 100, oi: 10 });
    const double = contract({ type: "call", strike: 100, oi: 20 });
    expect(contractGex(double, 100, MULT, NOW)).toBeCloseTo(
      2 * contractGex(base, 100, MULT, NOW),
      9,
    );
    expect(contractGex(base, 100, 1, NOW)).toBeCloseTo(
      contractGex(base, 100, MULT, NOW) / MULT,
      9,
    );
  });

  it("utilise le gamma fourni par la source quand il existe (CBOE)", () => {
    const c = contract({ type: "call", strike: 100, oi: 10, gamma: 0.02, iv: 0.9 });
    // 0,02 × 10 × 100 × 100² × 0,01 = 2000, l'IV est ignorée
    expect(contractGex(c, 100, MULT, NOW)).toBeCloseTo(2000, 9);
  });

  it("ne produit ni NaN ni Infinity sur un 0DTE (plancher de temps)", () => {
    const c = contract({
      type: "call",
      strike: 100,
      oi: 10,
      expiry: NOW + 3 * 3_600_000,
    });
    const gex = contractGex(c, 100, MULT, NOW);
    expect(Number.isFinite(gex)).toBe(true);
    expect(gex).toBeGreaterThan(0);
    // une option très en dehors de la monnaie reste quasi nulle
    const far = contract({
      type: "call",
      strike: 400,
      oi: 10,
      expiry: NOW + 3 * 3_600_000,
    });
    expect(Math.abs(contractGex(far, 100, MULT, NOW))).toBeLessThan(10);
  });
});

describe("filterContracts — périmètre des échéances", () => {
  const chain = symmetricChain(
    [
      { strike: 100, callOi: 10, putOi: 10, expiry: NOW + 4 * 3_600_000 }, // 0DTE
      { strike: 100, callOi: 10, putOi: 10, expiry: NOW + 5 * DAY },
      { strike: 100, callOi: 10, putOi: 10, expiry: NOW + 20 * DAY },
      { strike: 100, callOi: 10, putOi: 10, expiry: NOW + 60 * DAY },
    ],
    {},
  );

  const expiriesOf = (filter: Parameters<typeof filterContracts>[1]) =>
    [...new Set(filterContracts(chain, filter, NOW).map((c) => c.expiry))].sort(
      (a, b) => a - b,
    );

  it("0DTE ne retient que l'échéance du jour", () => {
    expect(expiriesOf("0DTE")).toEqual([NOW + 4 * 3_600_000]);
  });

  it("1DTE retient la deuxième échéance listée", () => {
    expect(expiriesOf("1DTE")).toEqual([NOW + 5 * DAY]);
  });

  it("0DTE / 1DTE suivent les deux premières échéances listées, pas le calendrier", () => {
    // Vendredi soir : l'échéance du jour est passée, la suivante est lundi.
    const weekend = symmetricChain([
      { strike: 100, callOi: 10, putOi: 10, expiry: NOW - 2 * 3_600_000 },
      { strike: 100, callOi: 10, putOi: 10, expiry: NOW + 60 * 3_600_000 },
      { strike: 100, callOi: 10, putOi: 10, expiry: NOW + 84 * 3_600_000 },
    ]);
    const of = (filter: Parameters<typeof filterContracts>[1]) =>
      [...new Set(filterContracts(weekend, filter, NOW).map((c) => c.expiry))].sort(
        (a, b) => a - b,
      );
    expect(of("0DTE")).toEqual([NOW + 60 * 3_600_000]);
    expect(of("1DTE")).toEqual([NOW + 84 * 3_600_000]);
  });

  it("1DTE est vide quand la chaîne ne liste qu'une échéance", () => {
    const only = symmetricChain([
      { strike: 100, callOi: 10, putOi: 10, expiry: NOW + 4 * 3_600_000 },
    ]);
    expect(filterContracts(only, "1DTE", NOW)).toHaveLength(0);
  });

  it("écarte une échéance expirée dans la journée (08:00 UTC passé)", () => {
    const justExpired = contract({
      type: "call",
      strike: 100,
      expiry: NOW - 3 * 3_600_000,
      oi: 100,
    });
    expect(filterContracts([justExpired], "ALL", NOW)).toHaveLength(0);
  });

  it("≤ 7 j et ≤ 35 j incluent les échéances plus proches", () => {
    expect(expiriesOf("7D")).toEqual([NOW + 4 * 3_600_000, NOW + 5 * DAY]);
    expect(expiriesOf("35D")).toEqual([
      NOW + 4 * 3_600_000,
      NOW + 5 * DAY,
      NOW + 20 * DAY,
    ]);
  });

  it("ALL garde toutes les échéances non expirées", () => {
    expect(expiriesOf("ALL")).toHaveLength(4);
  });

  it("écarte les échéances passées et les OI nuls", () => {
    const withExpired = [
      ...chain,
      contract({ type: "call", strike: 100, expiry: NOW - DAY, oi: 100 }),
      contract({ type: "call", strike: 100, expiry: NOW + DAY, oi: 0 }),
    ];
    const kept = filterContracts(withExpired, "ALL", NOW);
    expect(kept.some((c) => c.expiry < nyMidnightUtc(NOW))).toBe(false);
    expect(kept.every((c) => c.oi > 0)).toBe(true);
  });
});

describe("aggregateByStrike / net GEX", () => {
  it("agrège par strike et trie par strike croissant", () => {
    const chain = symmetricChain([
      { strike: 110, callOi: 100 },
      { strike: 100, callOi: 10, putOi: 5 },
      { strike: 90, putOi: 50 },
    ]);
    const rows = aggregateByStrike(chain, 100, MULT, NOW);
    expect(rows.map((r) => r.strike)).toEqual([90, 100, 110]);
    const atm = rows[1];
    expect(atm.callGex).toBeCloseTo(6954.85, 1);
    expect(atm.putGex).toBeCloseTo(-3477.42, 1);
    expect(atm.netGex).toBeCloseTo(atm.callGex + atm.putGex, 9);
    expect(rows[0].callGex).toBe(0); // aucun call à 90
    expect(rows[2].putGex).toBe(0);
  });

  it("le Net GEX de la chaîne ATM (call 10 / put 5) vaut 3 477,42 $ par +1 %", () => {
    const chain = symmetricChain([{ strike: 100, callOi: 10, putOi: 5 }]);
    const core = computeGexCore(chain, {
      spot: 100,
      multiplier: MULT,
      filter: "ALL",
      now: NOW,
    });
    expect(core.netGex).toBeCloseTo(3477.42, 1);
    expect(core.regime).toBe("long");
  });
});

describe("findWalls — murs dans la fenêtre ± 15 %", () => {
  it("ignore les strikes lointains à fort OI", () => {
    const chain = symmetricChain([
      { strike: 60, putOi: 100_000 }, // hors fenêtre
      { strike: 90, putOi: 500 },
      { strike: 100, callOi: 20, putOi: 20 },
      { strike: 110, callOi: 1_000 },
      { strike: 130, callOi: 100_000 }, // hors fenêtre
    ]);
    const rows = aggregateByStrike(chain, 100, MULT, NOW);
    const walls = findWalls(rows, 100);
    expect(walls.callWall?.strike).toBe(110);
    expect(walls.putWall?.strike).toBe(90);
    expect(walls.maxGamma?.strike).toBe(110);
  });

  it("renvoie null quand il n'y a ni call ni put dans la fenêtre", () => {
    const chain = symmetricChain([
      { strike: 40, callOi: 100, putOi: 100 },
      { strike: 160, callOi: 100, putOi: 100 },
    ]);
    const walls = findWalls(aggregateByStrike(chain, 100, MULT, NOW), 100);
    expect(walls.callWall).toBeNull();
    expect(walls.putWall).toBeNull();
  });
});

describe("findWalls — côté et seconds murs", () => {
  const rows = (chain: OptionContract[]) => aggregateByStrike(chain, 100, MULT, NOW);

  it("publie deux murs par côté, le rang 1 d'abord", () => {
    const chain = symmetricChain([
      { strike: 90, putOi: 20000 },
      { strike: 98, putOi: 700 },
      { strike: 100, callOi: 20, putOi: 20 },
      { strike: 102, callOi: 300 },
      { strike: 110, callOi: 8_000 },
    ]);
    const walls = findWalls(rows(chain), 100);
    expect(walls.callWalls.map((w) => w.strike)).toEqual([110, 102]);
    expect(walls.putWalls.map((w) => w.strike)).toEqual([90, 98]);
    expect(walls.callWall).toBe(walls.callWalls[0]);
  });

  it("écarte un call sous le spot et un put au-dessus (filtre de côté)", () => {
    const chain = symmetricChain([
      { strike: 90, callOi: 5_000 }, // call très chargé mais déjà franchi
      { strike: 105, callOi: 100 },
      { strike: 95, putOi: 100 },
      { strike: 110, putOi: 5_000 }, // put au-dessus du spot
    ]);
    const walls = findWalls(rows(chain), 100);
    expect(walls.callWall?.strike).toBe(105);
    expect(walls.putWall?.strike).toBe(95);
  });

  it("garde le second mur dans la bande des 2 %", () => {
    const chain = symmetricChain([
      { strike: 101, callOi: 300 },
      { strike: 100, callOi: 20 },
      { strike: 114, callOi: 20_000 }, // rang 1, hors bande serrée
    ]);
    const walls = findWalls(rows(chain), 100);
    expect(walls.callWalls.map((w) => w.strike)).toEqual([114, 101]);
  });

  it("expose les rangs 2 dans le core, après les niveaux principaux", () => {
    const chain = symmetricChain([
      { strike: 90, putOi: 20000 },
      { strike: 98, putOi: 700 },
      { strike: 102, callOi: 300 },
      { strike: 110, callOi: 8_000 },
    ]);
    const core = computeGexCore(chain, {
      spot: 100,
      multiplier: MULT,
      filter: "ALL",
      now: NOW,
    });
    const calls = core.levels.filter((l) => l.kind === "callWall");
    const puts = core.levels.filter((l) => l.kind === "putWall");
    expect(calls.map((l) => [l.rank, l.price])).toEqual([
      [1, 110],
      [2, 102],
    ]);
    expect(puts.map((l) => [l.rank, l.price])).toEqual([
      [1, 90],
      [2, 98],
    ]);
    // Le rang 1 reste le premier trouvé : les cartes du panneau ne changent pas.
    expect(core.levels.find((l) => l.kind === "callWall")?.price).toBe(110);
  });
});

describe("computeZeroGamma — flip du Net GEX", () => {
  /** Courbe de référence indépendante, évaluée avec le gamma analytique. */
  function referenceCurve(
    chain: readonly OptionContract[],
    multiplier: number,
    now: number,
  ) {
    return (S: number) =>
      chain.reduce((acc, c) => {
        const T = Math.max((c.expiry - now) / DAY, 1 / 24) / 365;
        const sign = c.type === "call" ? 1 : -1;
        const iv = c.iv ?? 0.2;
        return (
          acc + sign * c.oi * multiplier * bsGamma(S, c.strike, T, iv) * S * S * 0.01
        );
      }, 0);
  }

  it("trouve le passage par zéro entre un put wall bas et un call wall haut", () => {
    const chain = symmetricChain([
      { strike: 90, putOi: 400, callOi: 5 },
      { strike: 100, callOi: 50, putOi: 50 },
      { strike: 110, callOi: 400, putOi: 5 },
    ]);
    const flip = computeZeroGamma(chain, 100, MULT, NOW);
    expect(flip).not.toBeNull();
    expect(flip!).toBeGreaterThan(90);
    expect(flip!).toBeLessThan(110);

    // la courbe indépendante change bien de signe de part et d'autre
    const curve = referenceCurve(chain, MULT, NOW);
    expect(curve(flip! - 1)).toBeLessThan(0);
    expect(curve(flip! + 1)).toBeGreaterThan(0);

    // précision : à moins de 0,5 point de la racine trouvée par bissection
    let lo = 90;
    let hi = 110;
    for (let i = 0; i < 60; i++) {
      const mid = (lo + hi) / 2;
      if (curve(mid) < 0) lo = mid;
      else hi = mid;
    }
    expect(flip!).toBeCloseTo((lo + hi) / 2, 0);
    expect(Math.abs(flip! - (lo + hi) / 2)).toBeLessThan(0.5);
  });

  it("choisit le zéro le plus proche du spot quand la courbe en a deux", () => {
    const chain = symmetricChain([
      { strike: 80, putOi: 2_000, callOi: 10 },
      { strike: 100, callOi: 800, putOi: 10 },
      { strike: 110, putOi: 300, callOi: 10 },
    ]);
    const curve = referenceCurve(chain, MULT, NOW);

    // Tous les zéros de la courbe, sur la même grille que le calcul.
    const zeros: number[] = [];
    let prevSpot = 90;
    let prevValue = curve(prevSpot);
    for (let s = 90.25; s <= 110; s += 0.25) {
      const value = curve(s);
      if ((prevValue < 0 && value > 0) || (prevValue > 0 && value < 0)) {
        const ratio = Math.abs(prevValue) / (Math.abs(prevValue) + Math.abs(value));
        zeros.push(prevSpot + ratio * (s - prevSpot));
      }
      prevSpot = s;
      prevValue = value;
    }
    expect(zeros.length).toBeGreaterThan(1);

    const nearest = zeros.reduce((a, b) =>
      Math.abs(b - 100) < Math.abs(a - 100) ? b : a,
    );
    const flip = computeZeroGamma(chain, 100, MULT, NOW);
    expect(flip).not.toBeNull();
    expect(Math.abs(flip! - nearest)).toBeLessThan(0.5);
    // … et ce n'est pas le premier croisement depuis le bas.
    expect(Math.abs(flip! - Math.min(...zeros))).toBeGreaterThan(0.5);
  });

  it("renvoie null quand il n'y a pas de flip (chaîne 100 % calls)", () => {
    const chain = symmetricChain([
      { strike: 95, callOi: 100 },
      { strike: 100, callOi: 500 },
      { strike: 105, callOi: 100 },
    ]).filter((c) => c.type === "call");
    expect(computeZeroGamma(chain, 100, MULT, NOW)).toBeNull();
    const core = computeGexCore(chain, {
      spot: 100,
      multiplier: MULT,
      filter: "ALL",
      now: NOW,
    });
    expect(core.zeroGamma).toBeNull();
    // sans flip, le régime retombe sur le signe du Net GEX
    expect(core.regime).toBe("long");
  });

  it("reste défini sur une chaîne 0DTE (pas de division par zéro)", () => {
    const chain = symmetricChain(
      [
        { strike: 95, putOi: 300, callOi: 20 },
        { strike: 100, callOi: 100, putOi: 100 },
        { strike: 105, callOi: 300, putOi: 20 },
      ],
      { expiry: NOW + 4 * 3_600_000 },
    );
    const flip = computeZeroGamma(chain, 100, MULT, NOW);
    expect(flip === null || Number.isFinite(flip)).toBe(true);
    const core = computeGexCore(chain, {
      spot: 100,
      multiplier: MULT,
      filter: "0DTE",
      now: NOW,
    });
    expect(Number.isFinite(core.netGex)).toBe(true);
    expect(core.contracts).toBe(6);
  });
});

describe("computeExpectedMove — 1σ journalier", () => {
  it("vaut spot × IV ATM × √(1/365)", () => {
    const chain = symmetricChain([
      {
        strike: 95,
        callOi: 10,
        putOi: 10,
        callIv: 0.3,
        putIv: 0.3,
        expiry: NOW + 7 * DAY,
      },
      {
        strike: 100,
        callOi: 10,
        putOi: 10,
        callIv: 0.25,
        putIv: 0.15,
        expiry: NOW + 7 * DAY,
      },
      {
        strike: 100,
        callOi: 10,
        putOi: 10,
        callIv: 0.5,
        putIv: 0.5,
        expiry: NOW + 30 * DAY,
      },
    ]);
    const em = computeExpectedMove(chain, 100, NOW);
    expect(em).not.toBeNull();
    expect(em!.atmIv).toBeCloseTo(0.2, 9); // moyenne du call 25 % et du put 15 %
    const expected = 100 * 0.2 * Math.sqrt(1 / 365);
    expect(em!.points).toBeCloseTo(expected, 9);
    expect(em!.pct).toBeCloseTo((expected / 100) * 100, 9);
  });

  it("renvoie null sans échéance exploitable", () => {
    expect(computeExpectedMove([], 100, NOW)).toBeNull();
  });
});

describe("computeGexCore — niveaux et cohérence", () => {
  const chain = symmetricChain([
    { strike: 90, putOi: 400, callOi: 5 },
    { strike: 100, callOi: 50, putOi: 50 },
    { strike: 110, callOi: 400, putOi: 5 },
  ]);

  it("expose les trois niveaux principaux et un net GEX fini", () => {
    const core = computeGexCore(chain, {
      spot: 100,
      multiplier: MULT,
      filter: "ALL",
      now: NOW,
    });
    const kinds = core.levels.map((l) => l.kind);
    expect(kinds).toContain("callWall");
    expect(kinds).toContain("putWall");
    expect(kinds).toContain("zeroGamma");
    expect(core.levels.find((l) => l.kind === "callWall")?.price).toBe(110);
    expect(core.levels.find((l) => l.kind === "putWall")?.price).toBe(90);
    expect(Number.isFinite(core.netGex)).toBe(true);
    expect(core.contracts).toBe(6);
    expect(core.totalOi).toBe(910);
    expect(core.regime).toBe(
      core.zeroGamma !== null && 100 >= core.zeroGamma ? "long" : "short",
    );
  });

  it("calcule la distance en % des niveaux au spot", () => {
    const core = computeGexCore(chain, {
      spot: 100,
      multiplier: MULT,
      filter: "ALL",
      now: NOW,
    });
    const callWall = core.levels.find((l) => l.kind === "callWall")!;
    expect(callWall.distancePct).toBeCloseTo(10, 9);
  });

  it("ne modifie pas la chaîne reçue", () => {
    const snapshot = JSON.stringify(chain);
    computeGexCore(chain, { spot: 100, multiplier: MULT, filter: "ALL", now: NOW });
    expect(JSON.stringify(chain)).toBe(snapshot);
  });
});

describe("tenue à l'échelle", () => {
  it("traite une chaîne de ~26 000 contrats en un temps borné", () => {
    const chain = largeChain();
    expect(chain.length).toBeGreaterThan(20_000);
    const run = () =>
      computeGexCore(chain, {
        spot: 7600,
        multiplier: MULT,
        filter: "ALL",
        now: NOW,
      });
    const core = run();
    expect(Number.isFinite(core.netGex)).toBe(true);
    expect(core.byStrike.length).toBeGreaterThan(100);
    expect(core.zeroGamma === null || Number.isFinite(core.zeroGamma)).toBe(true);

    // Meilleur de trois passes : la suite tourne en parallèle, et une mesure
    // unique à 500 ms chronométrait la charge du runner autant que le calcul
    // (échec intermittent observé sur une exécution complète, vert en isolé).
    // Le seuil reste large mais attrape une régression d'ordre de grandeur.
    let best = Number.POSITIVE_INFINITY;
    for (let pass = 0; pass < 3; pass += 1) {
      const start = performance.now();
      run();
      best = Math.min(best, performance.now() - start);
    }
    expect(best).toBeLessThan(900);
  });
});

describe("computeMaxPain — barycentre de paiement", () => {
  const spot = 100;
  const rows = (chain: OptionContract[]) => aggregateByStrike(chain, spot, MULT, NOW);

  it("choisit le strike équilibré entre appels et puts", () => {
    // OI concentré : 100 calls à 90, 50/50 à 100, 100 puts à 110.
    const chain = symmetricChain([
      { strike: 90, callOi: 100 },
      { strike: 100, callOi: 50, putOi: 50 },
      { strike: 110, putOi: 100 },
    ]);
    expect(computeMaxPain(rows(chain), spot)).toBe(100);
  });

  it("à paiement égal, retient le strike le plus proche du spot", () => {
    const chain = symmetricChain([
      { strike: 96, callOi: 10, putOi: 10 },
      { strike: 105, callOi: 10, putOi: 10 },
    ]);
    // paiement identique (90) sur les deux strikes → 96 est plus proche de 100
    expect(computeMaxPain(rows(chain), spot)).toBe(96);
  });

  it("ignore les strikes hors de la fenêtre ±15 %", () => {
    const chain = symmetricChain([
      { strike: 100, callOi: 1, putOi: 1 },
      { strike: 130, callOi: 5000, putOi: 5000 },
    ]);
    const window = MAX_PAIN_WINDOW_PCT * 100;
    expect(window).toBe(15);
    expect(computeMaxPain(rows(chain), spot)).toBe(100);
    // Sans fenêtre, le strike lointain dominerait le paiement.
    expect(computeMaxPain(rows(chain), spot, 1)).toBe(130);
  });
});

describe("computeGexSplit — masse positive / négative", () => {
  it("sépare les strikes amortisseurs des amplificateurs", () => {
    const split = computeGexSplit([
      { strike: 100, callGex: 100, putGex: 0, netGex: 100, netDex: 0, oi: 0, volume: 0, callOi: 0, putOi: 0 },
      { strike: 105, callGex: 50, putGex: 0, netGex: 50, netDex: 0, oi: 0, volume: 0, callOi: 0, putOi: 0 },
      { strike: 95, callGex: 0, putGex: -30, netGex: -30, netDex: 0, oi: 0, volume: 0, callOi: 0, putOi: 0 },
    ]);
    expect(split.positive).toBe(150);
    expect(split.negative).toBe(-30);
    expect(split.positiveShare).toBeCloseTo(150 / 180, 9);
  });

  it("renvoie null quand la masse totale est nulle", () => {
    expect(computeGexSplit([]).positiveShare).toBeNull();
  });
});

describe("aggregateByStrikeExpiry — matrice strike × échéance", () => {
  const spot = 100;
  const near = NOW + 7 * DAY;
  const far = NOW + 30 * DAY;

  it("aligne les cellules sur les échéances triées", () => {
    const chain = [
      ...symmetricChain([{ strike: 98, callOi: 10 }], { expiry: far }),
      ...symmetricChain([{ strike: 102, callOi: 10 }], { expiry: near }),
    ];
    const matrix = aggregateByStrikeExpiry(chain, spot, MULT, NOW);
    expect(matrix.expiries).toEqual([near, far]);
    expect(matrix.rows.map((row) => row.strike)).toEqual([98, 102]);

    const call98 = contractGex(chain[0], spot, MULT, NOW);
    const call102 = contractGex(chain[2], spot, MULT, NOW);
    // strike 98 : positif sur l'échéance lointaine seulement
    expect(matrix.rows[0].cells).toEqual([0, call98]);
    // strike 102 : positif sur l'échéance proche seulement
    expect(matrix.rows[1].cells).toEqual([call102, 0]);
    expect(matrix.totals[0]).toBeCloseTo(call102, 6);
    expect(matrix.totals[1]).toBeCloseTo(call98, 6);
    expect(matrix.rows[0].net).toBeCloseTo(call98, 6);
    expect(matrix.peak).toBeCloseTo(Math.max(Math.abs(call98), Math.abs(call102)), 6);
  });

  it("écarte les strikes hors de la fenêtre et les échéances expirées", () => {
    const chain = [
      ...symmetricChain([{ strike: 100, callOi: 5 }], { expiry: near }),
      ...symmetricChain([{ strike: 140, callOi: 5 }], { expiry: near }),
      ...symmetricChain([{ strike: 100, callOi: 5 }], { expiry: nyMidnightUtc(NOW) - DAY }),
    ];
    const matrix = aggregateByStrikeExpiry(chain, spot, MULT, NOW);
    expect(matrix.rows.map((row) => row.strike)).toEqual([100]);
    expect(matrix.expiries).toEqual([near]);
  });

  it("limite le nombre d'échéances et de strikes conservés", () => {
    // Cas réel : chaque échéance porte toute la grille de strikes.
    const strikes = [92, 94, 96, 98, 100, 102, 104];
    const chain: OptionContract[] = [];
    for (let i = 0; i < 6; i++) {
      chain.push(
        ...symmetricChain(
          strikes.map((strike) => ({ strike, callOi: 3 })),
          { expiry: NOW + (i + 1) * 3 * DAY },
        ),
      );
    }
    const matrix = aggregateByStrikeExpiry(chain, spot, MULT, NOW, {
      maxExpiries: 4,
      maxStrikes: 5,
    });
    expect(matrix.expiries).toHaveLength(4);
    expect(matrix.rows).toHaveLength(5);
    // les strikes conservés sont les plus proches du spot (fenêtre ±8 %)
    expect(matrix.rows.map((row) => row.strike)).toEqual([96, 98, 100, 102, 104]);
  });

  it("est vide sans contrat exploitable", () => {
    const matrix = aggregateByStrikeExpiry([], spot, MULT, NOW);
    expect(matrix.rows).toEqual([]);
    expect(matrix.totals).toEqual([]);
  });
});
