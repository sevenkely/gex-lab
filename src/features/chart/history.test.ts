import { describe, expect, it } from "vitest";
import type { Candle } from "@/server/providers/types";
import { mergeOlderCandles } from "./history";

function bar(time: number): Candle {
  return { time, open: 100, high: 101, low: 99, close: 100, volume: 1 };
}

const current = [bar(300), bar(360), bar(420)];

describe("mergeOlderCandles", () => {
  it("préfixe les bougies et ignore le chevauchement", () => {
    const result = mergeOlderCandles(current, [bar(240), bar(300), bar(180)]);
    expect(result.candles.map((row) => row.time)).toEqual([180, 240, 300, 360, 420]);
    expect(result.added).toBe(2);
    expect(result.exhausted).toBe(false);
  });

  it("trie une page reçue en désordre", () => {
    const result = mergeOlderCandles(current, [bar(180), bar(60), bar(120)]);
    expect(result.candles.map((row) => row.time)).toEqual([60, 120, 180, 300, 360, 420]);
  });

  it("signale l'épuisement quand la page est entièrement connue", () => {
    const result = mergeOlderCandles(current, [bar(300), bar(360)]);
    expect(result.added).toBe(0);
    expect(result.exhausted).toBe(true);
    expect(result.candles).toBe(current);
  });

  it("plafonne en gardant les bougies les plus récentes", () => {
    const result = mergeOlderCandles(current, [bar(60), bar(120), bar(180)], 4);
    expect(result.candles.map((row) => row.time)).toEqual([180, 300, 360, 420]);
    expect(result.added).toBe(1);
    expect(result.exhausted).toBe(true);
  });

  it("reste inerte quand le plafond est déjà atteint", () => {
    const full = [bar(60), bar(120), bar(180), bar(240)];
    const result = mergeOlderCandles(full, [bar(10)], 4);
    expect(result.added).toBe(0);
    expect(result.exhausted).toBe(true);
    expect(result.candles).toBe(full);
  });
});
