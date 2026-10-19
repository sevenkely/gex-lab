"use client";

/**
 * Transmet le régime calculé côté serveur au store d'interface, qui pilote
 * l'accent de toute l'application (turquoise / braise). Composant invisible.
 */

import { useEffect } from "react";
import { useUiStore } from "@/store/ui";
import type { GexRegime } from "../types";

export function AutoRegime({ regime }: { regime: GexRegime }) {
  const setAutoRegime = useUiStore((s) => s.setAutoRegime);
  useEffect(() => {
    setAutoRegime(regime);
  }, [regime, setAutoRegime]);
  return null;
}
