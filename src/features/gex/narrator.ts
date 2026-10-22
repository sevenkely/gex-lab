/**
 * Narrateur de marché — règles déterministes, aucun modèle de langage.
 *
 * Trois phrases au maximum, dans l'ordre de lecture d'un trader :
 *   1. régime (au-dessus / en dessous du flip) ;
 *   2. corridor des murs et distance au mur le plus proche ;
 *   3. mouvement attendu face aux murs (ou max pain à défaut).
 *
 * Le texte décrit une **convention** (dealers vendeurs nets d'options) et des
 * distances observées. Il ne prédit rien : les formulations restent au
 * conditionnel et « max pain » est explicitement présenté comme un repère.
 */

import { fmt, fmtSigned } from "@/lib/format";
import { LOCALE } from "@/lib/i18n";
import type { GexLevel, GexLevelKind, GexSnapshot } from "./types";

export type NarrationLineId = "regime" | "corridor" | "stretch" | "pain";

export interface NarrationLine {
  id: NarrationLineId;
  text: string;
}

export interface Narration {
  tone: "long" | "short" | "neutral";
  lines: NarrationLine[];
}

function pct(level: number, spot: number): number {
  return spot ? (level / spot - 1) * 100 : 0;
}

/** Distance signée, toujours lisible (« +3,92 % »). */
function distance(level: number, spot: number): string {
  return fmtSigned(pct(level, spot), 2, " %");
}

/** Distance absolue, pour « à X % du mur ». */
function gap(level: number, spot: number): string {
  return `${fmt(Math.abs(pct(level, spot)), 2)} %`;
}

/** Position du spot par rapport au flip, orientée (« +4,38 % au-dessus »). */
function spotVsFlip(spot: number, flip: number): string {
  return fmtSigned((spot / flip - 1) * 100, 2, " %");
}

export function narrate(snapshot: GexSnapshot, decimals = 2): Narration {
  const fr = LOCALE === "fr";
  const spot = snapshot.spot;
  const price = (value: number) => fmt(value, decimals);
  const find = (kind: GexLevelKind): GexLevel | null =>
    snapshot.levels.find((level) => level.kind === kind) ?? null;

  const callWall = find("callWall");
  const putWall = find("putWall");
  const flip = snapshot.zeroGamma;
  const lines: NarrationLine[] = [];
  const tone: Narration["tone"] =
    flip === null ? "neutral" : spot >= flip ? "long" : "short";

  // 1. Régime : c'est lui qui donne le sens de toute la couverture.
  if (flip !== null) {
    lines.push({
      id: "regime",
      text:
        tone === "long"
          ? fr
            ? `Long gamma : spot ${spotVsFlip(spot, flip)} au-dessus du flip ${price(flip)} — la couverture dealer amortit les mouvements, les murs bornent la séance.`
            : `Long gamma: spot ${spotVsFlip(spot, flip)} above the ${price(flip)} flip — dealer hedging dampens moves, the walls bound the session.`
          : fr
            ? `Short gamma : spot ${spotVsFlip(spot, flip)} sous le flip ${price(flip)} — la couverture dealer amplifie les mouvements, une cassure peut s’étendre.`
            : `Short gamma: spot ${spotVsFlip(spot, flip)} below the ${price(flip)} flip — dealer hedging amplifies moves, a break can extend.`,
    });
  } else {
    lines.push({
      id: "regime",
      text: fr
        ? "Flip indisponible sur ce périmètre : le Net GEX ne s’annule pas dans la fenêtre de calcul."
        : "Flip unavailable on this perimeter: net GEX never crosses zero inside the calculation window.",
    });
  }

  // 2. Corridor et mur le plus proche (c'est là que la réaction est la plus
  //    probable, donc l'information la plus utile).
  const walls = [callWall, putWall].filter((level): level is GexLevel => Boolean(level));
  const nearest =
    walls.length > 0
      ? walls.reduce((best, level) =>
          Math.abs(level.distancePct) < Math.abs(best.distancePct) ? level : best,
        )
      : null;
  const wallName = (level: GexLevel) =>
    level.kind === "callWall"
      ? fr
        ? "Call Wall"
        : "call wall"
      : fr
        ? "Put Wall"
        : "put wall";

  if (callWall && putWall && nearest) {
    lines.push({
      id: "corridor",
      text:
        Math.abs(nearest.distancePct) <= 0.5
          ? fr
            ? `Prix à ${gap(nearest.price, spot)} du ${wallName(nearest)} ${price(nearest.price)} : zone de friction, les réactions y sont plus rapides.`
            : `Price ${gap(nearest.price, spot)} from the ${price(nearest.price)} ${wallName(nearest)}: friction zone, reactions are faster there.`
          : fr
            ? `Corridor ${price(putWall.price)} – ${price(callWall.price)} : le ${wallName(nearest)} le plus proche est à ${gap(nearest.price, spot)}.`
            : `Corridor ${price(putWall.price)} – ${price(callWall.price)}: the nearest ${wallName(nearest)} sits ${gap(nearest.price, spot)} away.`,
    });
  } else if (nearest) {
    lines.push({
      id: "corridor",
      text: fr
        ? `Seul ${wallName(nearest)} identifié, à ${gap(nearest.price, spot)} du prix : la borne opposée du corridor manque sur ce périmètre.`
        : `Only the ${wallName(nearest)} is identified, ${gap(nearest.price, spot)} away: the opposite side of the corridor is missing on this perimeter.`,
    });
  }

  // 3. Le mouvement attendu suffit-il à atteindre un mur ? Sinon, max pain.
  const expected = snapshot.expectedMove;
  if (expected && nearest) {
    const up = spot + expected.points;
    const down = spot - expected.points;
    // Le mur cité est celui que le mouvement attendu rejoint, sinon le plus
    // proche : c'est la borne qui décide de la lecture.
    const reached =
      callWall && up >= callWall.price
        ? callWall
        : putWall && down <= putWall.price
          ? putWall
          : null;
    lines.push({
      id: "stretch",
      text: reached
        ? fr
          ? `Mouvement attendu ± ${price(expected.points)} (${fmt(expected.pct, 2)} %) : il atteint déjà le ${wallName(reached)} ${price(reached.price)} (${gap(reached.price, spot)}), une sortie de corridor est possible dans la séance.`
          : `Expected move ± ${price(expected.points)} (${fmt(expected.pct, 2)} %): it already reaches the ${price(reached.price)} ${wallName(reached)} (${gap(reached.price, spot)}), a corridor break is possible within the session.`
        : fr
          ? `Mouvement attendu ± ${price(expected.points)} (${fmt(expected.pct, 2)} %) : il reste à l’intérieur du corridor, sans atteindre les murs.`
          : `Expected move ± ${price(expected.points)} (${fmt(expected.pct, 2)} %): it stays inside the corridor and does not reach the walls.`,
    });
  } else if (snapshot.maxPain !== null) {
    lines.push({
      id: "pain",
      text: fr
        ? `Max pain à ${price(snapshot.maxPain)} (${distance(snapshot.maxPain, spot)}) : repère d’attraction des échéances à fort OI, pas une prévision.`
        : `Max pain at ${price(snapshot.maxPain)} (${distance(snapshot.maxPain, spot)}): a magnet reference for heavy-OI expiries, not a forecast.`,
    });
  }

  return { tone, lines };
}
