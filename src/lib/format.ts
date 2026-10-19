/** Formatage de nombres et d'argent, en-US pour les chiffres, fr-FR pour les dates. */

export function fmt(value: number, decimals = 2): string {
  if (!Number.isFinite(value)) return "—";
  return value.toLocaleString("en-US", {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  });
}

/** Prix : décimales adaptées à l'échelle de l'actif. */
export function fmtPrice(value: number, decimals = 2): string {
  return fmt(value, decimals);
}

export function fmtSigned(value: number, decimals = 2, suffix = ""): string {
  return `${value >= 0 ? "+" : ""}${fmt(value, decimals)}${suffix}`;
}

export function fmtPct(value: number, decimals = 2): string {
  return `${value >= 0 ? "+" : ""}${fmt(value, decimals)} %`;
}

/** Grandeurs GEX : milliards / millions avec 1 décimale. */
export function fmtGex(value: number): string {
  const abs = Math.abs(value);
  if (abs >= 1e9) return `${fmtSigned(value / 1e9, 1)} Md$`;
  if (abs >= 1e6) return `${fmtSigned(value / 1e6, 1)} M$`;
  if (abs >= 1e3) return `${fmtSigned(value / 1e3, 1)} k$`;
  return fmtSigned(value, 0);
}

export function fmtGexCompact(value: number): string {
  const abs = Math.abs(value);
  const sign = value >= 0 ? "+" : "−";
  if (abs >= 1e9) return `${sign}${fmt(abs / 1e9, 2)} Md`;
  if (abs >= 1e6) return `${sign}${fmt(abs / 1e6, 1)} M`;
  if (abs >= 1e3) return `${sign}${fmt(abs / 1e3, 0)} k`;
  return `${sign}${fmt(abs, 0)}`;
}

/** Prime / notionnel d'un trade d'options. */
export function fmtMoney(value: number): string {
  const abs = Math.abs(value);
  if (abs >= 1e9) return `$${fmt(value / 1e9, 2)} Md`;
  if (abs >= 1e6) return `$${fmt(value / 1e6, 2)} M`;
  if (abs >= 1e3) return `$${fmt(value / 1e3, 0)} k`;
  return `$${fmt(value, 0)}`;
}

export function fmtAmount(value: number): string {
  return value.toLocaleString("en-US", { maximumFractionDigits: value % 1 ? 1 : 0 });
}

/** Distance en % avec signe et flèche directionnelle. */
export function fmtDistance(level: number, spot: number): string {
  if (!spot) return "—";
  return fmtSigned((level / spot - 1) * 100, 2, " %");
}

/** Latence affichée : "temps réel", "15 min", "3 j". */
export function fmtDelay(delayMs: number): string {
  if (delayMs <= 0) return "temps réel";
  const min = delayMs / 60_000;
  if (min < 60) return `${Math.round(min)} min`;
  const h = min / 60;
  if (h < 48) return `${Math.round(h)} h`;
  return `${Math.round(h / 24)} j`;
}

/** "il y a 12 s / 3 min / 2 h". */
export function fmtAgo(from: number, now = Date.now()): string {
  const s = Math.max(0, Math.round((now - from) / 1000));
  if (s < 60) return `il y a ${s} s`;
  const m = Math.round(s / 60);
  if (m < 60) return `il y a ${m} min`;
  const h = Math.round(m / 60);
  if (h < 48) return `il y a ${h} h`;
  return `il y a ${Math.round(h / 24)} j`;
}

export function fmtCompact(value: number): string {
  const abs = Math.abs(value);
  if (abs >= 1e12) return `${fmt(value / 1e12, 2)} T`;
  if (abs >= 1e9) return `${fmt(value / 1e9, 2)} Md`;
  if (abs >= 1e6) return `${fmt(value / 1e6, 2)} M`;
  if (abs >= 1e3) return `${fmt(value / 1e3, 1)} k`;
  return fmt(value, 0);
}
