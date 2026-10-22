import { describe, expect, it } from "vitest";
import {
  DEFAULT_STYLE,
  DRAWING_COLORS,
  MAX_DRAWINGS,
  clampToPlot,
  createHline,
  createText,
  createTrend,
  createZone,
  decodeDrawings,
  distanceToSegment,
  drawingsKey,
  encodeDrawings,
  hitTest,
  lastStyle,
  nearestBarTime,
  type Drawing,
  type ProjectedDrawing,
} from "./drawings";

const project = (drawing: Drawing, points: ProjectedDrawing["points"]): ProjectedDrawing => ({
  id: drawing.id,
  type: drawing.type,
  points,
});

describe("création", () => {
  it("génère des identifiants distincts", () => {
    const a = createHline(100);
    const b = createHline(100);
    expect(a.id).not.toBe(b.id);
  });

  it("tronque un texte trop long", () => {
    const drawing = createText({ time: 1, price: 2 }, "x".repeat(200));
    expect(drawing.type).toBe("text");
    if (drawing.type === "text") expect(drawing.text.length).toBe(80);
  });

  it("applique le style demandé", () => {
    const style = { color: DRAWING_COLORS[1], width: 2 as const, dashed: true };
    const drawing = createTrend({ time: 1, price: 10 }, { time: 2, price: 20 }, style);
    expect(drawing.style).toEqual(style);
  });
});

describe("sélection", () => {
  const hline = createHline(100);
  const zone = createZone({ time: 1, price: 10 }, { time: 3, price: 20 });
  const trend = createTrend({ time: 1, price: 10 }, { time: 5, price: 10 });
  const label = createText({ time: 2, price: 15 }, "Note");

  const projected: ProjectedDrawing[] = [
    project(hline, [{ x: 0, y: 40 }]),
    project(zone, [
      { x: 10, y: 100 },
      { x: 110, y: 160 },
    ]),
    project(trend, [
      { x: 20, y: 200 },
      { x: 220, y: 200 },
    ]),
    { ...project(label, [{ x: 300, y: 50 }]), box: { width: 40, height: 16 } },
  ];

  it("trouve une ligne horizontale dans la tolérance", () => {
    expect(hitTest(projected, { x: 500, y: 44 })).toBe(hline.id);
    expect(hitTest(projected, { x: 500, y: 60 })).toBeNull();
  });

  it("trouve une tendance sur le segment, pas au-delà", () => {
    expect(hitTest(projected, { x: 120, y: 203 })).toBe(trend.id);
    expect(hitTest(projected, { x: 400, y: 200 })).toBeNull();
  });

  it("trouve une zone par son intérieur", () => {
    expect(hitTest(projected, { x: 60, y: 130 })).toBe(zone.id);
    expect(hitTest(projected, { x: 300, y: 130 })).toBeNull();
  });

  it("trouve un texte dans sa boîte", () => {
    expect(hitTest(projected, { x: 315, y: 52 })).toBe(label.id);
    expect(hitTest(projected, { x: 315, y: 90 })).toBeNull();
  });

  it("donne la priorité au dessin le plus récent", () => {
    const stacked = [
      project(hline, [{ x: 0, y: 100 }]),
      project(createHline(200), [{ x: 0, y: 100 }]),
    ];
    expect(hitTest(stacked, { x: 10, y: 101 })).toBe(stacked[1].id);
  });

  it("calcule la distance au segment, bornes comprises", () => {
    expect(distanceToSegment({ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 5, y: 3 })).toBeCloseTo(3);
    expect(distanceToSegment({ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 20, y: 0 })).toBeCloseTo(10);
  });

  it("borne les abscisses à la zone traçable", () => {
    expect(clampToPlot(-4, 800)).toBe(0);
    expect(clampToPlot(1200, 800)).toBe(800);
    expect(clampToPlot(120, 800)).toBe(120);
  });

  it("rattache un horodatage à la barre la plus proche", () => {
    const rows = [{ time: 300 }, { time: 600 }, { time: 900 }];
    expect(nearestBarTime(rows, 590)).toBe(600);
    expect(nearestBarTime(rows, 740)).toBe(600);
    expect(nearestBarTime(rows, 760)).toBe(900);
    expect(nearestBarTime(rows, 10)).toBe(300);
    expect(nearestBarTime(rows, 9_999)).toBe(900);
    expect(nearestBarTime([], 100)).toBeNull();
  });
});

describe("persistance", () => {
  it("ne garde que les dessins valides", () => {
    const drawing = createHline(100);
    const decoded = decodeDrawings(encodeDrawings([drawing]));
    expect(decoded).toHaveLength(1);
    expect(decoded[0]).toEqual(drawing);
  });

  it("renvoie une liste vide pour une entrée corrompue", () => {
    expect(decodeDrawings(null)).toEqual([]);
    expect(decodeDrawings("{pas du json")).toEqual([]);
    expect(decodeDrawings(JSON.stringify({ type: "hline" }))).toEqual([]);
    expect(decodeDrawings(JSON.stringify([{ id: "x", type: "hline", price: -1 }]))).toEqual([]);
  });

  it("rejette une couleur non hexadécimale", () => {
    const drawing = createHline(100, { color: "red", width: 1, dashed: false });
    expect(decodeDrawings(encodeDrawings([drawing]))).toEqual([]);
  });

  it("plafonne le nombre de dessins en gardant les plus récents", () => {
    const many = Array.from({ length: MAX_DRAWINGS + 5 }, (_, index) => createHline(100 + index));
    const decoded = decodeDrawings(encodeDrawings(many));
    expect(decoded).toHaveLength(MAX_DRAWINGS);
    expect(decoded[decoded.length - 1].type).toBe("hline");
  });

  it("isole les dessins par actif et unité de temps", () => {
    expect(drawingsKey("SPX", "5m")).not.toBe(drawingsKey("SPX", "1D"));
    expect(drawingsKey("SPX", "5m")).toBe(drawingsKey("SPX", "5m"));
  });

  it("réutilise le style du dernier dessin", () => {
    const style = { color: DRAWING_COLORS[2], width: 3 as const, dashed: true };
    expect(lastStyle([createHline(10, style)])).toEqual(style);
    expect(lastStyle([])).toEqual(DEFAULT_STYLE);
  });
});
