"use client";

import { Button } from "@notes-learning/ui/components/button";
import { Input } from "@notes-learning/ui/components/input";
import { Label } from "@notes-learning/ui/components/label";
import { ArrowLeft, ArrowRight, Eye, EyeOff, Loader2, Lock, Shield } from "lucide-react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useEffect, useState } from "react";
import { toast } from "sonner";

import { LatticeLogo, LatticeMark } from "@/components/brand/logo";
import { authClient } from "@/lib/auth-client";
import { client } from "@/utils/orpc";

export function AuthView() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const inviteToken = searchParams.get("invite");
  const { data: session, isPending } = authClient.useSession();
  const [mode, setMode] = useState<"signin" | "signup">(
    searchParams.get("mode") === "signup" ? "signup" : "signin",
  );
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (searchParams.get("mode") === "signup") setMode("signup");
    if (searchParams.get("mode") === "signin") setMode("signin");
  }, [searchParams]);

  useEffect(() => {
    if (!isPending && session?.user) router.replace("/app");
  }, [isPending, router, session]);

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    setError(null);
    if (mode === "signup" && name.trim().length < 2) {
      setError("Tell us what to call you.");
      return;
    }
    if (!email.includes("@")) {
      setError("Enter a valid email address.");
      return;
    }
    if (password.length < 8) {
      setError("Use at least 8 characters for your password.");
      return;
    }
    setSubmitting(true);
    try {
      const result =
        mode === "signup"
          ? await authClient.signUp.email({ name: name.trim(), email, password })
          : await authClient.signIn.email({ email, password });
      if (result.error) {
        setError(result.error.message ?? "Something went wrong.");
        setSubmitting(false);
        return;
      }
      if (inviteToken) {
        try {
          const accepted = await client.workspace.acceptInvite({ token: inviteToken });
          window.localStorage.setItem("lattice.activeWorkspace", accepted.workspace.id);
          toast.success(`Joined ${accepted.workspace.name}`);
        } catch {
          // The invite page will show a clear error if it is invalid.
        }
      }
      toast.success(mode === "signup" ? "Workspace created" : "Welcome back");
      router.push("/app");
      router.refresh();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Could not connect to the server.");
      setSubmitting(false);
    }
  };

  return (
    <main className="grid min-h-dvh bg-background lg:grid-cols-[1.05fr_1fr]">
      <section className="relative hidden overflow-hidden border-r border-border/70 bg-[oklch(0.17_0.012_75)] p-10 text-[oklch(0.94_0.008_85)] lg:flex lg:flex-col">
        <div className="absolute inset-0 dot-grid opacity-[0.12]" />
        <div className="absolute -left-24 top-[30%] size-96 rounded-full bg-saffron/20 blur-3xl" />
        <div className="relative z-10 flex items-center justify-between">
          <LatticeLogo href="/" className="[&_span]:text-[oklch(0.94_0.008_85)]" />
          <Link href="/" className="flex items-center gap-1.5 text-[11px] text-white/50 hover:text-white">
            <ArrowLeft className="size-3" /> Back home
          </Link>
        </div>

        <div className="relative z-10 my-auto max-w-md">
          <div className="mb-5 flex items-center gap-2 text-[10px] uppercase tracking-[0.2em] text-white/40">
            <span className="size-1.5 rounded-full bg-saffron" />
            A local-first knowledge OS
          </div>
          <h1 className="font-display text-[3.6rem] leading-[0.95] tracking-[-0.035em]">
            A quieter place for your <span className="italic text-saffron">best thinking</span>.
          </h1>
          <p className="mt-5 max-w-sm text-sm leading-relaxed text-white/55">
            Write, connect, visualize, and remember. Your workspace lives on your device and syncs
            only when you want it to.
          </p>

          <div className="mt-10 rounded-2xl border border-white/10 bg-white/[0.04] p-5 backdrop-blur">
            <div className="flex items-center justify-between text-[10px] text-white/45">
              <span className="flex items-center gap-1.5">
                <span className="size-1.5 rounded-full bg-[#6f9c7d]" /> Saved locally
              </span>
              <span className="font-mono">0 conflicts</span>
            </div>
            <div className="mt-4 flex items-start gap-3">
              <LatticeMark className="size-7" />
              <div className="flex-1">
                <div className="font-display text-xl">The shape of an idea</div>
                <div className="mt-1 text-[10px] leading-relaxed text-white/45">
                  Every note is a node. Every canvas is a lens. Nothing is copied to make a new view work.
                </div>
                <div className="mt-3 flex items-center gap-2">
                  <span className="rounded-full border border-white/15 px-2 py-0.5 text-[8px] text-white/50">research</span>
                  <span className="rounded-full border border-white/15 px-2 py-0.5 text-[8px] text-white/50">graph</span>
                  <span className="ml-auto text-[8px] text-saffron">◇ 4 connections</span>
                </div>
              </div>
            </div>
          </div>
        </div>

        <div className="relative z-10 flex items-center gap-5 text-[10px] text-white/35">
          <span className="flex items-center gap-1.5"><Lock className="size-3" /> Encrypted in transit</span>
          <span className="flex items-center gap-1.5"><Shield className="size-3" /> Export anytime</span>
        </div>
      </section>

      <section className="flex min-h-dvh flex-col">
        <div className="flex items-center justify-between p-5 lg:hidden">
          <LatticeLogo />
          <Link href="/" className="text-[11px] text-muted-foreground">
            Back home
          </Link>
        </div>
        <div className="flex flex-1 items-center justify-center px-5 py-10">
          <div className="w-full max-w-sm">
            <div className="mb-8">
              <div className="inline-flex items-center gap-2 rounded-full border border-border bg-card/70 px-2.5 py-1 text-[10px] text-muted-foreground">
                <span className="size-1.5 rounded-full bg-saffron" />
                {mode === "signup" ? "Create your lattice" : "Welcome back"}
              </div>
              <h2 className="mt-5 font-display text-4xl leading-[1.02] tracking-[-0.03em]">
                {mode === "signup" ? "Start with one idea." : "Return to your thinking."}
              </h2>
              <p className="mt-2 text-[12px] leading-relaxed text-muted-foreground">
                {mode === "signup"
                  ? "Your personal workspace is ready in a moment — local storage first, cloud sync optional."
                  : "Pick up where you left off. Everything is still here."}
              </p>
            </div>

            <form onSubmit={submit} className="space-y-4">
              {mode === "signup" ? (
                <div className="space-y-1.5">
                  <Label htmlFor="name" className="text-[11px]">Name</Label>
                  <Input
                    id="name"
                    name="name"
                    autoComplete="name"
                    value={name}
                    onChange={(event) => setName(event.target.value)}
                    placeholder="Ada Lovelace"
                    className="h-10 rounded-lg bg-card/70 px-3 text-sm"
                  />
                </div>
              ) : null}
              <div className="space-y-1.5">
                <Label htmlFor="email" className="text-[11px]">Email</Label>
                <Input
                  id="email"
                  name="email"
                  type="email"
                  autoComplete="email"
                  value={email}
                  onChange={(event) => setEmail(event.target.value)}
                  placeholder="you@example.com"
                  className="h-10 rounded-lg bg-card/70 px-3 text-sm"
                />
              </div>
              <div className="space-y-1.5">
                <div className="flex items-center justify-between">
                  <Label htmlFor="password" className="text-[11px]">Password</Label>
                  {mode === "signin" ? (
                    <span className="text-[10px] text-muted-foreground">8+ characters</span>
                  ) : null}
                </div>
                <div className="relative">
                  <Input
                    id="password"
                    name="password"
                    type={showPassword ? "text" : "password"}
                    autoComplete={mode === "signup" ? "new-password" : "current-password"}
                    value={password}
                    onChange={(event) => setPassword(event.target.value)}
                    placeholder="••••••••"
                    className="h-10 rounded-lg bg-card/70 px-3 pr-10 text-sm"
                  />
                  <button
                    type="button"
                    aria-label={showPassword ? "Hide password" : "Show password"}
                    onClick={() => setShowPassword((value) => !value)}
                    className="absolute right-2 top-1/2 grid size-7 -translate-y-1/2 place-items-center rounded-md text-muted-foreground hover:bg-muted"
                  >
                    {showPassword ? <EyeOff className="size-3.5" /> : <Eye className="size-3.5" />}
                  </button>
                </div>
              </div>

              {error ? (
                <div className="rounded-lg border border-destructive/25 bg-destructive/5 px-3 py-2 text-[11px] text-destructive">
                  {error}
                </div>
              ) : null}

              <Button
                type="submit"
                disabled={submitting}
                className="h-10 w-full rounded-lg text-[13px]"
              >
                {submitting ? (
                  <Loader2 className="size-4 animate-spin" />
                ) : (
                  <>
                    {mode === "signup" ? "Create workspace" : "Sign in"}
                    <ArrowRight className="size-3.5" />
                  </>
                )}
              </Button>
            </form>

            <div className="mt-5 text-center text-[11px] text-muted-foreground">
              {mode === "signup" ? "Already have a workspace?" : "New to Lattice?"}{" "}
              <button
                type="button"
                onClick={() => {
                  setMode(mode === "signup" ? "signin" : "signup");
                  setError(null);
                }}
                className="font-medium text-foreground underline underline-offset-2"
              >
                {mode === "signup" ? "Sign in" : "Create one"}
              </button>
            </div>

            <div className="mt-10 flex items-center justify-center gap-4 text-[9px] text-muted-foreground/70">
              <span className="flex items-center gap-1"><Lock className="size-2.5" /> Local-first</span>
              <span className="flex items-center gap-1"><Shield className="size-2.5" /> No tracking</span>
              <span className="flex items-center gap-1"><ArrowLeft className="size-2.5 rotate-45" /> Portable</span>
            </div>
          </div>
        </div>
      </section>
    </main>
  );
}
