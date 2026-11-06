import Link from "next/link";

import { LatticeLogo } from "@/components/brand/logo";

export default function SuccessPage() {
  return (
    <main className="grid min-h-dvh place-items-center bg-background px-5">
      <div className="max-w-md text-center">
        <LatticeLogo href={null} className="justify-center" />
        <h1 className="mt-8 font-display text-4xl tracking-[-0.03em]">You're all set.</h1>
        <p className="mt-2 text-xs leading-relaxed text-muted-foreground">
          Your subscription is active. Your workspace is exactly where you left it.
        </p>
        <Link
          href="/app"
          className="mt-5 inline-flex h-9 items-center rounded-lg bg-primary px-4 text-xs font-medium text-primary-foreground"
        >
          Open Lattice
        </Link>
      </div>
    </main>
  );
}
