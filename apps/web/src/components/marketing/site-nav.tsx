"use client";

import { Button } from "@notes-learning/ui/components/button";
import { Globe, Menu, X } from "lucide-react";
import Link from "next/link";
import { useState } from "react";

import { authClient } from "@/lib/auth-client";
import { getDocsUrl } from "@/lib/config";

import { LatticeLogo } from "../brand/logo";
import { ModeToggle } from "../mode-toggle";

export function SiteNav() {
  const { data: session, isPending } = authClient.useSession();
  const [open, setOpen] = useState(false);
  const signedIn = Boolean(session?.user);

  const links = [
    { href: "#product", label: "Product" },
    { href: "#verbs", label: "Philosophy" },
    { href: "#local-first", label: "Local-first" },
    { href: getDocsUrl(), label: "Docs", external: true },
  ];

  return (
    <header className="relative z-40">
      <div className="mx-auto flex h-16 max-w-6xl items-center justify-between px-5">
        <LatticeLogo />
        <nav className="hidden items-center gap-7 text-[13px] text-muted-foreground md:flex">
          {links.map((link) =>
            link.external ? (
              <a
                key={link.href}
                href={link.href}
                target="_blank"
                rel="noreferrer"
                className="transition-colors hover:text-foreground"
              >
                {link.label}
              </a>
            ) : (
              <Link
                key={link.href}
                href={link.href}
                className="transition-colors hover:text-foreground"
              >
                {link.label}
              </Link>
            ),
          )}
        </nav>
        <div className="hidden items-center gap-2 md:flex">
          <ModeToggle />
          <Button
            variant="ghost"
            className="h-9 rounded-lg px-3 text-[13px]"
            render={<Link href={signedIn ? "/app" : "/login"} />}
          >
            {isPending ? "…" : signedIn ? "Open workspace" : "Sign in"}
          </Button>
          <Button
            className="h-9 rounded-lg px-3.5 text-[13px]"
            render={<Link href={signedIn ? "/app" : "/login?mode=signup"} />}
          >
            {signedIn ? "Continue" : "Start free"}
          </Button>
        </div>
        <button
          type="button"
          aria-label="Toggle navigation"
          className="grid size-9 place-items-center rounded-lg border border-border md:hidden"
          onClick={() => setOpen((value) => !value)}
        >
          {open ? <X className="size-4" /> : <Menu className="size-4" />}
        </button>
      </div>
      {open ? (
        <div className="mx-5 rounded-xl border border-border bg-card p-3 shadow-lg md:hidden">
          <div className="grid gap-1">
            {links.map((link) => (
              <Link
                key={link.href}
                href={link.href}
                onClick={() => setOpen(false)}
                className="rounded-md px-3 py-2 text-sm hover:bg-muted"
              >
                {link.label}
              </Link>
            ))}
            <div className="mt-2 flex items-center gap-2 border-t border-border pt-3">
              <ModeToggle />
              <Button
                className="flex-1 rounded-lg"
                render={<Link href={signedIn ? "/app" : "/login"} />}
              >
                {signedIn ? "Open workspace" : "Sign in"}
              </Button>
            </div>
          </div>
        </div>
      ) : null}
    </header>
  );
}

export function TinyGithubLink() {
  return (
    <a
      href="https://github.com"
      target="_blank"
      rel="noreferrer"
      className="inline-flex items-center gap-1.5 text-xs text-muted-foreground transition-colors hover:text-foreground"
    >
      <Globe className="size-3.5" />
      Self-host the stack
    </a>
  );
}
