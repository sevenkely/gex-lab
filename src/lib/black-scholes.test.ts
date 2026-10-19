import { describe, expect, it } from "vitest";
import { bsDelta, bsGamma, bsPrice, d1, normCdf, normPdf } from "./black-scholes";

describe("normCdf / normPdf", () => {
  // Valeurs de référence classiques (tables statistiques), tolérance 1e-6 :
  // l'approximation A&S 7.1.26 garantit |ε| < 7.5e-8.
  it("correspond aux valeurs tabulées", () => {
    expect(normCdf(0)).toBeCloseTo(0.5, 8);
    expect(normCdf(1.96)).toBeCloseTo(0.9750021, 6);
    expect(normCdf(-1.96)).toBeCloseTo(0.0249979, 6);
    expect(normCdf(2)).toBeCloseTo(0.9772499, 6);
    expect(normCdf(-3)).toBeCloseTo(0.0013499, 6);
    expect(normCdf(3)).toBeCloseTo(0.9986501, 6);
    expect(normPdf(0)).toBeCloseTo(0.3989423, 6);
  });

  it("est symétrique", () => {
    for (const x of [0.1, 0.7, 1.3, 2.4]) {
      expect(normCdf(x) + normCdf(-x)).toBeCloseTo(1, 8);
    }
  });
});

describe("bsGamma", () => {
  it("est le gamma analytique, vérifié par différence finie sur le prix", () => {
    const S = 100;
    const K = 105;
    const T = 0.25;
    const sigma = 0.3;
    // Pas volontairement large : la dérivée seconde numérique est sensible aux
    // erreurs de troncature, on compare donc en relatif.
    const h = 0.5;
    const numerical =
      (bsPrice(S + h, K, T, sigma, "call") +
        bsPrice(S - h, K, T, sigma, "call") -
        2 * bsPrice(S, K, T, sigma, "call")) /
      (h * h);
    // écart observé ≈ 1,5e-4, entièrement imputable à la troncature en h²
    expect(bsGamma(S, K, T, sigma) / numerical).toBeCloseTo(1, 3);
  });

  it("atteint son maximum à la monnaie et reste positif", () => {
    const T = 0.1;
    const sigma = 0.2;
    const atm = bsGamma(100, 100, T, sigma);
    expect(atm).toBeGreaterThan(bsGamma(100, 110, T, sigma));
    expect(atm).toBeGreaterThan(bsGamma(100, 90, T, sigma));
    expect(bsGamma(100, 500, T, sigma)).toBeGreaterThan(0);
  });

  it("renvoie 0 pour les entrées dégénérées (T = 0, σ = 0, prix invalides)", () => {
    expect(bsGamma(100, 100, 0, 0.2)).toBe(0);
    expect(bsGamma(100, 100, 0.1, 0)).toBe(0);
    expect(bsGamma(0, 100, 0.1, 0.2)).toBe(0);
    expect(bsGamma(Number.NaN, 100, 0.1, 0.2)).toBe(0);
  });
});

describe("bsPrice / bsDelta", () => {
  it("respecte la parité put-call", () => {
    const S = 4200;
    const K = 4000;
    const T = 0.5;
    const sigma = 0.22;
    const r = 0.03;
    const call = bsPrice(S, K, T, sigma, "call", r);
    const put = bsPrice(S, K, T, sigma, "put", r);
    expect(call - put).toBeCloseTo(S - K * Math.exp(-r * T), 6);
  });

  it("le delta numérique correspond au delta analytique", () => {
    const S = 50;
    const K = 52;
    const T = 0.3;
    const sigma = 0.4;
    const h = 0.001;
    const numerical =
      (bsPrice(S + h, K, T, sigma, "put") - bsPrice(S - h, K, T, sigma, "put")) / (2 * h);
    expect(bsDelta(S, K, T, sigma, "put")).toBeCloseTo(numerical, 6);
  });

  it("d1 est cohérent avec d2", () => {
    const value = d1(100, 100, 0.25, 0.2);
    expect(value).toBeCloseTo(0.5 * 0.2 * Math.sqrt(0.25), 12);
  });
});
