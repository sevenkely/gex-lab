import Link from "next/link";

export default function NotFound() {
  return (
    <div className="grid h-full place-items-center p-6">
      <div className="panel max-w-[420px] p-6 text-center">
        <h1 className="text-base font-semibold">Actif ou page introuvable</h1>
        <p className="mt-2 text-xs text-tx2">
          Les identifiants d’actif valides sont BTC, ETH, SPX, NDX, SPY, QQQ, GLD, NQ et
          GC.
        </p>
        <Link
          href="/"
          className="mt-4 inline-block rounded-md border border-line px-3 py-1.5 text-xs text-tx transition-colors hover:bg-white/5"
        >
          Retour à l’accueil
        </Link>
      </div>
    </div>
  );
}
