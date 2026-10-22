import { CommandPalette } from "@/ui/CommandPalette";
import { Header } from "@/ui/Header";
import { Rail } from "@/ui/Rail";

/**
 * Shell de l'application : rail à gauche (bas sur mobile), en-tête, puis la vue.
 * Le défilement est géré par chaque vue, pas par le document — l'application
 * occupe exactement la fenêtre.
 */
export default function AppLayout({ children }: LayoutProps<"/">) {
  return (
    <div className="relative z-1 flex h-full max-md:flex-col-reverse">
      <Rail />
      {/* `min-h-0` : sans lui, la colonne refuse de rétrécir sous la hauteur
          de son contenu sur mobile (flex-col-reverse) et la fin des pages
          longues devient inatteignable. */}
      <div className="flex min-h-0 min-w-0 flex-1 flex-col">
        <Header />
        <div className="relative min-h-0 flex-1">{children}</div>
      </div>
      {/* Palette ⌘K : montée une fois, détachée du contenu des vues. */}
      <CommandPalette />
    </div>
  );
}
