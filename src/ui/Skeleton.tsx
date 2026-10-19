/** Squelette de chargement (shimmer). Rien ne doit « sauter » : on réserve la place. */
export function Skeleton({
  className = "h-4 w-full",
  label,
}: {
  className?: string;
  label?: string;
}) {
  return (
    <span
      role="status"
      aria-label={label ?? "Chargement"}
      aria-busy="true"
      className={`skeleton block ${className}`}
    />
  );
}

/** Bloc squelette pour une carte entière. */
export function SkeletonCard({ className = "h-24" }: { className?: string }) {
  return <Skeleton className={className} />;
}
