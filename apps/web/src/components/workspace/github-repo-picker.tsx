"use client";

import { cn } from "@notes-learning/ui/lib/utils";
import { useQuery } from "@tanstack/react-query";
import { Lock, Search } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";

import { useAppData } from "@/components/app-data-provider";
import { client } from "@/utils/orpc";

export interface GithubRepository {
  fullName: string;
  private: boolean;
  defaultBranch: string;
  description: string | null;
  pushedAt: string | null;
}

/**
 * Vercel-style repository picker: one input that accepts typing and, while a
 * GitHub account is connected, suggests the repositories that account can
 * reach. Typing stays available so a repository outside the first page of
 * results is still reachable.
 */
export function GithubRepoPicker({
  value,
  onChange,
  onSelect,
  connected,
  autoFocus,
}: {
  value: string;
  onChange: (value: string) => void;
  onSelect?: (repo: GithubRepository) => void;
  connected: boolean;
  autoFocus?: boolean;
}) {
  const { user, online } = useAppData();
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState("");
  const containerRef = useRef<HTMLDivElement>(null);

  const repos = useQuery({
    queryKey: ["github-repos", user?.id],
    queryFn: async () => client.github.repos(),
    enabled: online && connected,
    staleTime: 5 * 60_000,
    retry: false,
  });

  useEffect(() => {
    if (!open) return;
    const onPointerDown = (event: MouseEvent) => {
      if (!containerRef.current?.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", onPointerDown);
    return () => document.removeEventListener("mousedown", onPointerDown);
  }, [open]);

  const options = useMemo(() => {
    const list = repos.data?.repos ?? [];
    const needle = search.trim().toLowerCase();
    if (!needle) return list;
    return list.filter(
      (repo) =>
        repo.fullName.toLowerCase().includes(needle) ||
        (repo.description ?? "").toLowerCase().includes(needle),
    );
  }, [repos.data, search]);

  const choose = (repo: GithubRepository) => {
    onChange(repo.fullName);
    onSelect?.(repo);
    setOpen(false);
    setSearch("");
  };

  return (
    <div ref={containerRef} className="relative">
      <input
        value={value}
        onChange={(event) => {
          onChange(event.target.value);
          setSearch(event.target.value);
          if (connected) setOpen(true);
        }}
        onFocus={() => {
          if (!connected) return;
          setSearch(value);
          setOpen(true);
        }}
        placeholder={connected ? "Search your repositories" : "owner/repository"}
        spellCheck={false}
        autoFocus={autoFocus}
        className="h-9 w-full rounded-lg border border-border bg-background px-2.5 font-mono text-[12px] outline-none focus:border-primary/40"
      />

      {connected && open ? (
        <div className="absolute z-50 mt-1 max-h-64 w-full overflow-y-auto rounded-lg border border-border bg-popover shadow-lg">
          {repos.isLoading ? (
            <div className="px-2.5 py-2 text-[10px] text-muted-foreground">
              Loading repositories…
            </div>
          ) : repos.isError ? (
            <div className="px-2.5 py-2 text-[10px] text-muted-foreground">
              Could not list repositories. Type the name instead.
            </div>
          ) : options.length ? (
            options.map((repo) => (
              <button
                key={repo.fullName}
                type="button"
                onClick={() => choose(repo)}
                className={cn(
                  "flex w-full items-center gap-2 border-b border-border/40 px-2.5 py-1.5 text-left last:border-0 hover:bg-muted/60",
                  repo.fullName === value && "bg-muted/40",
                )}
              >
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-1.5">
                    <span className="truncate font-mono text-[10.5px]">{repo.fullName}</span>
                    {repo.private ? <Lock className="size-2.5 text-muted-foreground" /> : null}
                  </div>
                  {repo.description ? (
                    <div className="truncate text-[8.5px] text-muted-foreground">
                      {repo.description}
                    </div>
                  ) : null}
                </div>
                <span className="shrink-0 text-[8px] text-muted-foreground">
                  {repo.defaultBranch}
                </span>
              </button>
            ))
          ) : (
            <div className="flex items-center gap-1.5 px-2.5 py-2 text-[10px] text-muted-foreground">
              <Search className="size-3" />
              No repository matches that search.
            </div>
          )}
        </div>
      ) : null}
    </div>
  );
}
