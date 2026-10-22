/**
 * Outils de dessin du graphique — modèle pur, sans React ni canvas.
 *
 * Un dessin est stocké en **coordonnées de données** (temps en secondes, prix),
 * jamais en pixels : il reste en place quand on zoome, on défile ou quand
 * l'historique s'ajoute. Le calque SVG ne fait que projeter ces ancres avec
 * l'échelle du graphique.
 *
 * Les tests couvrent la sélection (tolérance, priorité au dernier dessin) et la
 * désérialisation (stockage corrompu, schéma inattendu) : un dessin illisible
 * ne doit jamais casser le graphique.
 */

import { z } from "zod";

export type DrawingTool = "cursor" | "hline" | "trend" | "zone" | "text" | "erase";

export type DrawingKind = "hline" | "trend" | "zone" | "text";

export interface DrawingStyle {
  /** Couleur hexadécimale `#RRGGBB`. */
  color: string;
  width: 1 | 2 | 3;
  dashed: boolean;
}

export interface Anchor {
  /** Secondes UNIX, comme `Candle.time`. */
  time: number;
  price: number;
}

export type Drawing =
  | { id: string; type: "hline"; style: DrawingStyle; price: number }
  | { id: string; type: "trend" | "zone"; style: DrawingStyle; a: Anchor; b: Anchor }
  | { id: string; type: "text"; style: DrawingStyle; at: Anchor; text: string };

/** Palette alignée sur les tokens Gamma Field (turquoise, braise, sable, acier). */
export const DRAWING_COLORS = ["#2DD4BF", "#FF6B4A", "#E8D8A8", "#A0B9E6"] as const;

export const DEFAULT_STYLE: DrawingStyle = {
  color: DRAWING_COLORS[0],
  width: 1,
  dashed: false,
};

/** Plafond : au-delà, les dessins les plus anciens sont retirés au chargement. */
export const MAX_DRAWINGS = 200;

export const MIN_TEXT_LENGTH = 1;
export const MAX_TEXT_LENGTH = 80;

const STORAGE_PREFIX = "gex:drawings:v1";

/* ------------------------------------------------------------------ création */

let sequence = 0;

/** Identifiant local ; `crypto.randomUUID` n'existe pas partout (http, vieux Safari). */
export function drawingId(): string {
  sequence += 1;
  const random =
    typeof crypto !== "undefined" && "randomUUID" in crypto
      ? crypto.randomUUID()
      : Math.random().toString(36).slice(2);
  return `d${sequence}-${random}`;
}

export function createHline(price: number, style: DrawingStyle = DEFAULT_STYLE): Drawing {
  return { id: drawingId(), type: "hline", price, style };
}

export function createTrend(
  a: Anchor,
  b: Anchor,
  style: DrawingStyle = DEFAULT_STYLE,
): Drawing {
  return { id: drawingId(), type: "trend", a, b, style };
}

export function createZone(a: Anchor, b: Anchor, style: DrawingStyle = DEFAULT_STYLE): Drawing {
  return { id: drawingId(), type: "zone", a, b, style };
}

export function createText(
  at: Anchor,
  text: string,
  style: DrawingStyle = DEFAULT_STYLE,
): Drawing {
  return {
    id: drawingId(),
    type: "text",
    at,
    text: text.slice(0, MAX_TEXT_LENGTH),
    style,
  };
}

/* ------------------------------------------------------------------ sélection */

export interface Point {
  x: number;
  y: number;
}

/** Dessin déjà projeté par l'échelle du graphique. */
export interface ProjectedDrawing {
  id: string;
  type: DrawingKind;
  points: readonly Point[];
  /** Boîte du texte (largeur estimée, hauteur fixe). */
  box?: { width: number; height: number };
}

export function distanceToSegment(a: Point, b: Point, p: Point): number {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const lengthSquared = dx * dx + dy * dy;
  if (lengthSquared === 0) return Math.hypot(p.x - a.x, p.y - a.y);
  // Projection du point sur la droite, bornée au segment.
  const t = Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / lengthSquared));
  return Math.hypot(p.x - (a.x + t * dx), p.y - (a.y + t * dy));
}

/** Distance à la ligne horizontale (x ignoré : elle court sur toute la largeur). */
export function distanceToHline(y: number, p: Point): number {
  return Math.abs(p.y - y);
}

/**
 * Dessin sous le curseur, en partant du plus récent (il est dessiné au-dessus).
 * `tolerance` en pixels : on vise au doigt autant qu'à la souris.
 */
