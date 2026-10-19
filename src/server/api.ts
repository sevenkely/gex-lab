/** Réponses API homogènes : provenance toujours visible, erreurs typées. */

import { NextResponse } from "next/server";
import type { Provenance } from "@/server/providers/types";
import { ProviderError } from "@/server/providers/types";

/** Champs de provenance répétés au niveau racine exigés par le cahier des charges. */
export function provenanceFields(provenance: Provenance) {
  return {
    asOf: provenance.asOf,
    delayMs: provenance.delayMs,
    source: provenance.source,
    derived: provenance.derived,
    stale: provenance.stale,
    demo: provenance.demo,
  };
}

export function cachedJson<T extends object>(
  body: T,
  provenance: Provenance,
  ttlSeconds: number,
): NextResponse {
  return NextResponse.json(
    { ...body, provenance, ...provenanceFields(provenance) },
    {
      headers: {
        "Cache-Control": `public, s-maxage=${ttlSeconds}, stale-while-revalidate=${ttlSeconds * 2}`,
        "X-Data-Source": provenance.provider,
        "X-Data-Delay": String(provenance.delayMs),
      },
    },
  );
}

export function failure(error: unknown): NextResponse {
  const code = error instanceof ProviderError ? error.code : "http";
  const status = code === "not_found" ? 404 : code === "not_supported" ? 400 : 502;
  return NextResponse.json(
    {
      error: error instanceof Error ? error.message : "Erreur inconnue",
      code,
    },
    { status, headers: { "Cache-Control": "no-store" } },
  );
}
