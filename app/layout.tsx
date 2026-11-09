import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "ADI Smart Incinerator | Monitoring Lingkungan",
  description: "Dashboard ADI Smart Incinerator untuk pemantauan pembakaran, gas, dan kondisi lingkungan di Desa Caturharjo, Pandak, Bantul.",
  icons: { icon: [{ url: "/adi-icon.png", type: "image/png", sizes: "112x112" }], shortcut: "/adi-icon.png", apple: "/adi-icon.png" }
};

export default function RootLayout({
  children
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="id" suppressHydrationWarning>
      <body>{children}</body>
    </html>
  );
}
