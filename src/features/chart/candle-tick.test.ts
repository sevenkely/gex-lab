import { describe, expect, it } from "vitest";
import type { Candle } from "@/server/providers/types";
import { applyPriceTick } from "./candle-tick";

/** 19 oct. 2026, 08:07:30 UTC — dans la bougie 5m de 08:05. */
const NOW = Date.UTC(2026, 9, 19, 8, 7, 30);
const BUCKET_0805 = Math.floor(NOW / 300_000) * 300_000;

function candle(over: Partial<Candle> = {}): Candle {
  return {
    time: BUCKET_0805 / 1000,
    open: 82_000,
    high: 82_100,
    low: 81_900,
    close: 82_050,
    volume: 12,
    ...over,
  };
}

describe("applyPriceTick — bougie courante", () => {
  it("met à jour high, low et close sans toucher à l'open ni au volume", () => {
    const rows = [candle()];
    const tick = applyPriceTick(rows, 82_300, "5m", NOW);
    expect(tick.rolled).toBe(false);
    expect(tick.candles).toHaveLength(1);
    expect(tick.candles[0]).toMatchObject({
      time: BUCKET_0805 / 1000,
      open: 82_000,
      high: 82_300,
      low: 81_900,
      close: 82_300,
      volume: 12,
    });
    // L'entrée n'est jamais mutée : le graphique compare les références.
    expect(rows[0].close).toBe(82_050);
  });

  it("abaisse le low quand le prix passe sous la mèche basse", () => {
    const tick = applyPriceTick([candle()], 81_500, "5m", NOW);
    expect(tick.candles[0].low).toBe(81_500);
    expect(tick.candles[0].high).toBe(82_100);
  });

  it("ignore un prix invalide", () => {
    const rows = [candle()];
    expect(applyPriceTick(rows, 0, "5m", NOW).candles).toBe(rows);
    expect(applyPriceTick(rows, Number.NaN, "5m", NOW).candles).toBe(rows);
    expect(applyPriceTick([], 82_000, "5m", NOW).candles).toEqual([]);
  });
});

describe("applyPriceTick — rollover", () => {
  it("ouvre une bougie au franchissement de l'intervalle", () => {
    const rows = [candle()];
    const later = BUCKET_0805 + 300_000 + 12_000; // 08:10:12
    const tick = applyPriceTick(rows, 82_200, "5m", later);
    expect(tick.rolled).toBe(true);
    expect(tick.candles).toHaveLength(2);
    expect(tick.candles[1]).toEqual({
      time: (BUCKET_0805 + 300_000) / 1000,
      open: 82_050,
      high: 82_200,
      low: 82_050,
      close: 82_200,
      volume: 0,
    });
    // L'ancienne bougie reste intacte.
    expect(tick.candles[0]).toEqual(rows[0]);
  });

  it("n'ouvre qu'une bougie même après une longue coupure", () => {
    const rows = [candle({ time: BUCKET_0805 / 1000 - 3_600 })];
    const tick = applyPriceTick(rows, 82_400, "5m", NOW);
    expect(tick.rolled).toBe(true);
    expect(tick.candles).toHaveLength(2);
    expect(tick.candles[1].time).toBe(BUCKET_0805 / 1000);
  });

  it("respecte les autres unités de temps", () => {
    const rows = [candle({ time: Math.floor(NOW / 3_600_000) * 3_600, open: 82_000, close: 82_000 })];
    const tick = applyPriceTick(rows, 82_500, "1H", NOW + 3_600_000);
    expect(tick.rolled).toBe(true);
    expect(tick.candles[1].time).toBe(rows[0].time + 3_600);
  });

  it("ne crée pas de bougie dans le passé si l'horloge est en retard", () => {
    const rows = [candle({ time: (BUCKET_0805 + 600_000) / 1000 })];
    const tick = applyPriceTick(rows, 82_100, "5m", NOW);
    expect(tick.rolled).toBe(false);
    expect(tick.candles[0].close).toBe(82_100);
  });
});
