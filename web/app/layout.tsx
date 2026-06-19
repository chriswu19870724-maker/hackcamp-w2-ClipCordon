import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "ClipCordon",
  description: "AI payment guard for hackcamp week 2.",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
