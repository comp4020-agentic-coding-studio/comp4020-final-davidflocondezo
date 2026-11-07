import type { ReactNode } from "react";
import { Inter } from "next/font/google";

// next/font/google self-hosts Inter (no request to Google Fonts at runtime)
// and auto-generates a metric-matched "Inter Fallback" alongside it, so
// inter.style.fontFamily already resolves to the "Inter, 'Inter Fallback'"
// stack rather than that needing to be spelled out by hand.
const inter = Inter({ subsets: ["latin"] });

export const metadata = {
  title: "Weather radar",
  description: "Rain radar, warnings and forecast for your location",
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en-AU">
      {/* suppressHydrationWarning: only shallow (this element's own
          attributes), not children — silences the false-positive mismatch
          browser extensions like Grammarly cause by injecting attributes
          (e.g. data-gr-ext-installed) before React hydrates. */}
      <body
        style={{ margin: 0, fontFamily: `${inter.style.fontFamily}, sans-serif` }}
        suppressHydrationWarning
      >
        {children}
      </body>
    </html>
  );
}
