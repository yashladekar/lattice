"use client";

import { Button } from "@notes-learning/ui/components/button";
import { AlertTriangle, LogOut, Plus, RefreshCw, WifiOff } from "lucide-react";
import { useRouter } from "next/navigation";

import { useAppData } from "@/components/app-data-provider";
import { LatticeLogo } from "@/components/brand/logo";
import { authClient } from "@/lib/auth-client";

export function WorkspaceEmptyState() {
  const router = useRouter();
  const { bootError, online, refreshWorkspaces, user, sessionPending } = useAppData();

  return (
    <div className="grid min-h-dvh place-items-center bg-background px-5">
      <div className="w-full max-w-md text-center">
        <LatticeLogo href={null} className="justify-center" />
        <h1 className="mt-8 font-display text-4xl tracking-[-0.03em]">
          {online ? "Set up your workspace" : "Your first workspace needs a connection"}
        </h1>
        <p className="mt-3 text-xs leading-relaxed text-muted-foreground">
          {online
            ? "Lattice needs to create your personal workspace on the sync server once. After that, everything works offline."
            : "Connect to the internet and sign in once to provision your workspace. Subsequent sessions are fully local-first."}
        </p>
        {bootError ? (
          <div className="mt-5 flex items-start gap-2 rounded-lg border border-destructive/25 bg-destructive/5 px-3 py-2 text-left text-xs text-destructive">
            <AlertTriangle className="mt-0.5 size-3.5 shrink-0" />
            <span>{bootError}</span>
          </div>
        ) : null}
        <div className="mt-6 flex flex-col items-center justify-center gap-2 sm:flex-row">
          {online ? (
            <Button className="h-10 rounded-lg px-4 text-xs" onClick={() => void refreshWorkspaces()}>
              <Plus className="size-4" /> Create my workspace
            </Button>
          ) : (
            <Button
              variant="outline"
              className="h-10 rounded-lg px-4 text-xs"
              onClick={() => window.location.reload()}
            >
              <WifiOff className="size-4" /> Retry connection
            </Button>
          )}
          <Button
            variant="ghost"
            className="h-10 rounded-lg px-4 text-xs"
            onClick={async () => {
              await authClient.signOut();
              router.push("/");
            }}
          >
            <LogOut className="size-4" /> Sign out
          </Button>
        </div>
        {!sessionPending && user ? (
          <p className="mt-5 text-xs text-muted-foreground">
            Signed in as {user.email}
          </p>
        ) : null}
      </div>
    </div>
  );
}

export function BootErrorBanner() {
  const { bootError, retrySync } = useAppData();
  if (!bootError) return null;
  return (
    <div className="flex items-center gap-2 border-b border-destructive/20 bg-destructive/5 px-3 py-1.5 text-xs text-destructive">
      <AlertTriangle className="size-3" />
      <span className="flex-1 truncate">{bootError}</span>
      <button
        type="button"
        onClick={() => void retrySync()}
        className="inline-flex items-center gap-1 underline underline-offset-2"
      >
        <RefreshCw className="size-2.5" /> retry
      </button>
    </div>
  );
}
