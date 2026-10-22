import { describe, expect, it } from "vitest";
import type { GexLevel, GexLevelKind, GexSnapshot } from "./types";
import { narrate } from "./narrator";

const PROVENANCE = {
  source: "Test",
  provider: "test",
  asOf: 0,
  fetchedAt: 0,
  delayMs: 0,
  derived: true,
  stale: false,
  demo: true,
};

function level(kind: GexLevelKind, price: number, spot: number): GexLevel {
  return { kind, price, gex: 0, distancePct: spot ? (price / spot - 1) * 100 : 0 };
}

function snapshot(over: Partial<GexSnapshot> = {}): GexSnapshot {
  const spot = over.spot ?? 83_500;
  return {
    assetId: "BTC",
    symbol: "BTC",
    filter: "ALL",
    spot,
    netGex: 100e6,
    netDex: 0,
    grossGex: 250e6,
    positiveGex: 150e6,
    negativeGex: -50e6,
    maxPain: 80_000,
    regime: "long",
    zeroGamma: 80_000,
    levels: [
      level("callWall", 88_000, spot),
      level("putWall", 80_000, spot),
      level("zeroGamma", 80_000, spot),
      level("maxPain", 80_000, spot),
      level("maxGamma", 84_000, spot),
    ],
    byStrike: [],
    sessionLevels: [],
    sessionProfile: [],
    frontExpiries: [],
    expectedMove: null,
    expiries: [],
    contracts: 0,
    totalOi: 0,
    provenance: PROVENANCE,
    ...over,
  };
}

const ids = (read: ReturnType<typeof narrate>) => read.lines.map((line) => line.id);
const text = (read: ReturnType<typeof narrate>) =>
  read.lines.map((line) => line.text).join(" | ");

describe("narrate — lecture déterministe", () => {
  it("lit un long gamma et le corridor des murs", () => {
    const read = narrate(snapshot());
    expect(read.tone).toBe("long");
    expect(ids(read)).toEqual(["regime", "corridor", "pain"]);
    expect(text(read)).toContain("Long gamma");
    expect(text(read)).toContain("amortit");
    expect(text(read)).toContain("+4.37 %");
    expect(text(read)).toContain("4.19 %");
    expect(text(read)).toContain("80,000.00");
    expect(text(read)).toContain("88,000.00");
  });

  it("bascule en short gamma sous le flip et parle d’amplification", () => {
    const read = narrate(snapshot({ spot: 79_000 }));
    expect(read.tone).toBe("short");
    expect(text(read)).toContain("Short gamma");
    expect(text(read)).toContain("amplifie");
    expect(text(read)).toContain("-1.25 %");
  });

  it("signale la zone de friction quand un mur est à moins de 0,5 %", () => {
    const spot = 83_500;
    const read = narrate(
      snapshot({
        spot,
        levels: [level("callWall", 83_800, spot), level("putWall", 78_000, spot)],
      }),
    );
    expect(ids(read)).toContain("corridor");
    expect(text(read)).toContain("zone de friction");
    expect(text(read)).toContain("0.36 %");
  });

  it("compare le mouvement attendu aux murs", () => {
    const breach = narrate(
      snapshot({ expectedMove: { points: 5_000, pct: 5.99, atmIv: 0.4 } }),
    );
    expect(ids(breach)).toEqual(["regime", "corridor", "stretch"]);
    expect(text(breach)).toContain("atteint déjà");
    expect(text(breach)).toContain("88,000.00");

    const inside = narrate(
      snapshot({ expectedMove: { points: 400, pct: 0.48, atmIv: 0.4 } }),
    );
    expect(text(inside)).toContain("reste à l’intérieur du corridor");
  });

  it("assume l’absence de flip sans invention", () => {
    const read = narrate(snapshot({ zeroGamma: null }));
    expect(read.tone).toBe("neutral");
    expect(text(read)).toContain("Flip indisponible");
  });

  it("retombe sur le max pain quand le mouvement attendu manque", () => {
    const read = narrate(snapshot({ expectedMove: null }));
    expect(ids(read)).toEqual(["regime", "corridor", "pain"]);
    expect(text(read)).toContain("Max pain");
    expect(text(read)).toContain("pas une prévision");
  });
});
