/**
 * Primitive lightweight-charts : bandes GEX dessinées au canvas.
 *
 * Pourquoi une primitive et pas une série : les bandes ne sont pas des données
 * de prix. Une `ISeriesPrimitive` est dessinée par le moteur de rendu du
 * graphique, ce qui permet d'animer avec `requestUpdate()` sans toucher aux
 * données ni provoquer de re-render React.
 *
 * Rendu (cf. maquette Gamma Field) :
 *  - bords ondulés par deux sinusoïdes déphasées (bruit « organique ») ;
 *  - respiration lente, plus marquée pour le niveau le plus proche du prix ;
 *  - apparition en cascade à l'attachement ;
 *  - dégradé horizontal qui s'éteint aux extrémités ;
 *  - zone de gamma nul plus large, bords pointillés ;
 *  - étiquettes de niveau dessinées dans le panneau, anti-collision ;
 *  - étiquettes de prix sur l'axe via `priceAxisViews` (le graphique gère
 *    l'anti-collision) ;
 *  - onde (ripple) + flash quand le prix touche un niveau.
 *
 * L'axe est étendu par `autoscaleInfo()` pour que les trois niveaux restent
 * visibles même hors de la plage des bougies.
 */

import type {
  AutoscaleInfo,
  IPrimitivePaneRenderer,
  IPrimitivePaneView,
  ISeriesPrimitive,
  ISeriesPrimitiveAxisView,
  SeriesAttachedParameter,
  Time,
} from "lightweight-charts";
import { fmtPct } from "@/lib/format";

export type BandKind = "callWall" | "putWall" | "zeroGamma" | "maxGamma";

export interface BandLevel {
  kind: BandKind;
  price: number;
  label: string;
  /** Triplet RGB "45,212,191" (les tokens CSS sont en rgba()). */
  rgb: string;
  /** Niveau structurant : bande pleine + étiquette. */
  main: boolean;
}

export interface GexBandsOptions {
  visible: boolean;
  reducedMotion: boolean;
  /** Niveau survolé (carte du panneau) : les autres s'atténuent. */
  highlight: BandKind | null;
  /** Prix courant (dernier tick) pour la pulsation et les ondes. */
  spot: number;
  decimals: number;
}

interface Ripple {
  kind: BandKind;
  price: number;
  startedAt: number;
}

const TOUCH_TOLERANCE = 0.0012; // 0,12 % du prix
const TOUCH_COOLDOWN_MS = 4_000;
const RIPPLE_MS = 1_400;
const FLASH_MS = 600;
const APPEAR_MS = 700;
/** Marge entre un niveau épinglé et le bord bas du panneau. */
export const EDGE_INSET = 16;
/** Le bord haut est dégagé sous la légende et les boutons (superposés en DOM). */
export const TOP_INSET = 52;
/** Place réservée à l'étiquette d'un niveau épinglé (hauteur + espacement). */
const TAG_ROOM = 22;

/**
 * Extension maximale de la plage verticale due aux niveaux, exprimée en
 * multiple de la hauteur des bougies. Un mur situé au-delà est épinglé au bord
 * du panneau : les bougies gardent ainsi l'essentiel de la hauteur.
 */
export const MAX_EXTENSION = 0.5;

export interface PriceWindow {
  min: number;
  max: number;
}

/**
 * Plage verticale à demander au graphique : les bougies servent de référence,
 * les niveaux ne peuvent l'étendre que de `maxExtension × hauteur` de chaque
 * côté. Au-delà, `null` pour ce côté (le niveau sera épinglé au bord).
 */
