"use client";

import { Button } from "@notes-learning/ui/components/button";
import { cn } from "@notes-learning/ui/lib/utils";
import { Database, Loader2, Play, TableProperties } from "lucide-react";
import { useEffect, useMemo, useState } from "react";

import { useAppData } from "@/components/app-data-provider";
import { client } from "@/utils/orpc";

interface ConsoleView {
  name: string;
  description: string;
  columns: Array<{ name: string; type: string }>;
}

interface ConsoleResult {
  columns: string[];
  rows: Array<Record<string, unknown>>;
  rowCount: number;
  truncated: boolean;
  durationMs: number;
}

const STARTER = "select title, notebook, updated_at\nfrom pages\norder by updated_at desc\nlimit 20";

function renderCell(value: unknown): string {
  if (value === null || value === undefined) return "null";
  if (typeof value === "object") return JSON.stringify(value);
  return String(value);
}

export function SqlConsolePanel() {
  const { activeWorkspaceId } = useAppData();
  const [views, setViews] = useState<ConsoleView[]>([]);
  const [schemaError, setSchemaError] = useState<string | null>(null);
  const [sql, setSql] = useState(STARTER);
  const [result, setResult] = useState<ConsoleResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [running, setRunning] = useState(false);
  const [openView, setOpenView] = useState<string | null>(null);

  useEffect(() => {
    if (!activeWorkspaceId) return;
    let cancelled = false;
    void client.console
      .schema()
      .then((response) => {
        if (!cancelled) setViews(response.views);
      })
      .catch(() => {
        if (!cancelled) setSchemaError("Could not load the console schema.");
      });
    return () => {
      cancelled = true;
    };
  }, [activeWorkspaceId]);

  const run = async () => {
    setRunning(true);
    setError(null);
    try {
      const response = await client.console.run({ sql });
      if (response.ok) {
        setResult(response.result);
      } else {
        setError(response.error);
        setResult(null);
      }
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Query failed.");
      setResult(null);
    } finally {
      setRunning(false);
    }
  };

  const hint = useMemo(() => {
    if (!result) return `${views.length} views available`;
    return `${result.rowCount} row${result.rowCount === 1 ? "" : "s"} · ${result.durationMs}ms${
      result.truncated ? " · capped" : ""
    }`;
  }, [result, views.length]);

  return (
    <div className="space-y-3">
      <div className="rounded-xl border border-border/70 bg-card/35 p-4">
        <div className="flex items-center gap-2">
          <Database className="size-3.5 text-muted-foreground" />
          <h3 className="text-[11px] font-medium">Query</h3>
          <span className="ml-auto text-[8.5px] text-muted-foreground">
            Read-only · scoped to this workspace
          </span>
        </div>
        <p className="mt-1 text-[9px] leading-relaxed text-muted-foreground">
          SELECT over the console views below. Queries run in a read-only transaction with a 4s
          limit and a 500-row cap, so nothing here can change your data.
        </p>

        <textarea
          value={sql}
          onChange={(event) => setSql(event.target.value)}
          onKeyDown={(event) => {
            if ((event.metaKey || event.ctrlKey) && event.key === "Enter") {
              event.preventDefault();
              void run();
            }
          }}
          spellCheck={false}
          rows={6}
          aria-label="SQL query"
          className="mt-3 w-full resize-y rounded-lg border border-border bg-background p-2.5 font-mono text-[11px] leading-relaxed outline-none focus:border-primary/40"
        />

        <div className="mt-2 flex items-center justify-between gap-2">
          <span className="text-[8.5px] text-muted-foreground">{hint} · ⌘↵ to run</span>
          <div className="flex items-center gap-2">
            <Button
              variant="ghost"
              size="sm"
              className="h-7 rounded-md text-[9px]"
              onClick={() => {
                setSql(STARTER);
                setResult(null);
                setError(null);
              }}
            >
              Reset
            </Button>
            <Button
              size="sm"
              className="h-7 rounded-md text-[9px]"
              disabled={running || !sql.trim()}
              onClick={() => void run()}
            >
              {running ? <Loader2 className="size-3 animate-spin" /> : <Play className="size-3" />}
              Run
            </Button>
          </div>
        </div>

        {error ? (
          <p className="mt-2 rounded-lg border border-destructive/30 bg-destructive/5 px-2.5 py-2 font-mono text-[10px] leading-relaxed text-destructive">
            {error}
          </p>
        ) : null}
      </div>

      {result ? (
        <div className="overflow-hidden rounded-xl border border-border/70 bg-card/35">
          <div className="flex items-center gap-2 border-b border-border/60 px-4 py-2">
            <TableProperties className="size-3 text-muted-foreground" />
            <span className="text-[10px] font-medium">Result</span>
            <span className="ml-auto text-[8.5px] text-muted-foreground">
              {result.rowCount} rows{result.truncated ? " (capped at 500)" : ""}
            </span>
          </div>
          {result.rows.length ? (
            <div className="max-h-80 overflow-auto">
              <table className="w-full border-collapse text-left font-mono text-[10px]">
                <thead className="sticky top-0 bg-card">
                  <tr>
                    {result.columns.map((column) => (
                      <th
                        key={column}
                        className="whitespace-nowrap border-b border-border/60 px-2.5 py-1.5 font-medium text-muted-foreground"
                      >
                        {column}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {result.rows.map((row, index) => (
                    <tr key={index} className="border-b border-border/30 last:border-0">
                      {result.columns.map((column) => (
                        <td
                          key={column}
                          className="max-w-[22rem] truncate px-2.5 py-1.5 align-top"
                          title={renderCell(row[column])}
                        >
                          {renderCell(row[column])}
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <p className="px-4 py-3 text-[9px] text-muted-foreground">No rows.</p>
          )}
        </div>
      ) : null}

      <div className="rounded-xl border border-border/70 bg-card/35 p-4">
        <h3 className="text-[11px] font-medium">Views</h3>
        {schemaError ? (
          <p className="mt-2 text-[9px] text-destructive">{schemaError}</p>
        ) : (
          <p className="mt-1 text-[9px] text-muted-foreground">
            These names are the only tables you can select from.
          </p>
        )}
        <div className="mt-2 space-y-1">
          {views.map((view) => (
            <div key={view.name} className="rounded-lg border border-border/60">
              <button
                type="button"
                onClick={() => setOpenView(openView === view.name ? null : view.name)}
                className="flex w-full items-center gap-2 px-2.5 py-1.5 text-left"
              >
                <span className="font-mono text-[10px]">{view.name}</span>
                <span className="truncate text-[8.5px] text-muted-foreground">{view.description}</span>
                <span className="ml-auto text-[8px] text-muted-foreground">{view.columns.length}</span>
              </button>
              {openView === view.name ? (
                <div className="flex flex-wrap gap-1 border-t border-border/60 px-2.5 py-2">
                  {view.columns.map((column) => (
                    <span
                      key={column.name}
                      className={cn(
                        "rounded border border-border/60 px-1.5 py-0.5 font-mono text-[8.5px]",
                        "text-muted-foreground",
                      )}
                      title={column.type}
                    >
                      {column.name}
                    </span>
                  ))}
                </div>
              ) : null}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
