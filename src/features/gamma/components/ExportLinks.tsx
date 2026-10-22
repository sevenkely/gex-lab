import type { ExpiryFilter } from "@/config/assets";
import { t } from "@/lib/i18n";

/**
 * Liens d'export brut : profil par strike (CSV), niveaux (CSV) et snapshot
 * complet (JSON). Ce sont de vraies URL d'API — elles servent aussi bien à
 * l'utilisateur qu'à un overlay ATAS / NinjaTrader ou à un tableur.
 */
export function ExportLinks({
  assetId,
  filter,
}: {
  assetId: string;
  filter: ExpiryFilter;
}) {
  const query = filter === "ALL" ? "" : `&filter=${filter}`;
  const links = [
    { href: `/api/gex/${assetId}?format=csv${query}`, label: t().export.profile },
    { href: `/api/levels/${assetId}?format=csv${query}`, label: t().export.levels },
    { href: `/api/gex/${assetId}?format=json${query}`, label: t().export.snapshot },
  ];

  return (
    <div className="flex flex-wrap items-center gap-2 text-[11px]">
      <span className="text-tx2">{t().export.title}</span>
      {links.map((link) => (
        <a
          key={link.href}
          href={link.href}
          className="accent rounded-md border border-line px-2 py-0.5 text-ac transition-colors duration-200 hover:bg-white/5"
        >
          {link.label}
        </a>
      ))}
    </div>
  );
}
