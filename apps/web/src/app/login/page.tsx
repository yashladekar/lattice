import type { Metadata } from "next";
import { Suspense } from "react";

import { AuthView } from "@/components/auth/auth-view";

export const metadata: Metadata = {
  // This one route serves both the sign-in and create-account tabs.
  title: "Sign in or create an account",
  description: "Sign in to Lattice, or create an account for your local-first knowledge workspace.",
};

export default function LoginPage() {
  return (
    <Suspense fallback={<div className="min-h-dvh bg-background" />}>
      <AuthView />
    </Suspense>
  );
}
