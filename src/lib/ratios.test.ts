import { describe, expect, it } from "vitest";
import {
  RATIO_SKEW_TOLERANCE_MS,
  computeRatio,
  deriveLevels,
  inverseRatio,
  roundToTick,
  tickDecimals,
} from "./ratios";

describe("computeRatio — ratio futures / sous-jacent", () => {
  it("calcule le ratio sur des cotations alignées", () => {
    const result = computeRatio({
      futuresPrice: 29905.5,
      futuresAsOf: 1_000_000,
      underlyingPrice: 27890.2,
      underlyingAsOf: 1_000_100,
    });
    expect(result.ratio).toBeCloseTo(29905.5 / 27890.2, 12);
    expect(result.skewMs).toBe(100);
    expect(result.approximate).toBe(false);
  });

  it("signale un ratio approximatif au-delà de 5 minutes d'écart", () => {
    const result = computeRatio({
      futuresPrice: 4294.6,
      futuresAsOf: 0,
      underlyingPrice: 421.87,
      underlyingAsOf: RATIO_SKEW_TOLERANCE_MS + 1,
    });
    expect(result.approximate).toBe(true);
  });

  it("se protège des prix invalides", () => {
    for (const bad of [0, -1, Number.NaN]) {
      const result = computeRatio({
        futuresPrice: bad,
        futuresAsOf: 0,
        underlyingPrice: 100,
        underlyingAsOf: 0,
      });
      expect(result.ratio).toBe(1);
      expect(result.approximate).toBe(true);
    }
  });
});

describe("deriveLevels — application du ratio et du tick", () => {
  it("met les strikes à l'échelle et arrondit au tick du contrat", () => {
    const levels = [{ kind: "callWall", price: 28000 }];
    const [derived] = deriveLevels(levels, 1.0723, 0.25);
    // 28 000 × 1,0723 = 30 024,4 → arrondi au tick de 0,25 le plus proche
    expect(derived.price).toBeCloseTo(30024.5, 9);
    // multiple exact du tick de 0,25
    expect(Math.round((derived.price / 0.25) * 1e6) / 1e6).toBeCloseTo(
      derived.price / 0.25,
      6,
    );
  });

  it("arrondit au tick de 0,1 pour l'or", () => {
    expect(roundToTick(4218.734, 0.1)).toBeCloseTo(4218.7, 9);
    expect(roundToTick(4218.75, 0.1)).toBeCloseTo(4218.8, 9);
    expect(roundToTick(1234.5, 0)).toBe(1234.5); // tick absent : inchangé
  });

  it("ne modifie pas les niveaux reçus", () => {
    const levels = [{ price: 100 }];
    deriveLevels(levels, 2, 0.5);
    expect(levels[0].price).toBe(100);
  });

  it("tickDecimals déduit les décimales d'affichage du tick", () => {
    expect(tickDecimals(0.25)).toBe(2);
    expect(tickDecimals(0.1)).toBe(1);
    expect(tickDecimals(1)).toBe(0);
    expect(tickDecimals(0)).toBe(2);
  });

  it("inverseRatio est l'inverse de l'application du ratio", () => {
    expect(inverseRatio(30024.5, 1.0723)).toBeCloseTo(28000.09, 1);
  });
});
