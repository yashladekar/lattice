"use client";

import { Button } from "@notes-learning/ui/components/button";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Check, Copy, GitBranch, Loader2 } from "lucide-react";
import { useSearchParams } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { toast } from "sonner";

import { useAppData } from "@/components/app-data-provider";
import { openExternalUrl } from "@/lib/open-external";
import { client } from "@/utils/orpc";

interface DeviceLogin {
  id: string;
  userCode: string;
  verificationUri: string;
  expiresIn: number;
  interval: number;
}

const FAILURE_REASONS: Record<string, string> = {
  state_missing: "The GitHub sign-in was missing its state. Start again.",
  state_expired: "That GitHub sign-in expired. Start again.",
  provider_error: "GitHub authorization was declined.",
  exchange_failed: "GitHub did not complete the sign-in. Try again.",
};

/**
 * The GitHub equivalent of the ChatGPT plan card: connect once, keep the token
 * encrypted on the server, and let import and sync reuse it. The callback flow
 * mirrors Vercel's "add account" step; when the deployment has no client
 * secret, the device flow is used instead. Hidden entirely unless the
 * deployment enabled the feature and supplied a client id.
 */
export function GithubConnectionCard() {
  const { user, online } = useAppData();
  const queryClient = useQueryClient();
  const searchParams = useSearchParams();
  const [device, setDevice] = useState<DeviceLogin | null>(null);
  const [busy, setBusy] = useState(false);
  const handledRedirect = useRef<string | null>(null);

  const status = useQuery({
    queryKey: ["github-status", user?.id],
    queryFn: async () => client.github.status(),
    enabled: online && Boolean(user),
  });

  useEffect(() => {
    const result = searchParams?.get("github");
    if (!result || handledRedirect.current === result) return;
    handledRedirect.current = result;
    if (result === "connected") {
      toast.success("GitHub connected");
      void queryClient.invalidateQueries({ queryKey: ["github-status"] });
      void queryClient.invalidateQueries({ queryKey: ["github-repos"] });
    } else if (result === "error") {
      const reason = searchParams?.get("reason") ?? "";
      toast.error(FAILURE_REASONS[reason] ?? "The GitHub sign-in did not complete.");
    }
  }, [searchParams, queryClient]);

  useEffect(() => {
    if (!device) return;
    let stopped = false;

    const tick = async () => {
      try {
        const result = await client.github.poll({ id: device.id });
        if (stopped) return;
        if (result.status === "connected") {
          setDevice(null);
          await queryClient.invalidateQueries({ queryKey: ["github-status"] });
          await queryClient.invalidateQueries({ queryKey: ["github-repos"] });
          toast.success(`GitHub connected as @${result.login}`);
        } else if (result.status === "expired") {
          setDevice(null);
          toast.error("That GitHub code expired. Start again.");
        } else if (result.status === "denied") {
          setDevice(null);
          toast.error("The GitHub authorization was declined.");
        } else if (result.status === "error") {
          setDevice(null);
          toast.error(result.message);
        }
      } catch (error) {
        if (stopped) return;
        setDevice(null);
        toast.error(error instanceof Error ? error.message : "Could not finish the GitHub sign-in.");
      }
    };

    const timer = window.setInterval(() => void tick(), Math.max(5, device.interval) * 1000);
    return () => {
      stopped = true;
      window.clearInterval(timer);
    };
  }, [device, queryClient]);

  const connect = async () => {
    setBusy(true);
    try {
      const login = await client.github.start();
      if (login.mode === "oauth") {
        await openExternalUrl(login.authorizeUrl);
        toast.success("Finish connecting GitHub in your browser.");
        return;
      }
      setDevice(login);
      await openExternalUrl(login.verificationUri);
      toast.success("Enter the code on GitHub to finish connecting.");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Could not start the GitHub sign-in");
    } finally {
      setBusy(false);
    }
  };

  const disconnect = async () => {
    setBusy(true);
    try {
      await client.github.disconnect();
      setDevice(null);
      await queryClient.invalidateQueries({ queryKey: ["github-status"] });
      await queryClient.invalidateQueries({ queryKey: ["github-repos"] });
      toast.success("GitHub disconnected");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Could not disconnect GitHub");
    } finally {
      setBusy(false);
    }
  };

  const copyCode = async () => {
    if (!device) return;
    try {
      await navigator.clipboard.writeText(device.userCode);
      toast.success("Code copied");
    } catch {
      toast.error("Could not copy the code");
    }
  };

  if (!status.data?.enabled) return null;

  return (
    <div className="rounded-xl border border-border/70 bg-card/35 p-4">
      <div className="flex items-start gap-2">
        <span className="grid size-8 shrink-0 place-items-center rounded-lg border border-border/60 bg-card">
          <GitBranch className="size-3.5" />
        </span>
        <div className="min-w-0 flex-1">
          <h2 className="text-[12px] font-semibold tracking-[-0.01em]">GitHub</h2>
          <p className="mt-0.5 text-[9px] leading-relaxed text-muted-foreground">
            Connect an account once, then pick a repository when you import or sync. The token is
            encrypted with the deployment secret and never reaches this browser.
          </p>
        </div>
        {status.data.connected ? <Check className="size-3.5 text-moss" /> : null}
      </div>

      <div className="mt-3">
        {!status.data.configured ? (
          <div className="space-y-2 rounded-lg border border-saffron/30 bg-saffron/[0.05] p-2.5">
            <p className="text-[9px] leading-relaxed">
              GitHub is enabled on this server, but its OAuth App is not configured yet.
            </p>
            <div className="space-y-1 font-mono text-[8.5px] text-muted-foreground">
              <div>GITHUB_CLIENT_ID=&lt;OAuth App client id&gt;</div>
              <div>GITHUB_CLIENT_SECRET=&lt;OAuth App client secret&gt;</div>
            </div>
            {status.data.callbackUrl ? (
              <p className="text-[8px] leading-relaxed text-muted-foreground">
                Register the app with the callback URL{" "}
                <span className="font-mono">{status.data.callbackUrl}</span>, restart the server,
                then reload this page.
              </p>
            ) : null}
          </div>
        ) : status.data.connected ? (
          <div className="space-y-2">
            <div className="flex items-center gap-2 text-[10px]">
              <span className="status-dot bg-moss" />
              <div className="min-w-0 flex-1">
                <div className="truncate text-[10px] font-medium">
                  @{status.data.login}
                  {status.data.name ? (
                    <span className="ml-1.5 font-normal text-muted-foreground">
                      {status.data.name}
                    </span>
                  ) : null}
                </div>
                <div className="text-[8px] text-muted-foreground">
                  {status.data.scopes.includes("repo")
                    ? "Repository read and write access"
                    : "No repository write scope"}
                  {" · "}
                  used by Import from GitHub and Sync with Git
                </div>
              </div>
            </div>
            {status.data.lastError ? (
              <p className="text-[8px] text-destructive">Last error: {status.data.lastError}</p>
            ) : null}
            <div className="flex flex-wrap items-center gap-2">
              <Button
                variant="outline"
                size="sm"
                className="h-7 rounded-md text-[9px]"
                disabled={busy}
                onClick={() => void connect()}
              >
                Reconnect
              </Button>
              <Button
                variant="outline"
                size="sm"
                className="h-7 rounded-md text-[9px] text-destructive"
                disabled={busy}
                onClick={() => void disconnect()}
              >
                Disconnect
              </Button>
              <span className="text-[8px] text-muted-foreground">
                Disconnecting deletes the stored token; revoke it on GitHub too if you want to be
                sure.
              </span>
            </div>
          </div>
        ) : device ? (
          <div className="rounded-lg border border-saffron/30 bg-saffron/[0.05] p-2.5">
            <div className="text-[8px] uppercase tracking-[0.12em] text-muted-foreground">
              Code to enter at GitHub
            </div>
            <div className="mt-1 flex items-center gap-2">
              <code className="rounded-md border border-border/60 bg-background px-2 py-1 font-mono text-[13px] tracking-[0.15em]">
                {device.userCode}
              </code>
              <Button
                variant="outline"
                size="sm"
                className="h-7 rounded-md text-[9px]"
                onClick={() => void copyCode()}
              >
                <Copy className="size-3" /> Copy
              </Button>
              <Button
                variant="ghost"
                size="sm"
                className="h-7 rounded-md text-[9px]"
                onClick={() =>
                  void openExternalUrl(device.verificationUri).catch((error) => {
                    toast.error(
                      error instanceof Error ? error.message : "Could not open GitHub.",
                    );
                  })
                }
              >
                Open GitHub
              </Button>
            </div>
            <p className="mt-1.5 flex items-center gap-1.5 text-[8px] text-muted-foreground">
              <Loader2 className="size-2.5 animate-spin" />
              Waiting for you to approve the request. The code expires in{" "}
              {Math.round(device.expiresIn / 60)} minutes.
            </p>
            <button
              type="button"
              onClick={() => setDevice(null)}
              className="mt-1 text-[8px] text-muted-foreground underline underline-offset-2 hover:text-foreground"
            >
              Cancel
            </button>
          </div>
        ) : (
          <div className="space-y-2">
            <Button
              size="sm"
              className="h-8 rounded-lg text-[10px]"
              disabled={busy}
              onClick={() => void connect()}
            >
              {busy ? <Loader2 className="size-3.5 animate-spin" /> : <GitBranch className="size-3.5" />}
              Connect GitHub
            </Button>
            <p className="text-[8px] leading-relaxed text-muted-foreground">
              {status.data.mode === "oauth"
                ? "You'll approve access on GitHub, then come straight back here. Repository read and write access is requested so sync can push."
                : "Uses GitHub's device flow: you get a short code, approve it on github.com, and no callback URL or client secret is needed."}
            </p>
            <p className="text-[8px] leading-relaxed text-muted-foreground">
              Prefer not to connect? The import and sync dialogs still accept a one-off personal
              access token.
            </p>
          </div>
        )}
      </div>
    </div>
  );
}
