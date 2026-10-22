import { describe, expect, it } from "vitest";
import type { Candle } from "@/server/providers/types";
import {
  aggregateBars,
  formatPeriod,
  inferPeriodSeconds,
  mergeBridgeBars,
  parseAtasBar,
  planAggregation,
} from "./atas";

function candle(time: number, price = 100, volume = 0): Candle {
  return { time, open: price, high: price + 1, low: price - 1, close: price, volume };
}

describe("parseAtasBar", () => {
  it("accepte un message complet", () => {
    const bar = parseAtasBar({
      s: "nq",
      t: 1_760_000_040.8,
      o: 20_350,
      h: 20_360,
      l: 20_340,
      c: 20_355,
      v: 1_200,
      p: 60,
      x: true,
    });
    expect(bar).toEqual({
      s: "NQ",
      t: 1_760_000_040,
      o: 20_350,
      h: 20_360,
      l: 20_340,
      c: 20_355,
      v: 1_200,
      p: 60,
      x: true,
    });
  });

  it("rejette un message incomplet ou corrompu", () => {
    expect(parseAtasBar(null)).toBeNull();
    expect(parseAtasBar("NQ")).toBeNull();
    expect(parseAtasBar({ s: "NQ", t: 1, o: 1, h: 1, l: 1 })).toBeNull();
    expect(parseAtasBar({ s: "", t: 1, o: 1, h: 1, l: 1, c: 1 })).toBeNull();
    expect(parseAtasBar({ s: "NQ", t: 0, o: 1, h: 1, l: 1, c: 1 })).toBeNull();
    expect(parseAtasBar({ s: "NQ", t: 1, o: 0, h: 1, l: 1, c: 1 })).toBeNull();
  });

  it("normalise high/low autour de l'open et du close", () => {
    const bar = parseAtasBar({ s: "ES", t: 1, o: 100, h: 99, l: 101, c: 100.5 });
    expect(bar?.h).toBe(101);
    expect(bar?.l).toBe(99);
  });

  it("tolère un volume et une période absents (ancien indicateur)", () => {
    const bar = parseAtasBar({ s: "GC", t: 1, o: 1, h: 1, l: 1, c: 1 });
    expect(bar).not.toBeNull();
    expect(bar?.v).toBeUndefined();
    expect(bar?.p).toBeUndefined();
  });
});

describe("inferPeriodSeconds", () => {
  it("retrouve la période dominante malgré un trou de séance", () => {
    const bars = [0, 60, 300, 360, 420, 86_400].map((time) => candle(time));
    expect(inferPeriodSeconds(bars)).toBe(60);
  });

  it("renvoie null avec moins de deux bougies", () => {
    expect(inferPeriodSeconds([])).toBeNull();
    expect(inferPeriodSeconds([candle(60)])).toBeNull();
  });
});

describe("planAggregation", () => {
  it("applique directement une période identique", () => {
    expect(planAggregation(300, 300)).toEqual({ kind: "direct" });
  });

  it("agrège un pont plus fin quand le rapport est entier", () => {
    expect(planAggregation(60, 300)).toEqual({ kind: "aggregate", from: 60 });
    expect(planAggregation(900, 3_600)).toEqual({ kind: "aggregate", from: 900 });
  });

  it("refuse de découper une bougie plus grossière", () => {
    expect(planAggregation(300, 60)).toEqual({ kind: "mismatch", reason: "coarser" });
  });

  it("refuse d'agréger en journalier (séances non alignées sur UTC)", () => {
    expect(planAggregation(3_600, 86_400)).toEqual({
      kind: "mismatch",
      reason: "session",
    });
  });

  it("refuse un rapport non entier", () => {
    expect(planAggregation(90, 300)).toEqual({ kind: "mismatch", reason: "ratio" });
  });

  it("suppose la même période sans information du pont", () => {
    expect(planAggregation(null, 900)).toEqual({ kind: "direct" });
  });
});

