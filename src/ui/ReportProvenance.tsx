"use client";

/**
 * Publie la provenance de la vue dans le store d'interface.
 *
 * Rendu par chaque page (composant serveur → composant client), il ne peint
 * rien : il ne sert qu'à alimenter le badge de cache de l'en-tête, qui peut
 * ainsi afficher l'âge réel de la donnée à l'écran et signaler un repli sur les
 * fixtures — sans requête réseau supplémentaire.
 */

import { useEffect } from "react";
import type { Provenance } from "@/server/providers/types";
import { useUiStore } from "@/store/ui";

export function ReportProvenance({ provenance }: { provenance: Provenance }) {
  const setProvenance = useUiStore((state) => state.setProvenance);

  useEffect(() => {
    setProvenance({
      fetchedAt: provenance.fetchedAt,
      demo: provenance.demo === true,
      stale: provenance.stale,
      provider: provenance.provider,
    });
  }, [provenance, setProvenance]);

  return null;
}
