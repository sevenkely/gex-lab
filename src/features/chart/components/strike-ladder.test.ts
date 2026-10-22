import { describe, expect, it } from "vitest";
import { ladderRows, strikeDecimals } from "./StrikeLadder";
import type { StrikeGex } from "@/features/gex/types";

describe("strikeDecimals", () => {
  it("écrit un strike entier sans décimale", () => {
    expect(strikeDecimals([82_000, 82_500, 83_000], 2)).toBe(0);
  });

  it("garde une décimale quand la grille tombe sur le demi-point", () => {
    // BTC 500 : les strikes restent entiers, mais une grille à .5 existe sur
    // les sous-jacents à pas fin.
    expect(strikeDecimals([7_821.5, 7_816.5, 7_811.5], 2)).toBe(1);
  });

  it("garde deux décimales quand la grille tombe sur le quart de point", () => {
    // ES via proxy SPX : les strikes atterrissent sur .25 / .75.
    expect(strikeDecimals([7_821.75, 7_816.75, 7_811.75], 2)).toBe(2);
  });

  it("ne descend pas sous la précision de l'actif", () => {
    expect(strikeDecimals([0.1234, 0.1236], 1)).toBe(1);
    expect(strikeDecimals([0.1234, 0.1236], 4)).toBe(4);
  });

  it("retombe sur la précision de l'actif quand la grille est vide", () => {
    expect(strikeDecimals([], 2)).toBe(2);
    expect(strikeDecimals([82_000], 2)).toBe(0);
  });
});

describe("ladderRows", () => {
  const row = (strike: number): StrikeGex => ({
    strike,
    callGex: 0,
    putGex: 0,
    netGex: 0,
    netDex: 0,
    oi: 0,
    volume: 0,
    callOi: 0,
    putOi: 0,
  });

  it("garde les strikes les plus proches du spot, du haut vers le bas", () => {
    const rows = [90_000, 88_000, 86_000, 84_000, 82_000, 80_000].map(row);
    const picked = ladderRows(rows, 83_000, 4);
    expect(picked.map((item) => item.strike)).toEqual([86_000, 84_000, 82_000, 80_000]);
  });
});
