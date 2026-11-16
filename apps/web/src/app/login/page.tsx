import type { Metadata } from "next";
import { Suspense } from "react";

import { AuthView } from "@/components/auth/auth-view";

export const metadata: Metadata = {
  title: "Sign in",
  description: "Sign in to Lattice, your local-first knowledge workspace.",
};

export default function LoginPage() {
  return (
    <Suspense fallback={<div className="min-h-dvh bg-background" />}>
      <AuthView />
    </Suspense>
  );
}