export function clampLevelsToWindow(
  natural: PriceWindow | null,
  prices: readonly number[],
  maxExtension = MAX_EXTENSION,
): PriceWindow | null {
  if (prices.length === 0) return null;
  let min = Math.min(...prices);
  let max = Math.max(...prices);
  if (natural) {
    // Garde-fou : une séance sans amplitude ne doit pas réduire la fenêtre à rien.
    const height = Math.max(natural.max - natural.min, natural.max * 0.001);
    min = Math.max(min, natural.min - height * maxExtension);
    max = Math.min(max, natural.max + height * maxExtension);
    // La plage demandée contient toujours les bougies (union explicite) :
    // aucune implémentation ne peut les sortir du panneau.
    min = Math.min(min, natural.min);
    max = Math.max(max, natural.max);
  }
  if (!(max > min)) return null;
  return { min, max };
}

/**
 * Ordonnée d'un niveau épinglé : on empile depuis le bord haut (`edge > 0`,
 * le niveau est au-dessus du champ) ou bas, en réservant la place de l'étiquette.
 */
export function pinY(
  edge: -1 | 1,
  halfHeight: number,
  stack: number,
  height: number,
): number {
  const inset = edge > 0 ? TOP_INSET : EDGE_INSET;
  const offset = inset + halfHeight + stack * (halfHeight * 2 + TAG_ROOM);
  const y = edge > 0 ? offset : height - offset;
  return Math.max(8, Math.min(height - 8, y));
}

function rgba(rgb: string, alpha: number): string {
  return `rgba(${rgb},${Math.max(0, Math.min(1, alpha))})`;
}

function headerLabel(kind: BandKind): string {
  switch (kind) {
    case "callWall":
      return "Call Wall";
    case "putWall":
      return "Put Wall";
    case "zeroGamma":
      return "Zero Gamma";
    default:
      return "Max Gamma";
  }
}

export class GexBandsPrimitive implements ISeriesPrimitive<Time> {
  private host: SeriesAttachedParameter<Time> | null = null;
  private levels: BandLevel[] = [];
  private options: GexBandsOptions = {
    visible: true,
    reducedMotion: false,
    highlight: null,
    spot: 0,
    decimals: 2,
  };
  private startedAt = 0;
  private ripples: Ripple[] = [];
  private lastTouch = new Map<BandKind, number>();
  private lastPrice = 0;
  private rafId: number | null = null;
  private views: readonly IPrimitivePaneView[] | null = null;

  constructor(levels: BandLevel[] = []) {
    this.levels = levels;
  }

  /* ------------------------------------------------------------- cycle de vie */

  attached(param: SeriesAttachedParameter<Time>): void {
    this.host = param;
    this.startedAt = performance.now();
    this.ensureLoop();
  }

  detached(): void {
    this.stopLoop();
    this.host = null;
  }

  setLevels(levels: BandLevel[]): void {
    // Interpolation douce : on repart de l'état courant pour éviter un saut
    // quand l'utilisateur change de filtre d'échéance.
    this.levels = levels;
    this.startedAt = performance.now();
    this.requestUpdate();
  }

  setOptions(next: Partial<GexBandsOptions>): void {
    this.options = { ...this.options, ...next };
    if (this.options.visible && !this.options.reducedMotion) this.ensureLoop();
    this.requestUpdate();
  }

  /** Déclenche l'animation de toucher sans simuler un prix (bouton de démo). */
  pulse(kind: BandKind): void {
    const level = this.levels.find((item) => item.kind === kind);
    if (!level || this.options.reducedMotion) return;
    const now = performance.now();
    this.lastTouch.set(kind, now);
    this.ripples.push({ kind, price: level.price, startedAt: now });
    this.requestUpdate();
  }

  /**
   * Déclenche onde + flash si le prix touche un niveau.
   *
   * Le spot affiché (`options.spot`) reste celui de l'instantané : les
   * distances des étiquettes doivent correspondre à celles du panneau, qui
   * n'est pas rafraîchi par le flux temps réel.
   */
  notifyPrice(price: number): void {
    const previous = this.lastPrice;
    this.lastPrice = price;
    if (!(price > 0) || this.options.reducedMotion) return;

    const now = performance.now();
    for (const level of this.levels) {
      if (!level.main) continue;
      const touched = Math.abs(price - level.price) / price <= TOUCH_TOLERANCE;
      const crossed = previous > 0 && (previous - level.price) * (price - level.price) < 0;
      if (!touched && !crossed) continue;
      const last = this.lastTouch.get(level.kind) ?? 0;
      if (now - last < TOUCH_COOLDOWN_MS) continue;
      this.lastTouch.set(level.kind, now);
      this.ripples.push({ kind: level.kind, price: level.price, startedAt: now });
      if (this.ripples.length > 6) this.ripples.shift();
    }
  }

