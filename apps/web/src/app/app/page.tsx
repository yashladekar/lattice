"use client";

import { useSearchParams } from "next/navigation";
import { Suspense } from "react";

import { AppSplash } from "@/components/app-splash";
import { WorkspaceShell } from "@/components/workspace/workspace-shell";
import { parseAppRoute } from "@/lib/navigation";

function AppRoute() {
  const params = useSearchParams();
  return <WorkspaceShell route={parseAppRoute(params)} />;
}

export default function WorkspacePage() {
  return (
    <Suspense fallback={<AppSplash />}>
      <AppRoute />
    </Suspense>
  );
}
