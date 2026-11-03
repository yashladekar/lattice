import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Workspace",
  description: "Your local-first Lattice workspace.",
};

export default function AppLayout({ children }: { children: React.ReactNode }) {
  return children;
}