  /* ------------------------------------------------------------------ rendu */

  paneViews(): readonly IPrimitivePaneView[] {
    if (!this.views) {
      this.views = [
        {
          zOrder: () => "bottom",
          renderer: (): IPrimitivePaneRenderer => ({
            draw: (target) => {
              target.useMediaCoordinateSpace(({ context, mediaSize }) => {
                this.drawBands(context, mediaSize.width, mediaSize.height);
              });
            },
          }),
        },
      ];
    }
    return this.views;
  }

  priceAxisViews(): readonly ISeriesPrimitiveAxisView[] {
    const { visible } = this.options;
    if (!visible || !this.host) return [];
    const series = this.host.series;
    const views: ISeriesPrimitiveAxisView[] = [];
    // Anti-collision manuelle : deux niveaux distants de moins de 18 px
    // (ex. Put Wall 80 000 et Zero Gamma 80 200) empileraient deux étiquettes.
    // Le premier de la liste (ordre de priorité) gagne.
    const accepted: number[] = [];
    // Un niveau hors champ n'a pas de pastille : sa bande épinglée au bord
    // porte déjà l'information (prix, direction, distance).
    const range = series.priceScale().getVisibleRange();
    for (const level of this.levels) {
      if (!level.main) continue;
      if (range && (level.price < range.from || level.price > range.to)) continue;
      const coordinate = series.priceToCoordinate(level.price);
      if (coordinate === null) continue;
      const y = coordinate as number;
      if (accepted.some((value) => Math.abs(value - y) < 18)) continue;
      accepted.push(y);
      views.push({
        coordinate: () => coordinate as number,
        text: () => level.price.toLocaleString("en-US", {
          minimumFractionDigits: this.options.decimals,
          maximumFractionDigits: this.options.decimals,
        }),
        textColor: () => "#11161f",
        backColor: () => `rgb(${level.rgb})`,
        visible: () => true,
        tickVisible: () => true,
      });
    }
    return views;
  }

  autoscaleInfo(): AutoscaleInfo | null {
    const prices = this.levels.filter((level) => level.main).map((level) => level.price);
    const window = clampLevelsToWindow(this.naturalWindow(), prices);
    if (!window) return null;
    // Marge de respiration, plafonnée à 6 % de la plage demandée.
    const pad = (window.max - window.min) * 0.06;
    return { priceRange: { minValue: window.min - pad, maxValue: window.max + pad } };
  }

  /* ------------------------------------------------------------ géométrie */

  /**
   * Plus basse et plus haute mèche des bougies **visibles** : ce sont elles qui
   * définissent l'échelle. Prendre toute la série donnerait des prix hors champ,
   * et l'extrapolation s'appuierait sur des points invisibles.
   */
  private naturalWindow(): PriceWindow | null {
    const host = this.host;
    if (!host) return null;
    const data = host.series.data();
    if (data.length === 0) return null;
    const visible = host.chart.timeScale().getVisibleLogicalRange();
    const from = visible ? Math.max(0, Math.ceil(visible.from)) : 0;
    const to = visible
      ? Math.min(data.length - 1, Math.floor(visible.to))
      : data.length - 1;
    let min = Number.POSITIVE_INFINITY;
    let max = Number.NEGATIVE_INFINITY;
    for (let index = Math.min(from, to); index <= Math.max(from, to); index += 1) {
      const { low, high } = data[index] as { low?: number; high?: number };
      if (typeof low === "number" && low < min) min = low;
      if (typeof high === "number" && high > max) max = high;
    }
    if (!Number.isFinite(min) || !Number.isFinite(max) || max <= min) return null;
    return { min, max };
  }

