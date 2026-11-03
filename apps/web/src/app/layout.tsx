import type { Metadata, Viewport } from "next";
import { Geist, Geist_Mono, Instrument_Serif } from "next/font/google";

import "../index.css";
import "katex/dist/katex.min.css";
import Providers from "@/components/providers";
import PwaRegistration from "@/components/pwa-registration";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

const instrumentSerif = Instrument_Serif({
  variable: "--font-instrument-serif",
  subsets: ["latin"],
  weight: "400",
  style: ["normal", "italic"],
});

export const metadata: Metadata = {
  title: {
    default: "Lattice — a local-first knowledge OS",
    template: "%s · Lattice",
  },
  description:
    "Write, connect, visualize, and remember. Lattice is a local-first knowledge workspace for notes, whiteboards, knowledge graphs, and learning.",
  applicationName: "Lattice",
  icons: {
    icon: "/brand/lattice-mark.svg",
    apple: "/brand/lattice-mark.svg",
  },
  openGraph: {
    title: "Lattice — a local-first knowledge OS",
    description:
      "Write, connect, visualize, and remember. A calmer home for your ideas.",
    type: "website",
  },
};

export const viewport: Viewport = {
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#f8f5ee" },
    { media: "(prefers-color-scheme: dark)", color: "#1b1b17" },
  ],
  width: "device-width",
  initialScale: 1,
  maximumScale: 5,
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" suppressHydrationWarning>
      <head>
        <script src="/config.js" />
      </head>
      <body
        className={`${geistSans.variable} ${geistMono.variable} ${instrumentSerif.variable} antialiased`}
      >
        <PwaRegistration />
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}
