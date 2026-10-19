import type { Metadata, Viewport } from "next";
import { JetBrains_Mono, Sora } from "next/font/google";
import { Glow } from "@/ui/Glow";
import "./globals.css";
import { Providers } from "./providers";

const sora = Sora({
  subsets: ["latin"],
  weight: ["400", "600", "800"],
  variable: "--font-sora",
  display: "swap",
});

const jetbrains = JetBrains_Mono({
  subsets: ["latin"],
  weight: ["400", "600", "700"],
  variable: "--font-jetbrains",
  display: "swap",
});

export const metadata: Metadata = {
  title: "GEX Terminal — Gamma Field",
  description:
    "Terminal d’analyse du gamma exposure des options : niveaux clés, flux, gamma par strike et transparence dark pool. Données publiques gratuites, aucune donnée fictive.",
  applicationName: "GEX Terminal",
};

export const viewport: Viewport = {
  themeColor: "#0A0F1C",
  colorScheme: "dark",
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html
      lang="fr"
      data-regime="long"
      className={`${sora.variable} ${jetbrains.variable}`}
    >
      <body>
        <Glow />
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}
