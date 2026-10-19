import type { NextRequest } from "next/server";
import { cachedJson, failure } from "@/server/api";
import { getDarkPoolSnapshot } from "@/server/registry";

export const dynamic = "force-dynamic";

// Les chaînes CBOE (jusqu’à 13 Mo) peuvent être lentes à froid : on laisse
// de la marge au rendu serveur plutôt que de couper la requête.
export const maxDuration = 60;

/** Symboles couverts par le dataset ATS (SPX n'y figure pas). */
const DEFAULT_SYMBOLS = ["SPY", "QQQ", "GLD"];

/** GET /api/darkpool?symbols=SPY,QQQ,GLD */
export async function GET(request: NextRequest) {
  const raw = request.nextUrl.searchParams.get("symbols");
  const symbols = (raw ? raw.split(",") : DEFAULT_SYMBOLS)
    .map((s) => s.trim().toUpperCase())
    .filter((s) => /^[A-Z.]{1,10}$/.test(s))
    .slice(0, 8);

  try {
    const { snapshot, provenance } = await getDarkPoolSnapshot(symbols);
    return cachedJson(
      {
        weekStart: snapshot.weekStart,
        publishedAt: snapshot.publishedAt ?? null,
        symbols,
        rows: snapshot.rows,
      },
      provenance,
      600,
    );
  } catch (error) {
    return failure(error);
  }
}
