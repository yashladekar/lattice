import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Workspace invite",
  description: "Join a workspace on Lattice.",
  // The invite token is in the URL, so keep it out of Referer headers and
  // search indexes, as the share page does.
  referrer: "no-referrer",
  robots: { index: false, follow: false },
};

export default function InviteLayout({ children }: { children: React.ReactNode }) {
  return children;
}
