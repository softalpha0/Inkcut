import type { Metadata } from "next";
import localFont from "next/font/local";
import "./globals.css";

const nunito = localFont({
  src: "./fonts/Nunito_800ExtraBold.ttf",
  variable: "--font-nunito",
  weight: "800",
  display: "swap",
});

export const metadata: Metadata = {
  title: "Inkcut: stickman explainer videos from a topic",
  description:
    "Type a topic, paste a script or upload your voiceover. Inkcut writes, voices, draws and edits a narrated stickman video you can download. Free.",
  metadataBase: process.env.NEXT_PUBLIC_SITE_URL ? new URL(process.env.NEXT_PUBLIC_SITE_URL) : undefined,
  openGraph: {
    title: "Inkcut",
    description: "Narrated stickman explainer videos from a topic, a script or your own voice.",
    type: "website",
  },
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={nunito.variable}>
      <body className="min-h-screen font-sans antialiased">{children}</body>
    </html>
  );
}
