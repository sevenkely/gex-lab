import { getAsset } from "@/config/assets";
import { cachedJson, failure } from "@/server/api";
import { ProviderError } from "@/server/providers/types";
import { getChainResult } from "@/server/registry";

export const dynamic = "force-dynamic";

// Les chaînes CBOE (jusqu’à 13 Mo) peuvent être lentes à froid : on laisse
// de la marge au rendu serveur plutôt que de couper la requête.
export const maxDuration = 60;

/** GET /api/chain/SPX — chaîne normalisée + provenance. */
export async function GET(
  _request: Request,
  context: { params: Promise<{ symbol: string }> },
) {
  const { symbol } = await context.params;
  const asset = getAsset(symbol);
  if (!asset) return failure(new ProviderError(`Actif inconnu : ${symbol}`, "not_found"));
  if (asset.proxy) {
    return failure(
      new ProviderError(
        `${asset.id} n'a pas de chaîne propre : utilisez ${asset.proxy.underlyingId}`,
        "not_supported",
      ),
    );
  }
  try {
    const result = await getChainResult(asset);
    return cachedJson(
      {
        assetId: asset.id,
        symbol: asset.symbol,
        spot: result.data.spot,
        prevClose: result.data.prevClose,
        contracts: result.data.contracts,
      },
      result.provenance,
      asset.assetClass === "crypto" ? 20 : 60,
    );
  } catch (error) {
    return failure(error);
  }
}
