import { Skeleton } from "./Skeleton";

/**
 * Squelette de page : on réserve la structure (cartes, tables) pour éviter
 * tout saut de mise en page pendant le calcul du snapshot côté serveur.
 */
export function PageSkeleton({
  cards = 5,
  tables = 1,
}: {
  cards?: number;
  tables?: number;
}) {
  return (
    <div className="h-full overflow-hidden p-4" aria-busy="true">
      <Skeleton className="mb-3 h-4 w-40" />
      <div className="grid grid-cols-[repeat(auto-fit,minmax(200px,1fr))] gap-3">
        {Array.from({ length: cards }).map((_, index) => (
          <div key={index} className="panel p-3.5">
            <Skeleton className="h-3 w-20" />
            <Skeleton className="mt-3 h-6 w-32" />
            <Skeleton className="mt-2 h-3 w-16" />
            <Skeleton className="mt-3 h-11 w-full" />
          </div>
        ))}
      </div>
      {Array.from({ length: tables }).map((_, index) => (
        <div key={index} className="panel mt-3 p-3.5">
          <Skeleton className="h-3 w-32" />
          {Array.from({ length: 8 }).map((__, row) => (
            <Skeleton key={row} className="mt-2.5 h-4 w-full" />
          ))}
        </div>
      ))}
    </div>
  );
}
