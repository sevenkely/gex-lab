"use client";

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { useEffectiveRegime } from "@/store/ui";

/** Providers client de l'application. */
export function Providers({ children }: { children: React.ReactNode }) {
  const [client] = useState(
    () =>
      new QueryClient({
        defaultOptions: {
          queries: {
            // Les snapshots serveur sont déjà mis en cache (60 s CBOE / 20 s
            // Deribit) : inutile de re-fetcher au focus ou en boucle.
            staleTime: 30_000,
            refetchOnWindowFocus: false,
            retry: 1,
          },
        },
      }),
  );

  return (
    <QueryClientProvider client={client}>
      <RegimeSync />
      {children}
    </QueryClientProvider>
  );
}

/** Applique le régime effectif sur <html data-regime> : toute l'interface suit. */
function RegimeSync() {
  const regime = useEffectiveRegime();
  useEffect(() => {
    document.documentElement.dataset.regime = regime;
  }, [regime]);
  return null;
}
