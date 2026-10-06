import type { ReactNode } from "react";

export const metadata = {
  title: "Weather radar",
  description: "Rain radar, warnings and forecast for your location",
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en-AU">
      <body style={{ margin: 0, fontFamily: "system-ui, sans-serif" }}>{children}</body>
    </html>
  );
}
