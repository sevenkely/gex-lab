import { describe, expect, it } from "vitest";
import { bsGamma, normPdf } from "@/lib/black-scholes";
import { nyMidnightUtc } from "@/lib/time";
import type { OptionContract } from "@/server/providers/types";
import { DAY, NOW, contract, largeChain, symmetricChain } from "@/test/chain";
import {
  aggregateByStrike,
  computeExpectedMove,
  computeGexCore,
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
  it("traite une chaîne de ~26 000 contrats en moins de 500 ms", () => {
    const chain = largeChain();
    expect(chain.length).toBeGreaterThan(20_000);
    const start = performance.now();
    const core = computeGexCore(chain, {
      spot: 7600,
      multiplier: MULT,
      filter: "ALL",
      now: NOW,
    });
    const elapsed = performance.now() - start;
    expect(Number.isFinite(core.netGex)).toBe(true);
    expect(core.byStrike.length).toBeGreaterThan(100);
    expect(core.zeroGamma === null || Number.isFinite(core.zeroGamma)).toBe(true);
    expect(elapsed).toBeLessThan(500);
  });
});