export function hitTest(
  projected: readonly ProjectedDrawing[],
  point: Point,
  tolerance = 6,
): string | null {
  for (let index = projected.length - 1; index >= 0; index -= 1) {
    const drawing = projected[index];
    const [a, b] = drawing.points;
    switch (drawing.type) {
      case "hline":
        if (a && distanceToHline(a.y, point) <= tolerance) return drawing.id;
        break;
      case "trend":
        if (a && b && distanceToSegment(a, b, point) <= tolerance) return drawing.id;
        break;
      case "zone": {
        if (!a || !b) break;
        const left = Math.min(a.x, b.x) - tolerance;
        const right = Math.max(a.x, b.x) + tolerance;
        const top = Math.min(a.y, b.y) - tolerance;
        const bottom = Math.max(a.y, b.y) + tolerance;
        if (point.x >= left && point.x <= right && point.y >= top && point.y <= bottom) {
          return drawing.id;
        }
        break;
      }
      case "text": {
        if (!a) break;
        const width = drawing.box?.width ?? 0;
        const height = drawing.box?.height ?? 14;
        // La boîte est ancrée à gauche, centrée verticalement sur l'ancre.
        if (
          point.x >= a.x - tolerance &&
          point.x <= a.x + width + tolerance &&
          point.y >= a.y - height / 2 - tolerance &&
          point.y <= a.y + height / 2 + tolerance
        ) {
          return drawing.id;
        }
        break;
      }
    }
  }
  return null;
}

/** Empêche un drag de dessin sous le panneau des prix (zone non traçable). */
export function clampToPlot(x: number, width: number): number {
  return Math.max(0, Math.min(width, x));
}

/**
 * Barre la plus proche d'un horodatage.
 *
 * Un dessin déplacé peut tomber un week-end (indices) ou au-delà de la
 * dernière bougie chargée : `timeToCoordinate` renverrait alors `null` et le
 * dessin disparaîtrait en entier. On le rattache à la barre la plus proche,
 * bornée aux extrémités du jeu de données.
 */
export function nearestBarTime(
  rows: readonly { time: number }[],
  time: number,
): number | null {
  if (rows.length === 0) return null;
  const first = rows[0].time;
  const last = rows[rows.length - 1].time;
  if (time <= first) return first;
  if (time >= last) return last;
  let low = 0;
  let high = rows.length - 1;
  while (low + 1 < high) {
    const middle = (low + high) >> 1;
    if (rows[middle].time <= time) low = middle;
    else high = middle;
  }
  return time - rows[low].time <= rows[high].time - time ? rows[low].time : rows[high].time;
}

/* --------------------------------------------------------------- persistance */

const styleSchema = z.object({
  color: z.string().regex(/^#[0-9a-fA-F]{6}$/),
  width: z.union([z.literal(1), z.literal(2), z.literal(3)]),
  dashed: z.boolean(),
});

const anchorSchema = z.object({
  time: z.number().finite().nonnegative(),
  price: z.number().finite().positive(),
});

const drawingSchema = z.discriminatedUnion("type", [
  z.object({
    id: z.string().min(1).max(80),
    type: z.literal("hline"),
    style: styleSchema,
    price: z.number().finite().positive(),
  }),
  z.object({
    id: z.string().min(1).max(80),
    type: z.literal("trend"),
    style: styleSchema,
    a: anchorSchema,
    b: anchorSchema,
  }),
  z.object({
    id: z.string().min(1).max(80),
    type: z.literal("zone"),
    style: styleSchema,
    a: anchorSchema,
    b: anchorSchema,
  }),
  z.object({
    id: z.string().min(1).max(80),
    type: z.literal("text"),
    style: styleSchema,
    at: anchorSchema,
    text: z.string().min(MIN_TEXT_LENGTH).max(MAX_TEXT_LENGTH),
  }),
]);

/** Clé de stockage : les dessins appartiennent à un actif **et** à une unité de temps. */
export function drawingsKey(assetId: string, interval: string): string {
  return `${STORAGE_PREFIX}:${assetId}:${interval}`;
}

export function encodeDrawings(drawings: readonly Drawing[]): string {
  return JSON.stringify(drawings.slice(-MAX_DRAWINGS));
}

/**
 * Lecture tolérante : une entrée corrompue (JSON invalide, schéma inconnu,
 * version antérieure) renvoie une liste vide plutôt que de faire échouer le
 * rendu du graphique.
 */
export function decodeDrawings(raw: string | null | undefined): Drawing[] {
  if (!raw) return [];
  try {
    const json: unknown = JSON.parse(raw);
    const parsed = z.array(drawingSchema).safeParse(json);
    if (!parsed.success) return [];
    return parsed.data.slice(-MAX_DRAWINGS) as Drawing[];
  } catch {
    return [];
  }
}

/** Dernière position du style : l'outil courant réutilise le réglage précédent. */
export function lastStyle(drawings: readonly Drawing[]): DrawingStyle {
  return drawings.length > 0 ? drawings[drawings.length - 1].style : DEFAULT_STYLE;
}
