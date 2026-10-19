import { beforeEach, describe, expect, it } from "vitest";
import { cached, clearMemoryCache, memoryEntries } from "./cache";

describe("cache applicatif", () => {
  beforeEach(() => clearMemoryCache());

  it("sert la valeur fraîche puis le cache sans rappeler le chargeur", async () => {
    let calls = 0;
    const loader = async () => {
      calls += 1;
      return { value: 42 };
    };
    const first = await cached("t1", 60_000, loader);
    const second = await cached("t1", 60_000, loader);
    expect(first.value).toEqual({ value: 42 });
    expect(first.fresh).toBe(true);
    expect(second.fresh).toBe(false);
    expect(second.stale).toBe(false);
    expect(calls).toBe(1);
  });

  it("relance le chargeur quand le TTL est dépassé", async () => {
    let calls = 0;
    const loader = async () => ++calls;
    await cached("t2", 0, loader);
    await cached("t2", 0, loader);
    expect(calls).toBe(2);
  });

  it("sert la dernière valeur connue en la marquant périmée si le chargeur échoue", async () => {
    let shouldFail = false;
    const loader = async () => {
      if (shouldFail) throw new Error("source indisponible");
      return { price: 100 };
    };
    await cached("t3", 0, loader);
    shouldFail = true;
    const result = await cached("t3", 0, loader, { staleWhileError: true });
    expect(result.stale).toBe(true);
    expect(result.value).toEqual({ price: 100 });
  });

  it("propage l'erreur s'il n'y a aucune valeur à servir", async () => {
    await expect(
      cached("t4", 0, async () => {
        throw new Error("boom");
      }),
    ).rejects.toThrow("boom");
  });

  it("expose l'âge des entrées (diagnostic /api/health)", async () => {
    await cached("t5", 60_000, async () => "ok");
    const entries = memoryEntries();
    expect(entries.find((e) => e.key === "t5")).toBeDefined();
    expect(entries.find((e) => e.key === "t5")!.ageMs).toBeLessThan(1_000);
  });
});
