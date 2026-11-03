import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Shared knowledge",
  description: "A read-only shared page from Lattice.",
  referrer: "no-referrer",
  robots: { index: false, follow: false },
};

export default function ShareLayout({ children }: { children: React.ReactNode }) {
  return children;
}
