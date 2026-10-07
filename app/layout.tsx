import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "JR-AIoT | Monitoring Cerobong",
  description: "Dashboard pemantauan pembakaran, gas, dan prediksi risiko dioksin/furan."
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
