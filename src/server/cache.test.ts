import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  cached,
  clearMemoryCache,
  createUpstashDriver,
  decodeShared,
  driverTtl,
  encodeShared,
  memoryEntries,
  setCacheDriver,
  type CacheDriver,
} from "./cache";

/** Driver en mémoire qui imite Redis (partage entre « instances »). */
function fakeDriver(): CacheDriver & { store: Map<string, string> } {
  const store = new Map<string, string>();
  return {
    store,
    async get(key) {
      return store.get(key) ?? null;
    },
    async set(key, value) {
      store.set(key, value);
    },
  };
}

describe("cache applicatif", () => {
  beforeEach(() => clearMemoryCache());
  afterEach(() => setCacheDriver(null));

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

  it("partage un seul chargement entre appels concurrents", async () => {
    let calls = 0;
    const loader = async () => {
      calls += 1;
      await new Promise((resolve) => setTimeout(resolve, 20));
      return calls;
    };
    const results = await Promise.all([
      cached("t6", 60_000, loader),
      cached("t6", 60_000, loader),
      cached("t6", 60_000, loader),
    ]);
    expect(calls).toBe(1);
    expect(results.every((r) => r.value === 1)).toBe(true);
  });
});

describe("cache partagé (instance froide)", () => {
  beforeEach(() => clearMemoryCache());
  afterEach(() => setCacheDriver(null));

  it("sert la valeur du cache partagé sans rappeler le chargeur", async () => {
    const driver = fakeDriver();
    setCacheDriver(driver);

    let calls = 0;
    const loader = async () => {
      calls += 1;
      return { rows: [1, 2, 3] };
    };

    const first = await cached("chain:ES", 60_000, loader);
    expect(first.fresh).toBe(true);
    expect(driver.store.size).toBe(1);

    // Instance froide : la mémoire du process est vidée, Redis reste.
    clearMemoryCache();
    const second = await cached("chain:ES", 60_000, loader);

    expect(calls).toBe(1);
    expect(second.fresh).toBe(false);
    expect(second.stale).toBe(false);
    expect(second.value).toEqual({ rows: [1, 2, 3] });
  });

  it("sert une valeur partagée périmée quand la source échoue", async () => {
    const driver = fakeDriver();
    setCacheDriver(driver);
    await cached("chain:ES", 10, async () => ({ ok: true }));

    clearMemoryCache();
    // TTL applicatif écoulé : Redis garde l'enveloppe pour le repli.
    await new Promise((resolve) => setTimeout(resolve, 20));

    const stale = await cached(
      "chain:ES",
      10,
      async () => {
        throw new Error("CBOE indisponible");
      },
      { staleWhileError: true },
    );
    expect(stale.stale).toBe(true);
    expect(stale.value).toEqual({ ok: true });
  });

  it("ignore un cache partagé en panne sans casser la requête", async () => {
    setCacheDriver({
      async get() {
        throw new Error("réseau coupé");
      },
      async set() {
        throw new Error("réseau coupé");
      },
    });

    const result = await cached("chain:ES", 60_000, async () => ({ price: 7_760 }));
    expect(result.fresh).toBe(true);
    expect(result.value).toEqual({ price: 7_760 });
  });
});

