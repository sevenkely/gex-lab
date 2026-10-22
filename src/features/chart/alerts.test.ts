import { describe, expect, it } from "vitest";
import {
  APPROACH_COOLDOWN_MS,
  CROSS_COOLDOWN_MS,
  createAlertMemory,
  detectLevelAlert,
  type AlertLevel,
} from "./alerts";

const LEVELS: AlertLevel[] = [
  { kind: "callWall", price: 90_000, label: "Call Wall" },
  { kind: "putWall", price: 80_000, label: "Put Wall" },
];

const T0 = Date.UTC(2026, 9, 19, 12, 0, 0);

function tick(
  previous: number,
  price: number,
  now = T0,
  levels: readonly AlertLevel[] = LEVELS,
  memory = createAlertMemory(),
) {
  return detectLevelAlert({ previous, price, now, levels, memory });
}

describe("detectLevelAlert — seuils", () => {
  it("ignore un prix loin de tous les niveaux", () => {
    expect(tick(85_000, 85_050)).toBeNull();
  });

  it("signale une approche dans ± 0,35 %", () => {
    // 90 000 × (1 − 0,3 %) = 89 730
    const alert = tick(89_400, 89_730);
    expect(alert?.kind).toBe("approach");
    expect(alert?.level).toBe("callWall");
    expect(alert?.levelPrice).toBe(90_000);
    expect(alert?.observed).toBe(89_730);
    expect(alert?.label).toBe("Call Wall");
  });

  it("signale un toucher dans ± 0,12 %", () => {
    // 90 000 × (1 − 0,05 %) = 89 955, sans franchissement
    const alert = tick(89_800, 89_955);
    expect(alert?.kind).toBe("touch");
  });

  it("signale un croisement même sans être proche du seuil avant/après", () => {
    const alert = tick(89_990, 90_010);
    expect(alert?.kind).toBe("cross");
  });
});

describe("detectLevelAlert — anti-répétition", () => {
  it("n'émet qu'une approche par niveau avant le délai", () => {
    const memory = createAlertMemory();
    expect(tick(89_400, 89_730, T0, LEVELS, memory)?.kind).toBe("approach");
    expect(tick(89_740, 89_760, T0 + 1_000, LEVELS, memory)).toBeNull();
    expect(
      tick(89_740, 89_760, T0 + APPROACH_COOLDOWN_MS + 1, LEVELS, memory)?.kind,
    ).toBe("approach");
  });

  it("un croisement pose aussi le délai de toucher (pas de doublon)", () => {
    const memory = createAlertMemory();
    expect(tick(89_990, 90_010, T0, LEVELS, memory)?.kind).toBe("cross");
    // Le prix reste collé au niveau : le croisement a déjà tout dit.
    expect(tick(90_010, 90_050, T0 + 1_000, LEVELS, memory)).toBeNull();
    // Après le délai de croisement, on retombe sur un toucher (le prix est
    // toujours dans ± 0,12 %), mais jamais sur un second croisement.
    const next = tick(90_010, 90_050, T0 + CROSS_COOLDOWN_MS + 1, LEVELS, memory);
    expect(next?.kind).toBe("touch");
  });
});

describe("detectLevelAlert — priorité", () => {
  it("préfère le croisement au toucher quand les deux s'appliquent", () => {
    // le prix traverse le put wall en restant dans sa fenêtre de toucher
    const alert = tick(79_995, 80_005);
    expect(alert?.kind).toBe("cross");
    expect(alert?.level).toBe("putWall");
  });

  it("choisit le niveau le plus proche à priorité égale", () => {
    // 90 200 est à 0,22 % du prix, 89 750 à 0,28 % : tous deux en approche.
    const levels: AlertLevel[] = [
      { kind: "zeroGamma", price: 90_200, label: "Zero Gamma" },
      { kind: "callWall", price: 89_750, label: "Call Wall" },
    ];
    const alert = tick(90_050, 90_000, T0, levels);
    expect(alert?.kind).toBe("approach");
    expect(alert?.level).toBe("zeroGamma");
  });

  it("ignore un prix nul ou négatif", () => {
    expect(tick(0, 0)).toBeNull();
    expect(tick(90_000, -1)).toBeNull();
  });

  it("un tick identique ne déclenche aucun croisement", () => {
    // Le prix posé exactement sur le niveau : toucher, jamais croisement
    // (aucun côté n'a changé).
    const alert = tick(90_000, 90_000, T0, [
      { kind: "callWall", price: 90_000, label: "Call Wall" },
    ]);
    expect(alert?.kind).toBe("touch");
  });
});
