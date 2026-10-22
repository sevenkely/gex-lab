import { describe, expect, it } from "vitest";
import type { Candle } from "@/server/providers/types";
import {
  buildSessionProfile,
  computeSessionLevels,
  niceStep,
  previousSession,
} from "./session-levels";

/** 20 octobre 2026, 9:30 EDT = 13:30 UTC ; 16:00 EDT = 20:00 UTC. */
const DAY = Date.UTC(2026, 9, 20, 13, 30);

function bar(minutesFromOpen: number, open: number, close: number, volume = 100): Candle {
  const high = Math.max(open, close) + 0.5;
  const low = Math.min(open, close) - 0.5;
  return {
    time: Math.floor((DAY + minutesFromOpen * 60_000) / 1000),
    open,
    high,
    low,
    close,
    volume,
  };
}

/** Bougie plate : le volume tombe dans un seul bucket, POC sans ambiguïté. */
function flatBar(minutesFromOpen: number, price: number, volume: number): Candle {
  return {
    time: Math.floor((DAY + minutesFromOpen * 60_000) / 1000),
    open: price,
    high: price,
    low: price,
    close: price,
    volume,
  };
}

const SESSION = [
  bar(0, 100, 101, 100),
  bar(5, 101, 102, 300), // POC autour de 101–102
  bar(10, 102, 100, 100),
  bar(330, 100, 100.5, 50), // 15:00 NY
];

describe("previousSession", () => {
  it("retient la dernière séance RTH terminée, pas celle du jour en cours", () => {
    const yesterday = SESSION.map((candle) => ({
      ...candle,
      time: candle.time - 86_400,
    }));
    const todayMorning = bar(0, 105, 106);
    const now = DAY + 2 * 3_600_000; // 11:30 NY, séance du jour en cours
    const rows = previousSession([...yesterday, todayMorning], now);
    expect(rows).toHaveLength(yesterday.length);
    expect(rows[0].time).toBe(yesterday[0].time);
  });

  it("retient la séance du jour une fois la clôture passée", () => {
    const now = DAY + 7 * 3_600_000; // 16:30 NY
    const rows = previousSession(SESSION, now);
    expect(rows).toHaveLength(SESSION.length);
  });
});

describe("buildSessionProfile", () => {
  it("place le POC sur le prix le plus échangé et la value area autour", () => {
    const concentrated = [
      flatBar(0, 100, 100),
      flatBar(5, 101, 900),
      flatBar(10, 102, 100),
      flatBar(15, 100, 100),
    ];
    const { levels } = buildSessionProfile(concentrated, { step: 1 });
    const poc = levels.find((level) => level.kind === "pPOC")!;
    const vah = levels.find((level) => level.kind === "pVAH")!;
    const val = levels.find((level) => level.kind === "pVAL")!;
    expect(poc.price).toBeCloseTo(101.5, 6);
    expect(vah.price).toBeGreaterThanOrEqual(poc.price);
    expect(val.price).toBeLessThanOrEqual(poc.price);
  });

  it("expose les extrêmes de la séance (pLO / pHI)", () => {
    const { levels } = buildSessionProfile(SESSION, { step: 1 });
    const low = levels.find((level) => level.kind === "pLO")!;
    const high = levels.find((level) => level.kind === "pHI")!;
    expect(low.price).toBeCloseTo(Math.min(...SESSION.map((c) => c.low)), 6);
    expect(high.price).toBeCloseTo(Math.max(...SESSION.map((c) => c.high)), 6);
  });

  it("renvoie un profil vide sans bougie", () => {
    expect(buildSessionProfile([]).levels).toEqual([]);
  });
});

describe("computeSessionLevels", () => {
  it("trie les niveaux du plus haut au plus bas", () => {
    const levels = computeSessionLevels(SESSION, DAY + 7 * 3_600_000);
    const prices = levels.map((level) => level.price);
    expect(prices).toEqual([...prices].sort((a, b) => b - a));
    expect(levels.map((level) => level.kind)).toEqual([
      "pHI",
      "pVAH",
      "pPOC",
      "pVAL",
      "pLO",
    ]);
  });
});

describe("niceStep", () => {
  it("arrondit vers un pas lisible", () => {
    expect(niceStep(0.9)).toBe(1);
    expect(niceStep(1.6)).toBe(2);
    expect(niceStep(4.2)).toBe(5);
    expect(niceStep(26)).toBe(50);
  });
});
