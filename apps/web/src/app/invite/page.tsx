"use client";

import { Button } from "@notes-learning/ui/components/button";
import { ArrowRight, Loader2, Mail } from "lucide-react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { Suspense, useEffect, useState } from "react";
import { toast } from "sonner";

import { useAppData } from "@/components/app-data-provider";
import { LatticeLogo } from "@/components/brand/logo";
import { authClient } from "@/lib/auth-client";
import { client } from "@/utils/orpc";

function InviteContent() {
  const router = useRouter();
  const params = useSearchParams();
  const token = params.get("token");
  const { user, sessionPending, refreshWorkspaces, setActiveWorkspace, refreshWorkspace } = useAppData();
  const [state, setState] = useState<"idle" | "accepting" | "error" | "done">("idle");
  const [message, setMessage] = useState("");

  useEffect(() => {
    if (sessionPending || !user || !token || state !== "idle") return;
    setState("accepting");
    void client.workspace
      .acceptInvite({ token })
      .then(async (result) => {
        await refreshWorkspaces();
        setActiveWorkspace(result.workspace.id);
        await refreshWorkspace(result.workspace.id);
        setState("done");
        toast.success(`Joined ${result.workspace.name}`);
        setTimeout(() => router.push("/app"), 600);
      })
      .catch((error) => {
        setState("error");
        setMessage(error instanceof Error ? error.message : "This invite could not be accepted.");
      });
  }, [sessionPending, user, token, state, refreshWorkspaces, setActiveWorkspace, refreshWorkspace, router]);

  if (!token) {
    return <InviteShell title="Invite missing" body="This invite link is incomplete. Ask an admin for a new link." />;
  }

  if (sessionPending) {
    return (
      <InviteShell title="Checking your session" body="One moment.">
        <Loader2 className="mx-auto size-5 animate-spin text-saffron" />
      </InviteShell>
    );
  }

  if (!user) {
    return (
      <InviteShell
        title="You are invited to a workspace"
        body="Sign in or create an account with the invited email, then return to this link to join."
      >
        <Button className="h-10 rounded-lg text-[11px]" render={<Link href={`/login?invite=${encodeURIComponent(token)}`} />}>
          <Mail className="size-3.5" /> Sign in to accept
        </Button>
      </InviteShell>
    );
  }

  return (
    <InviteShell
      title={state === "done" ? "You're in" : state === "error" ? "Could not join" : "Joining the workspace"}
      body={
        state === "error"
          ? message
          : state === "done"
            ? "Opening your new workspace…"
            : "Verifying your invite and adding you to the workspace."
      }
    >
      {state === "error" ? (
        <div className="flex flex-col items-center gap-2">
          <Button variant="outline" className="h-9 rounded-lg text-[11px]" render={<Link href="/app" />}>
            Go to your workspace <ArrowRight className="size-3" />
          </Button>
          <Link href={`/login?invite=${encodeURIComponent(token)}`} className="text-[10px] text-muted-foreground underline">
            Try signing in with a different account
          </Link>
        </div>
      ) : (
        <Loader2 className="mx-auto size-5 animate-spin text-saffron" />
      )}
    </InviteShell>
  );
}

function InviteShell({
  title,
  body,
  children,
}: {
  title: string;
  body: string;
  children?: React.ReactNode;
}) {
  return (
    <div className="grid min-h-dvh place-items-center bg-background px-5">
      <div className="w-full max-w-md text-center">
        <LatticeLogo href="/" className="justify-center" />
        <div className="mt-8 rounded-2xl border border-border/70 bg-card/50 p-6 shadow-sm">
          <h1 className="font-display text-3xl tracking-[-0.03em]">{title}</h1>
          <p className="mx-auto mt-2 max-w-sm text-[11px] leading-relaxed text-muted-foreground">{body}</p>
          <div className="mt-5">{children}</div>
        </div>
        <Link href="/" className="mt-4 inline-block text-[9px] text-muted-foreground hover:text-foreground">
          Back to Lattice
        </Link>
      </div>
    </div>
  );
}

export default function InvitePage() {
  return (
    <Suspense>
      <InviteContent />
    </Suspense>
  );
}
