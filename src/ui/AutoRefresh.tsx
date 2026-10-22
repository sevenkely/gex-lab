"use client";

/**
 * Rafraîchissement périodique de la page (server component).
 *
 * Le graphique ne se met à jour que par deux canaux : les bougies ATAS (WebSocket,
 * `useAtasLive`) et le rendu serveur, exécuté une seule fois à l'ouverture. Les
 * niveaux (murs, zero gamma, max pain) et les bougies historiques viennent du rendu
 * serveur : sans ce rappel, ils ne bougent qu'au rechargement de la page.
 *
 * `router.refresh()` rejoue le server component et réconcilie l'arbre sans perdre
 * l'état client (dessin, zoom, réglages). L'onglet en arrière-plan est ignoré, et
 * l'appel revient au plus tôt sur le cache de 60 s du registre.
 */

import { useRouter } from "next/navigation";
import { useEffect } from "react";

/** Cadence par défaut : la même que le cache des chaînes et du badge d'en-tête. */
export const AUTO_REFRESH_MS = 60_000;

export function AutoRefresh({ intervalMs = AUTO_REFRESH_MS }: { intervalMs?: number }) {
  const router = useRouter();

  useEffect(() => {
    const tick = () => {
      if (document.visibilityState === "hidden") return;
      router.refresh();
    };
    const id = window.setInterval(tick, intervalMs);
    return () => window.clearInterval(id);
  }, [router, intervalMs]);

  return null;
}
