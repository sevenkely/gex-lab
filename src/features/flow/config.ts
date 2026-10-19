/**
 * Constantes du flux d'options.
 *
 * Ce module est volontairement séparé des composants : un module marqué
 * "use client" ne doit exporter que des composants (React/Turbopack s'appuie
 * sur les références client pour l'hydratation).
 */

export type FlowFilterId = "all" | "calls" | "puts" | "blocks";

/** Seuil de prime (USD) au-delà duquel un trade est mis en avant comme « bloc ». */
export const BLOCK_PREMIUM_THRESHOLD = 1_000_000;

/** Attribution du côté preneur à partir du prix exécuté. */
export function takerSide(
  price: number,
  bid: number | undefined,
  ask: number | undefined,
): "buy" | "sell" | "unknown" {
  if (bid === undefined || ask === undefined || !(ask > 0) || !(bid > 0))
    return "unknown";
  const mid = (bid + ask) / 2;
  if (price > mid) return "buy";
  if (price < mid) return "sell";
  return "unknown";
}
