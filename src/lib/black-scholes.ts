/**
 * Black-Scholes (branche européenne) — uniquement ce dont le terminal a besoin :
 * le gamma, plus des utilitaires de normalité.
 *
 * Conventions
 *  - S, K en unités de l'actif, σ en fraction (0.42 = 42 %), T en années.
 *  - Γ = φ(d1) / (S σ √T) : variation du delta par unité de S (par action,
 *    ou par 1 unité d'actif pour les crypto).
 *  - Le "dollar gamma" par 1 % de mouvement vaut Γ × S² × 0,01.
 */

const SQRT_2PI = Math.sqrt(2 * Math.PI);

export function normPdf(x: number): number {
  return Math.exp(-0.5 * x * x) / SQRT_2PI;
}

/** Approximation d'Abramowitz & Stegun 7.1.26 (|ε| < 7.5e-8). */
export function normCdf(x: number): number {
  const sign = x < 0 ? -1 : 1;
  const z = Math.abs(x) / Math.SQRT2;
  const t = 1 / (1 + 0.3275911 * z);
  const y =
    1 -
    ((((1.061405429 * t - 1.453152027) * t + 1.421413741) * t - 0.284496736) * t +
      0.254829592) *
      t *
      Math.exp(-z * z);
  return 0.5 * (1 + sign * y);
}

export function d1(S: number, K: number, T: number, sigma: number, r = 0, q = 0): number {
  return (Math.log(S / K) + (r - q + 0.5 * sigma * sigma) * T) / (sigma * Math.sqrt(T));
}

export function d2(S: number, K: number, T: number, sigma: number, r = 0, q = 0): number {
  return d1(S, K, T, sigma, r, q) - sigma * Math.sqrt(T);
}

/**
 * Gamma par unité d'actif. Renvoie 0 pour les entrées dégénérées
 * (T → 0 avec option hors de la monnaie, σ = 0, prix invalides).
 */
export function bsGamma(
  S: number,
  K: number,
  T: number,
  sigma: number,
  r = 0,
  q = 0,
): number {
  if (!(S > 0) || !(K > 0) || !(T > 0) || !(sigma > 0)) return 0;
  return normPdf(d1(S, K, T, sigma, r, q)) / (S * sigma * Math.sqrt(T));
}

/** Prix théorique d'un call/put européen (sert aux tests et aux contrôles). */
export function bsPrice(
  S: number,
  K: number,
  T: number,
  sigma: number,
  type: "call" | "put",
  r = 0,
  q = 0,
): number {
  if (!(S > 0) || !(K > 0) || !(T > 0) || !(sigma > 0)) {
    const intrinsic = type === "call" ? Math.max(0, S - K) : Math.max(0, K - S);
    return intrinsic;
  }
  const D1 = d1(S, K, T, sigma, r, q);
  const D2 = D1 - sigma * Math.sqrt(T);
  const disc = Math.exp(-r * T);
  const carry = Math.exp(-q * T);
  if (type === "call") return S * carry * normCdf(D1) - K * disc * normCdf(D2);
  return K * disc * normCdf(-D2) - S * carry * normCdf(-D1);
}

/** Delta (pour le contrôle de cohérence des chaînes). */
export function bsDelta(
  S: number,
  K: number,
  T: number,
  sigma: number,
  type: "call" | "put",
  r = 0,
  q = 0,
): number {
  if (!(S > 0) || !(K > 0) || !(T > 0) || !(sigma > 0)) {
    if (type === "call") return S > K ? 1 : 0;
    return S < K ? -1 : 0;
  }
  const D1 = d1(S, K, T, sigma, r, q);
  const carry = Math.exp(-q * T);
  return type === "call" ? carry * normCdf(D1) : carry * (normCdf(D1) - 1);
}
