import type { ReactNode } from "react";

/** Panneau de base : surface translucide, bordure fine, flou d'arrière-plan. */
export function Card({
  children,
  className = "",
  padded = true,
  title,
  subtitle,
  aside,
}: {
  children?: ReactNode;
  className?: string;
  padded?: boolean;
  title?: ReactNode;
  subtitle?: ReactNode;
  aside?: ReactNode;
}) {
  return (
    <section
      className={`panel ${padded ? "p-3.5" : ""} ${className}`}
      aria-label={typeof title === "string" ? title : undefined}
    >
      {(title || aside) && (
        <header className="mb-2.5 flex items-center justify-between gap-2">
          {title ? <h3 className="text-xs font-semibold text-tx2">{title}</h3> : <span />}
          {aside}
        </header>
      )}
      {subtitle && <p className="mb-2 text-[11px] text-tx2">{subtitle}</p>}
      {children}
    </section>
  );
}