  /**
   * Ordonnée d'un prix, y compris hors de la plage visible : `priceToCoordinate`
   * reste une projection linéaire et renvoie alors une coordonnée négative (ou
   * au-delà du bas). On la conserve, en notant de quel bord le prix est sorti :
   * la bande sera épinglée au lieu d'être dessinée hors du panneau.
   */
  private coordinateFor(price: number, height: number): { y: number; edge: -1 | 0 | 1 } | null {
    const coordinate = this.host?.series.priceToCoordinate(price) as number | null;
    if (coordinate === null) return null; // échelle de prix pas encore prête
    if (coordinate < 0) return { y: coordinate, edge: 1 };
    if (coordinate > height) return { y: coordinate, edge: -1 };
    return { y: coordinate, edge: 0 };
  }

  /* ---------------------------------------------------------------- dessin */

  private drawBands(ctx: CanvasRenderingContext2D, width: number, height: number): void {
    if (!this.host || !this.options.visible || width <= 0 || height <= 0) return;
    const now = performance.now();
    const t = (now - this.startedAt) / 1000;
    const reduced = this.options.reducedMotion;

    // niveau le plus proche du prix : respiration plus marquée
    let nearest: BandKind | null = null;
    let nearestDistance = Infinity;
    if (this.options.spot > 0) {
      for (const level of this.levels) {
        if (!level.main) continue;
        const distance = Math.abs(level.price - this.options.spot);
        if (distance < nearestDistance) {
          nearestDistance = distance;
          nearest = level.kind;
        }
      }
    }

    const activeRipples = this.ripples.filter((ripple) => now - ripple.startedAt < RIPPLE_MS);
    if (activeRipples.length !== this.ripples.length) this.ripples = activeRipples;

    // Curseurs d'empilement : deux niveaux épinglés du même côté ne se couvrent pas.
    const stacks = { up: 0, down: 0 };

    // Le max gamma (segments) est dessiné en premier : il ne doit pas masquer
    // la bande pleine d'un mur situé au même strike.
    const ordered = [...this.levels].sort((a, b) => Number(a.main) - Number(b.main));
    for (const level of ordered) {
      const point = this.coordinateFor(level.price, height);
      if (!point) continue;
      const appear = reduced
        ? 1
        : Math.max(0, Math.min(1, (now - this.startedAt - this.indexDelay(level.kind)) / APPEAR_MS));
      if (appear <= 0.01) continue;

      const highlighted = this.options.highlight === null || this.options.highlight === level.kind;
      const dim = highlighted ? 1 : 0.28;
      const flash = this.flashFor(level, now);
      const pulse =
        !reduced && nearest === level.kind ? 0.5 + 0.5 * Math.sin(t * 2.1 + level.price) : 0;
      const phase = level.price * 0.37;

      const halfHeight =
        (level.main ? 15 : 7) * (0.85 + 0.15 * appear) + (level.kind === "zeroGamma" ? 4 : 0);
      const edge = point.edge;
      const pinned = edge !== 0;
      // Un niveau secondaire (max gamma) hors champ n'est pas dessiné : ses
      // segments n'ont pas d'étiquette et brouilleraient la lecture des murs.
      if (pinned && !level.main) continue;
      const yBase = pinned
        ? pinY(edge > 0 ? 1 : -1, halfHeight, edge > 0 ? stacks.up++ : stacks.down++, height)
        : point.y;
      const wave = (x: number) => {
        if (reduced) return 0;
        return (
          Math.sin(x * 0.024 + t * 0.9 + phase) * 1.5 +
          Math.sin(x * 0.009 - t * 0.6 + phase * 1.7) * 1.1
        );
      };

      const alpha = (level.main ? 1 : 0.6) * dim * appear * (1 + 0.25 * pulse) * (1 + 0.9 * flash);

      ctx.save();
      ctx.globalAlpha = Math.min(1, alpha);
      if (this.options.highlight === level.kind) {
        ctx.shadowColor = rgba(level.rgb, 0.9);
        ctx.shadowBlur = 18;
      }

      if (level.main) {
        // corps de la bande
        ctx.beginPath();
        for (let x = 0; x <= width; x += 4) ctx.lineTo(x, yBase + wave(x) - halfHeight);
        for (let x = width; x >= 0; x -= 4) ctx.lineTo(x, yBase + wave(x) + halfHeight);
        ctx.closePath();

        const gradient = ctx.createLinearGradient(0, 0, width, 0);
        gradient.addColorStop(0, rgba(level.rgb, 0));
        gradient.addColorStop(0.12, rgba(level.rgb, 0.26));
        gradient.addColorStop(0.88, rgba(level.rgb, 0.26));
        gradient.addColorStop(1, rgba(level.rgb, 0));
        ctx.fillStyle = gradient;
        ctx.fill();

        // bords
        ctx.strokeStyle = rgba(level.rgb, 0.8);
        ctx.lineWidth = 1;
        for (const sign of [-1, 1]) {
          ctx.beginPath();
          for (let x = 0; x <= width; x += 4) ctx.lineTo(x, yBase + wave(x) + sign * halfHeight);
          ctx.stroke();
        }

        // ligne médiane pointillée
        ctx.setLineDash([2, 5]);
        ctx.strokeStyle = rgba(level.rgb, 0.35);
        ctx.beginPath();
        ctx.moveTo(0, yBase);
        ctx.lineTo(width, yBase);
        ctx.stroke();
        ctx.setLineDash([]);
      } else {
        const segment = [40, 12, 16, 12, 70, 16, 10, 12];
        let x = 0;
        let index = 0;
        ctx.fillStyle = rgba(level.rgb, 0.16);
        ctx.strokeStyle = rgba(level.rgb, 0.5);
        while (x < width) {
          const length = segment[index % segment.length];
          if (index % 2 === 0) {
            const xx = (x + (index * 37) % 60) % width;
            ctx.fillRect(xx, yBase - halfHeight / 2, length, halfHeight);
            ctx.strokeRect(xx + 0.5, yBase - halfHeight / 2 + 0.5, length, halfHeight);
          }
          x += length;
          index += 1;
        }
      }
      ctx.restore();

      const priceText = level.price.toLocaleString("en-US", {
        minimumFractionDigits: this.options.decimals,
        maximumFractionDigits: this.options.decimals,
      });
      if (pinned) {
        // Hors champ : l'étiquette reste visible en permanence, avec la
        // direction (↑ au-dessus du champ, ↓ en dessous) et la distance.
        const arrow = point.edge > 0 ? "↑" : "↓";
        const distance =
          this.options.spot > 0
            ? ` ${fmtPct((level.price / this.options.spot - 1) * 100, 2)}`
            : "";
        drawTag(ctx, level.rgb, `${arrow} ${headerLabel(level.kind)} ${priceText}${distance}`, yBase, width, appear);
      } else if (this.options.highlight === level.kind) {
        drawTag(ctx, level.rgb, `${headerLabel(level.kind)} ${priceText}`, yBase - halfHeight - 12, width, appear);
      }
    }

    // ondes au toucher (rare : on ne lit les données que dans ce cas)
    if (!reduced && this.ripples.length > 0) {
      const x = this.lastBarX();
      for (const ripple of this.ripples) {
        const elapsed = now - ripple.startedAt;
        const progress = elapsed / RIPPLE_MS;
        if (progress >= 1) continue;
        const level = this.levels.find((item) => item.kind === ripple.kind);
        if (!level) continue;
        // Une onde sur un niveau hors champ n'aurait aucun sens visuel.
        const point = this.coordinateFor(ripple.price, height);
        if (!point || point.edge !== 0) continue;
        ctx.save();
        ctx.globalAlpha = 0.75 * (1 - progress);
        ctx.strokeStyle = rgba(level.rgb, 0.9);
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.arc(x ?? width - 32, point.y, 4 + progress * 80, 0, Math.PI * 2);
        ctx.stroke();
        ctx.restore();
      }
    }
  }

