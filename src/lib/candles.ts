/**
 * Constantes de bougies partagées entre la page serveur, l'API et le client.
 *
 * La fenêtre initiale est volontairement plus large qu'une séance : sur 5m,
 * 24 h donnaient l'impression d'un graphique « d'aujourd'hui seulement ».
 * Les fenêtres restent sous ~1 000 bougies par requête (limite Deribit) et le
 * client charge les périodes précédentes au défilement.
 */

import type { CandleInterval } from "@/server/providers/types";

export const INTERVAL_MS: Record<CandleInterval, number> = {
  "1m": 60_000,
  "5m": 300_000,
  "15m": 900_000,
  "1H": 3_600_000,
  "1D": 86_400_000,
};

/** Fenêtre initiale chargée par unité de temps, en heures. */
export const WINDOW_HOURS: Record<CandleInterval, number> = {
  "1m": 12, // 720 bougies
  "5m": 72, // 864 bougies — 3 jours
  "15m": 168, // 672 bougies — 7 jours
  "1H": 720, // 720 bougies — 30 jours
  "1D": 8_760, // 365 bougies — 1 an
};

/** Plafond de bougies gardées après plusieurs chargements d'historique. */
export const MAX_BARS = 20_000;
