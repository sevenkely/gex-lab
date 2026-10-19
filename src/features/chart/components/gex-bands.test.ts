import { describe, expect, it } from "vitest";
import { EDGE_INSET, MAX_EXTENSION, TOP_INSET, clampLevelsToWindow, pinY } from "./gex-bands";

describe("clampLevelsToWindow", () => {
  it("n'étend pas la plage au-delà du plafond autorisé", () => {
    // SPX 15m : bougies 7 645 → 7 690 (45 points), mur à 8 000 (+310).
    const window = clampLevelsToWindow({ min: 7_645, max: 7_690 }, [8_000, 7_661]);
    expect(window).not.toBeNull();
    // Plafond = haut des bougies + 50 % de leur hauteur = 7 712,5.
    expect(window!.max).toBeCloseTo(7_690 + 45 * MAX_EXTENSION, 6);
    // La plage demandée contient toujours les bougies...
    expect(window!.min).toBeLessThanOrEqual(7_645);
    // ...et les bougies gardent l'essentiel de la hauteur visible.
    const span = window!.max - window!.min;
    expect((7_690 - 7_645) / span).toBeGreaterThan(0.5);
  });

  it("garde les deux côtés quand les murs restent proches", () => {
    const window = clampLevelsToWindow({ min: 82_000, max: 83_000 }, [82_400, 82_800]);
    expect(window).toEqual({ min: 82_000, max: 83_000 });
  });

  it("ramène un plancher lointain sans écraser les bougies", () => {
    // BTC 1H : bougies 82 000 → 82 800 (800 points), put wall à 80 000.
    const window = clampLevelsToWindow({ min: 82_000, max: 82_800 }, [80_000, 90_000]);
    expect(window!.min).toBeCloseTo(82_000 - 800 * MAX_EXTENSION, 6);
    expect(window!.max).toBeCloseTo(82_800 + 800 * MAX_EXTENSION, 6);
  });

  it("gère une séance sans amplitude avec un garde-fou", () => {
    const window = clampLevelsToWindow({ min: 100, max: 100 }, [500]);
    expect(window).not.toBeNull();
    // Hauteur de repli : 0,1 % du prix (0,1) → plafond 100,05.
    expect(window!.max).toBeLessThanOrEqual(100.05 + 1e-9);
    expect(window!.min).toBeLessThanOrEqual(100);
  });

  it("renvoie null sans niveau", () => {
    expect(clampLevelsToWindow({ min: 1, max: 2 }, [])).toBeNull();
  });

  it("sans bougies, garde le comportement d'origine (tous les niveaux)", () => {
    expect(clampLevelsToWindow(null, [90_000, 80_000])).toEqual({ min: 80_000, max: 90_000 });
  });
});

describe("pinY", () => {
  it("épingle sous la légende quand le niveau est au-dessus du champ", () => {
    // La légende et les boutons sont superposés en DOM : le bord haut est dégagé.
    expect(pinY(1, 15, 0, 800)).toBe(TOP_INSET + 15);
    expect(pinY(1, 7, 0, 800)).toBe(TOP_INSET + 7);
  });

  it("épingle près du bord bas quand le niveau est sous le champ", () => {
    expect(pinY(-1, 15, 0, 800)).toBe(800 - (EDGE_INSET + 15));
  });

  it("empile les niveaux du même côté sans les superposer", () => {
    const first = pinY(1, 15, 0, 800);
    const second = pinY(1, 15, 1, 800);
    // 2 × demi-hauteur + place de l'étiquette.
    expect(second - first).toBe(22 + 15 * 2);
  });

  it("reste dans le panneau même avec beaucoup de niveaux empilés", () => {
    for (let stack = 0; stack < 12; stack += 1) {
      // Les deux bords gardent 8 px de garde : la bande épinglée ne sort jamais.
      expect(pinY(1, 15, stack, 300)).toBeLessThanOrEqual(300 - 8);
      expect(pinY(-1, 15, stack, 300)).toBeGreaterThanOrEqual(8);
    }
  });
});