  private lastBarX(): number | null {
    if (!this.host) return null;
    const series = this.host.series;
    const data = series.data();
    const last = data[data.length - 1];
    if (!last) return null;
    const x = this.host.chart.timeScale().timeToCoordinate(last.time as Time);
    return x === null ? null : (x as number);
  }

  private indexDelay(kind: BandKind): number {
    const order: BandKind[] = ["callWall", "putWall", "zeroGamma", "maxGamma"];
    return order.indexOf(kind) * 90;
  }

  private flashFor(level: BandLevel, now: number): number {
    const touchedAt = this.lastTouch.get(level.kind);
    if (!touchedAt) return 0;
    const elapsed = now - touchedAt;
    return elapsed < FLASH_MS ? 1 - elapsed / FLASH_MS : 0;
  }

  /* ------------------------------------------------------------- animation */

  private requestUpdate(): void {
    this.host?.requestUpdate();
  }

  private ensureLoop(): void {
    if (this.rafId !== null || this.options.reducedMotion) return;
    if (typeof window === "undefined") return;
    const loop = () => {
      if (!this.host || this.options.reducedMotion || !this.options.visible) {
        this.rafId = null;
        return;
      }
      // Onglet en arrière-plan : on ne consomme aucune frame.
      if (!document.hidden) this.requestUpdate();
      this.rafId = window.requestAnimationFrame(loop);
    };
    this.rafId = window.requestAnimationFrame(loop);
  }