describe("driver Upstash", () => {
  interface Command {
    url: string;
    body: (string | number)[];
    headers: Record<string, string>;
  }

  function stubFetch(store = new Map<string, string>()) {
    const commands: Command[] = [];
    const fetchImpl = vi.fn(async (url: string, init: RequestInit) => {
      const body = JSON.parse(String(init.body)) as (string | number)[];
      commands.push({ url, body, headers: init.headers as Record<string, string> });
      const [verb, key, value] = body;
      if (verb === "GET") {
        return new Response(JSON.stringify({ result: store.get(String(key)) ?? null }));
      }
      if (verb === "SET") {
        store.set(String(key), String(value));
        return new Response(JSON.stringify({ result: "OK" }));
      }
      return new Response(JSON.stringify({ error: `commande inconnue ${verb}` }));
    });
    vi.stubGlobal("fetch", fetchImpl);
    return { store, commands, fetchImpl };
  }

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("écrit une enveloppe préfixée avec un TTL Redis", async () => {
    const { store, commands } = stubFetch();
    const driver = createUpstashDriver({ url: "https://abc.upstash.io/", token: "tok" });

    await driver.set("chain:cboe:ES", JSON.stringify({ t: 1, ttl: 60_000, v: "x" }), 60_000);

    const set = commands[0];
    expect(set.url).toBe("https://abc.upstash.io");
    expect(set.headers.Authorization).toBe("Bearer tok");
    expect(set.body[0]).toBe("SET");
    expect(set.body[1]).toBe("gexlab:v1:chain:cboe:ES");
    expect(set.body[3]).toBe("PX");
    expect(set.body[4]).toBe(driverTtl(60_000));
    expect(store.get("gexlab:v1:chain:cboe:ES")).toBeDefined();
  });

  it("relit ce qu'il a écrit (compression comprise)", async () => {
    stubFetch();
    const driver = createUpstashDriver({ url: "https://abc.upstash.io", token: "tok" });
    const payload = JSON.stringify({ t: 1, ttl: 60_000, v: "chaîne" });

    await driver.set("k", payload, 60_000);
    await expect(driver.get("k")).resolves.toBe(payload);
  });

  it("n'écrit pas un enregistrement au-delà de la limite REST", async () => {
    const { commands } = stubFetch();
    const driver = createUpstashDriver({ url: "https://abc.upstash.io", token: "tok" });

    // Données incompressibles : le gzip ne peut pas les ramener sous le plafond.
    const noise = Array.from({ length: 5_000_000 }, () =>
      String.fromCharCode(33 + Math.floor(Math.random() * 90)),
    ).join("");

    await driver.set("k", noise, 60_000);
    expect(commands).toHaveLength(0);
  });

  it("remonte l'erreur HTTP pour que l'appelant puisse l'ignorer", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response("nope", { status: 503 })),
    );
    const driver = createUpstashDriver({ url: "https://abc.upstash.io", token: "tok" });
    await expect(driver.set("k", "{}", 1_000)).rejects.toThrow("503");
  });
});

describe("compression du cache partagé", () => {
  it("compresse une chaîne d'options volumineuse sous la limite REST", () => {
    // Forme réaliste d'un ChainSnapshot : ~21 000 contrats, comme SPX.
    const contracts = Array.from({ length: 21_000 }, (_, i) => ({
      symbol: `SPX261120C${String(4_000 + i * 5).padStart(8, "0")}`,
      type: i % 2 === 0 ? "call" : "put",
      expiry: 1_763_688_000_000 + (i % 55) * 86_400_000,
      strike: 4_000 + (i % 400) * 5,
      openInterest: 1_200 + (i % 700),
      volume: i % 90,
      iv: 0.16 + (i % 30) / 1_000,
      gamma: 0.00042 + (i % 17) / 1_000_000,
      delta: 0.5 - (i % 100) / 200,
      bid: 12.4 + (i % 40) / 10,
      ask: 12.6 + (i % 40) / 10,
      mid: 12.5 + (i % 40) / 10,
    }));
    const json = JSON.stringify(contracts);

    const encoded = encodeShared(json);
    expect(json.length).toBeGreaterThan(2_000_000);
    expect(encoded.startsWith("gz:")).toBe(true);
    expect(encoded.length).toBeLessThan(1_000_000);
    expect(decodeShared(encoded)).toBe(json);
  });

  it("laisse les petites valeurs en clair et renvoie null si le payload est cassé", () => {
    const small = JSON.stringify({ t: 1, ttl: 1_000, v: 7 });
    expect(encodeShared(small)).toBe(small);
    expect(decodeShared("gz:pas-du-base64-gzip")).toBeNull();
  });

  it("garde une marge de repli sur le TTL applicatif", () => {
    // 60 s de fraîcheur → 30 min de repli, le minimum de 15 min n'entre pas en jeu
    expect(driverTtl(60_000)).toBe(30 * 60_000);
    expect(driverTtl(1_000)).toBe(15 * 60_000);
    expect(driverTtl(3_600_000)).toBe(24 * 3_600_000);
    expect(driverTtl(24 * 3_600_000)).toBe(24 * 3_600_000);
  });
});