describe("aggregateBars", () => {
  it("construit des bougies 5m à partir de bougies 1m", () => {
    const start = 1_760_000_040 - (1_760_000_040 % 300); // bucket UTC
    const bars: Candle[] = [
      { time: start, open: 100, high: 102, low: 99, close: 101, volume: 10 },
      { time: start + 60, open: 101, high: 105, low: 100, close: 104, volume: 20 },
      { time: start + 120, open: 104, high: 104, low: 97, close: 98, volume: 5 },
      { time: start + 300, open: 98, high: 99, low: 96, close: 97, volume: 7 },
    ];
    const aggregated = aggregateBars(bars, 60, 300);
    expect(aggregated).toEqual([
      { time: start, open: 100, high: 105, low: 97, close: 98, volume: 35 },
      { time: start + 300, open: 98, high: 99, low: 96, close: 97, volume: 7 },
    ]);
  });

  it("renvoie un tableau vide si le rapport est invalide", () => {
    expect(aggregateBars([], 60, 300)).toEqual([]);
    expect(aggregateBars([candle(60)], 0, 300)).toEqual([]);
    expect(aggregateBars([candle(60)], 300, 60)).toEqual([]);
    expect(aggregateBars([candle(60)], 90, 300)).toEqual([]);
  });
});

describe("mergeBridgeBars", () => {
  const base = [candle(60, 100, 50), candle(120, 101, 60), candle(180, 102, 70)];

  it("ne produit aucun travail quand rien n'a changé", () => {
    const merged = mergeBridgeBars(base, [base[2]]);
    expect(merged.candles).toBe(base);
    expect(merged.updated).toBe(0);
  });

  it("met à jour la dernière bougie et signale une correction tardive", () => {
    const live = mergeBridgeBars(base, [{ ...candle(180, 103), high: 104 }]);
    expect(live.candles).toHaveLength(3);
    expect(live.candles[2].close).toBe(103);
    expect(live.updated).toBe(1);
    expect(live.olderCorrections).toBe(0);

    const late = mergeBridgeBars(base, [{ ...candle(120, 103), high: 104 }]);
    expect(late.olderCorrections).toBe(1);
  });

  it("déduplique un snapshot qui chevauche l'historique, le pont gagnant", () => {
    const snapshot = [candle(0, 99), candle(60, 111), candle(120, 112), candle(180, 113)];
    const merged = mergeBridgeBars(base, snapshot);
    expect(merged.candles.map((bar) => bar.time)).toEqual([0, 60, 120, 180]);
    expect(merged.candles[1].open).toBe(111);
    expect(merged.added).toBe(1);
    expect(merged.prepended).toBe(true);
  });

  it("conserve le volume historique si le pont n'en fournit pas", () => {
    const merged = mergeBridgeBars(base, [{ ...candle(180, 103), volume: 0 }]);
    expect(merged.candles[2].volume).toBe(70);
  });

  it("rompt l'identité dès qu'une valeur change", () => {
    const merged = mergeBridgeBars(base, [candle(180, 105, 70)]);
    expect(merged.candles).not.toBe(base);
  });

  it("plafonne en gardant les bougies les plus récentes", () => {
    const many = Array.from({ length: 10 }, (_, index) => candle(index * 60));
    const merged = mergeBridgeBars(many, [candle(600)], 4);
    expect(merged.candles).toHaveLength(4);
    expect(merged.candles[3].time).toBe(600);
  });

  it("accepte un snapshot initial sans historique", () => {
    const merged = mergeBridgeBars([], [candle(60), candle(120)]);
    expect(merged.added).toBe(2);
    expect(merged.prepended).toBe(false);
    expect(merged.candles).toHaveLength(2);
  });
});

describe("formatPeriod", () => {
  it("écrit les périodes connues en clair", () => {
    expect(formatPeriod(60)).toBe("1m");
    expect(formatPeriod(300)).toBe("5m");
    expect(formatPeriod(3_600)).toBe("1H");
    expect(formatPeriod(86_400)).toBe("1D");
    expect(formatPeriod(600)).toBe("10m");
    expect(formatPeriod(null)).toBe("?");
  });
});
