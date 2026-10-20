import type { ReactNode } from "react";

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
        style={{ margin: 0, fontFamily: "system-ui, sans-serif" }}
        suppressHydrationWarning
      >
        {children}
      </body>
    </html>
  );
}