  private stopLoop(): void {
    if (this.rafId !== null) {
      cancelAnimationFrame(this.rafId);
      this.rafId = null;
    }
  }

  setReducedMotion(reduced: boolean): void {
    this.options.reducedMotion = reduced;
    if (reduced) this.stopLoop();
    else this.ensureLoop();
    this.requestUpdate();
  }
}

/** Étiquette de niveau, alignée à droite dans le panneau. */
function drawTag(
  ctx: CanvasRenderingContext2D,
  rgb: string,
  text: string,
  centerY: number,
  width: number,
  alpha: number,
): void {
  ctx.save();
  ctx.globalAlpha = Math.max(0, Math.min(1, alpha));
  ctx.font = "600 10px ui-monospace, Menlo, Consolas, monospace";
  ctx.textAlign = "left";
  ctx.textBaseline = "middle";
  const textWidth = ctx.measureText(text).width;
  const tagX = Math.max(8, width - textWidth - 18);
  ctx.fillStyle = rgba(rgb, 0.16);
  ctx.strokeStyle = rgba(rgb, 0.55);
  roundRect(ctx, tagX - 5, centerY - 8, textWidth + 10, 16, 3);
  ctx.fill();
  ctx.stroke();
  ctx.fillStyle = `rgb(${rgb})`;
  ctx.fillText(text, tagX, centerY);
  ctx.restore();
}

function roundRect(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  width: number,
  height: number,
  radius: number,
): void {
  ctx.beginPath();
  ctx.moveTo(x + radius, y);
  ctx.lineTo(x + width - radius, y);
  ctx.quadraticCurveTo(x + width, y, x + width, y + radius);
  ctx.lineTo(x + width, y + height - radius);
  ctx.quadraticCurveTo(x + width, y + height, x + width - radius, y + height);
  ctx.lineTo(x + radius, y + height);
  ctx.quadraticCurveTo(x, y + height, x, y + height - radius);
  ctx.lineTo(x, y + radius);
  ctx.quadraticCurveTo(x, y, x + radius, y);
  ctx.closePath();
}
