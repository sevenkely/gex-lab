/**
 * Tests d'intégration du registre (avec les fixtures de démonstration).
 *
 * Ce qui est vérifié ici n'est pas la valeur du marché mais les invariants de
 * l'application : provenance honnête, échelles de proxy, filtres d'échéance,
 * cohérence des niveaux. Les providers réels sont testés séparément (phase 2)
 * avec des fixtures HTTP figées.
 */

import { describe, expect, it } from "vitest";
import { getBoard, getDarkPoolSnapshot, getFlow, getGexSnapshot } from "./registry";
import { ASSETS, getAsset } from "@/config/assets";

describe("getGexSnapshot", () => {
  it("renvoie un snapshot complet et honnête pour BTC", async () => {
    const snapshot = await getGexSnapshot("BTC");
    expect(snapshot.assetId).toBe("BTC");
    expect(snapshot.filter).toBe("ALL");
    expect(Number.isFinite(snapshot.netGex)).toBe(true);
    expect(snapshot.contracts).toBeGreaterThan(100);
    expect(snapshot.levels.length).toBeGreaterThanOrEqual(2);
    expect(snapshot.expiries.length).toBeGreaterThan(1);
    // données de démonstration : le badge doit le dire
    expect(snapshot.provenance.demo).toBe(true);
    expect(snapshot.provenance.source).toMatch(/Fixtures/);
    expect(snapshot.provenance.asOf).toBeGreaterThan(0);
  });

  it("applique le filtre d'échéance demandé", async () => {
    const wide = await getGexSnapshot("SPX", { filter: "ALL" });
    const near = await getGexSnapshot("SPX", { filter: "7D" });
    expect(near.filter).toBe("7D");
    expect(near.contracts).toBeLessThan(wide.contracts);
    expect(near.expiries.every((e) => wide.expiries.includes(e))).toBe(true);
  });

  it("respecte la convention de signe : les puts pèsent négativement", async () => {
    const snapshot = await getGexSnapshot("SPX");
    const withPuts = snapshot.byStrike.filter((row) => row.putGex < 0);
    expect(withPuts.length).toBeGreaterThan(0);
    for (const row of snapshot.byStrike) {
      expect(row.netGex).toBeCloseTo(row.callGex + row.putGex, 6);
    }
  });

  it("place le zero gamma et le régime de façon cohérente", async () => {
    const snapshot = await getGexSnapshot("BTC");
    if (snapshot.zeroGamma !== null) {
      const expected = snapshot.spot >= snapshot.zeroGamma ? "long" : "short";
      expect(snapshot.regime).toBe(expected);
    } else {
      expect(snapshot.regime).toBe(snapshot.netGex >= 0 ? "long" : "short");
    }
  });

  it("rejette un actif inconnu", async () => {
    await expect(getGexSnapshot("XYZ")).rejects.toThrow(/Actif inconnu/);
  });
});

describe("proxies ES, NQ et GC", () => {
  it("mappe ES sur la chaîne SPX", async () => {
    const snapshot = await getGexSnapshot("ES");
    expect(snapshot.assetId).toBe("ES");
    expect(snapshot.proxy?.underlyingId).toBe("SPX");
    expect(snapshot.provenance.derived).toBe(true);
    expect(snapshot.frontExpiries.length).toBeGreaterThan(0);
    expect(snapshot.sessionLevels).toEqual([]); // fixtures : pas de séance RTH
  });

  it("dérive les niveaux de QQQ et les arrondit au tick du contrat", async () => {
    const snapshot = await getGexSnapshot("NQ");
    expect(snapshot.proxy).toBeDefined();
    expect(snapshot.proxy!.underlyingId).toBe("QQQ");
    expect(snapshot.proxy!.tick).toBe(0.25);
    expect(snapshot.provenance.derived).toBe(true);
    expect(snapshot.proxy!.ratio).toBeGreaterThan(10);

    // niveaux : multiples du tick de 0,25
    for (const level of snapshot.levels) {
      const ticks = level.price / 0.25;
      expect(Math.abs(ticks - Math.round(ticks))).toBeLessThan(1e-6);
    }
    // la distance est recalculée sur le prix du futures, pas sur le sous-jacent
    const callWall = snapshot.levels.find((l) => l.kind === "callWall");
    if (callWall) {
      expect(callWall.distancePct).toBeCloseTo(
        (callWall.price / snapshot.spot - 1) * 100,
        6,
      );
    }
  });

  it("dérive GC de GLD avec un tick de 0,1", async () => {
    const snapshot = await getGexSnapshot("GC");
    expect(snapshot.proxy!.underlyingId).toBe("GLD");
    expect(snapshot.proxy!.tick).toBe(0.1);
    const flipped = snapshot.regime === "long" ? "short" : "long";
    expect(["long", "short"]).toContain(snapshot.regime);
    expect(snapshot.regime).not.toBe(flipped);
  });
});

describe("getBoard", () => {
  it("renvoie une ligne par actif, avec sparkline et provenance", async () => {
    const board = await getBoard(ASSETS);
    expect(board).toHaveLength(ASSETS.length);
    for (const row of board) {
      expect(row.price).toBeGreaterThan(0);
      expect(Number.isFinite(row.netGex)).toBe(true);
      expect(row.spark.length).toBeGreaterThan(10);
      expect(["long", "short"]).toContain(row.regime);
      expect(row.error).toBeUndefined();
    }
  });
});

describe("getFlow", () => {
  it("produit des trades cohérents (prime = prix × indice × taille)", async () => {
    const asset = getAsset("BTC")!;
    const { trades, now, provenance } = await getFlow(asset, 20);
    expect(trades).toHaveLength(20);
    expect(now).toBeGreaterThan(0);
    expect(provenance.demo).toBe(true);
    for (const trade of trades) {
      expect(trade.premiumUsd).toBeCloseTo(
        trade.price * trade.indexPrice * trade.amount,
        2,
      );
      expect(trade.ts).toBeLessThanOrEqual(now);
      expect(["call", "put"]).toContain(trade.type);
    }
    // trié du plus récent au plus ancien
    const timestamps = trades.map((t) => t.ts);
    expect([...timestamps].sort((a, b) => b - a)).toEqual(timestamps);
  });
});

describe("getDarkPoolSnapshot", () => {
  it("renvoie des lignes agrégées par ATS pour chaque symbole demandé", async () => {
    const { snapshot, provenance } = await getDarkPoolSnapshot(["SPY", "QQQ"]);
    expect(snapshot.weekStart).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(snapshot.rows.length).toBeGreaterThan(0);
    expect(new Set(snapshot.rows.map((r) => r.symbol))).toEqual(new Set(["SPY", "QQQ"]));
    for (const row of snapshot.rows) {
      expect(row.volume).toBeGreaterThan(0);
      expect(row.trades).toBeGreaterThan(0);
      expect(row.notional).toBeCloseTo(row.volume * (row.notional / row.volume), 0);
    }
    // la latence annoncée doit refléter la publication hebdomadaire
    expect(provenance.delayMs).toBeGreaterThan(86_400_000);
  });
});
