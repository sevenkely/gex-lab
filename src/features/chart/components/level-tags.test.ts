import { describe, expect, it } from "vitest";
import { stackSlots } from "./LevelTags";

const TOP = 48;
const BOTTOM = 740;

const slot = (y: number, price: number) => ({ y, price, up: false, down: false });

describe("stackSlots", () => {
  it("laisse une pastille seule sur son niveau", () => {
    expect(stackSlots([slot(300, 7_900)], TOP, BOTTOM)).toEqual([300]);
  });

  it("conserve l'ordre des prix quand deux niveaux se touchent", () => {
    // Deux murs à 4 points d'écart : 4 px de séparation seulement.
    const ys = stackSlots([slot(400, 7_800), slot(396, 7_804)], TOP, BOTTOM);
    // Le prix le plus haut reste au-dessus…
    expect(ys[1]).toBeLessThan(ys[0]);
    // …et les deux pastilles ne se chevauchent pas.
    expect(ys[0] - ys[1]).toBeGreaterThanOrEqual(21);
  });

  it("empile sans jamais chevaucher une pile de niveaux serrés", () => {
    const slots = [500, 501, 502, 503, 504, 505].map((y, index) => slot(y, 7_900 - index));
    const ys = stackSlots(slots, TOP, BOTTOM);
    const sorted = [...ys].sort((a, b) => a - b);
    for (let index = 1; index < sorted.length; index++) {
      expect(sorted[index] - sorted[index - 1]).toBeGreaterThanOrEqual(21);
    }
  });

  it("remonte la pile quand elle déborde du bas du panneau", () => {
    const slots = [690, 700, 710, 720, 730].map((y) => slot(y, 7_900));
    const ys = stackSlots(slots, TOP, BOTTOM);
    for (const y of ys) {
      expect(y).toBeLessThanOrEqual(BOTTOM);
      expect(y).toBeGreaterThanOrEqual(TOP);
    }
    // L'ordre initial est conservé après la remontée.
    expect(ys).toEqual([...ys].sort((a, b) => a - b));
  });

  it("ramène une pile trop haute dans le panneau", () => {
    const slots = Array.from({ length: 40 }, () => slot(60, 7_900));
    const ys = stackSlots(slots, TOP, BOTTOM);
    for (const y of ys) {
      expect(y).toBeGreaterThanOrEqual(TOP);
    }
  });

  it("borne une pastille sortie du champ dans le panneau", () => {
    expect(stackSlots([slot(-120, 8_100)], TOP, BOTTOM)).toEqual([TOP]);
    expect(stackSlots([slot(9_000, 7_100)], TOP, BOTTOM)).toEqual([BOTTOM]);
  });
});
