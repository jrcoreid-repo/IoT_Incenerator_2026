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
      <head>
        {/* iOS can rewrite dates, phone numbers and addresses into links before React hydrates. */}
        <meta name="format-detection" content="telephone=no, date=no, email=no, address=no" />
      </head>
      <body>{children}</body>
    </html>
  );
}
