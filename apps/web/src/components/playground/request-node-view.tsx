"use client";

import { cn } from "@notes-learning/ui/lib/utils";
import { NodeViewWrapper, type NodeViewProps } from "@tiptap/react";
import { ChevronDown, ChevronRight, Play, RotateCcw, Trash2 } from "lucide-react";
import { useMemo, useState } from "react";

const METHODS = ["GET", "POST", "PUT", "PATCH", "DELETE", "HEAD"] as const;

interface RequestResponse {
  status: number;
  statusText: string;
  durationMs: number;
  bytes: number;
  headers: Array<[string, string]>;
  body: string;
  isJson: boolean;
}

const SAMPLE = `Accept: application/json`;

export function parseHeaderLines(text: string): Record<string, string> {
  const headers: Record<string, string> = {};
  for (const line of text.split("\n")) {
    const index = line.indexOf(":");
    if (index <= 0) continue;
    const key = line.slice(0, index).trim();
    const value = line.slice(index + 1).trim();
    if (key) headers[key] = value;
  }
  return headers;
}

function prettyBody(text: string, contentType: string | null): { body: string; isJson: boolean } {
  const looksJson = contentType?.includes("application/json") ?? false;
  if (!looksJson) return { body: text, isJson: false };
  try {
    return { body: JSON.stringify(JSON.parse(text), null, 2), isJson: true };
  } catch {
    return { body: text, isJson: false };
  }
}

function statusTone(status: number): string {
  if (status >= 200 && status < 300) return "border-moss/40 bg-moss/10 text-moss";
  if (status >= 300 && status < 400) return "border-sky/40 bg-sky/10 text-sky";
  if (status >= 400 && status < 500) return "border-saffron/50 bg-saffron/10 text-saffron";
  return "border-destructive/40 bg-destructive/10 text-destructive";
}

export function RequestNodeView({ node, updateAttributes, selected }: NodeViewProps) {
  const method = typeof node.attrs.method === "string" ? node.attrs.method : "GET";
  const url = typeof node.attrs.url === "string" ? node.attrs.url : "";
  const headersText = typeof node.attrs.headers === "string" ? node.attrs.headers : "";
  const bodyText = typeof node.attrs.body === "string" ? node.attrs.body : "";
  const label = typeof node.attrs.label === "string" ? node.attrs.label : "";

  const [response, setResponse] = useState<RequestResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [sending, setSending] = useState(false);
  const [expanded, setExpanded] = useState(false);
  const [showHeaders, setShowHeaders] = useState(false);

  const hasBody = method !== "GET" && method !== "HEAD";
  const summary = useMemo(() => {
    if (!url) return "No request configured";
    try {
      const parsed = new URL(url);
      return `${method} ${parsed.host}${parsed.pathname}`;
    } catch {
      return `${method} ${url}`;
    }
  }, [method, url]);

  const send = async () => {
    if (!url.trim() || sending) return;
    setSending(true);
    setError(null);
    setResponse(null);
    const started = performance.now();
    try {
      const headers = parseHeaderLines(headersText);
      const res = await fetch(url.trim(), {
        method,
        headers,
        body: hasBody && bodyText.trim() ? bodyText : undefined,
      });
      const text = await res.text();
      const durationMs = Math.round(performance.now() - started);
      const pretty = prettyBody(text, res.headers.get("content-type"));
      setResponse({
        status: res.status,
        statusText: res.statusText,
        durationMs,
        bytes: new Blob([text]).size,
        headers: [...res.headers.entries()],
        body: pretty.body,
        isJson: pretty.isJson,
      });
    } catch (reason) {
      const message = reason instanceof Error ? reason.message : "Request failed";
      setError(
        `${message}. A browser can only call endpoints that allow cross-origin requests (CORS).`,
      );
    } finally {
      setSending(false);
    }
  };

  return (
    <NodeViewWrapper
      className={cn(
        "my-4 overflow-hidden rounded-xl border border-border/80 bg-card/50",
        selected && "ring-2 ring-primary/40",
      )}
    >
      <div className="flex items-center gap-2 border-b border-border/60 px-3 py-1.5" data-drag-handle>
        <span className="text-[9px] uppercase tracking-[0.14em] text-muted-foreground">
          API request
        </span>
        <span className="truncate text-[9px] text-muted-foreground/70">{summary}</span>
        <button
          type="button"
          onClick={() => setExpanded((value) => !value)}
          className="ml-auto grid size-7 place-items-center rounded text-muted-foreground hover:bg-muted hover:text-foreground tap-target"
          title={expanded ? "Collapse request" : "Edit request"}
        >
          {expanded ? <ChevronDown className="size-3" /> : <ChevronRight className="size-3" />}
        </button>
      </div>

      <div className="flex items-center gap-1.5 border-b border-border/60 px-2.5 py-2">
        <select
          value={method}
          onChange={(event) => updateAttributes({ method: event.target.value })}
          className="h-7 rounded-md border border-border bg-background px-1.5 font-mono text-[10px] outline-none focus:border-primary/40"
        >
          {METHODS.map((value) => (
            <option key={value} value={value}>
              {value}
            </option>
          ))}
        </select>
        <input
          value={url}
          onChange={(event) => updateAttributes({ url: event.target.value })}
          onKeyDown={(event) => {
            if (event.key === "Enter") {
              event.preventDefault();
              void send();
            }
          }}
          placeholder="https://api.example.com/health"
          spellCheck={false}
          autoCapitalize="off"
          autoCorrect="off"
          className="h-7 min-w-0 flex-1 rounded-md border border-border bg-background px-2 font-mono text-[10.5px] outline-none focus:border-primary/40"
        />
        <button
          type="button"
          onClick={() => void send()}
          disabled={!url.trim() || sending}
          className="inline-flex h-7 items-center gap-1 rounded-md bg-foreground px-2.5 text-[10px] font-medium text-background disabled:opacity-40"
        >
          <Play className="size-2.5" />
          {sending ? "Sending…" : "Send"}
        </button>
      </div>

      {expanded ? (
        <div className="grid gap-2 border-b border-border/60 px-2.5 py-2 sm:grid-cols-2">
          <label className="block">
            <span className="mb-1 block text-[8px] uppercase tracking-[0.12em] text-muted-foreground">
              Headers
            </span>
            <textarea
              value={headersText}
              onChange={(event) => updateAttributes({ headers: event.target.value })}
              placeholder={SAMPLE}
              spellCheck={false}
              rows={4}
              className="w-full resize-y rounded-md border border-border bg-background px-2 py-1.5 font-mono text-[10px] leading-relaxed outline-none focus:border-primary/40"
            />
          </label>
          <label className="block">
            <span className="mb-1 block text-[8px] uppercase tracking-[0.12em] text-muted-foreground">
              {hasBody ? "Body" : "Body (not sent for " + method + ")"}
            </span>
            <textarea
              value={bodyText}
              onChange={(event) => updateAttributes({ body: event.target.value })}
              disabled={!hasBody}
              placeholder='{ "hello": "world" }'
              spellCheck={false}
              rows={4}
              className="w-full resize-y rounded-md border border-border bg-background px-2 py-1.5 font-mono text-[10px] leading-relaxed outline-none focus:border-primary/40 disabled:opacity-50"
            />
          </label>
          <label className="block sm:col-span-2">
            <span className="mb-1 block text-[8px] uppercase tracking-[0.12em] text-muted-foreground">
              Caption
            </span>
            <input
              value={label}
              onChange={(event) => updateAttributes({ label: event.target.value })}
              placeholder="What does this endpoint do?"
              className="h-7 w-full rounded-md border border-border bg-background px-2 text-[10px] outline-none focus:border-primary/40"
            />
          </label>
        </div>
      ) : label ? (
        <p className="border-b border-border/60 px-3 py-1.5 text-[9.5px] text-muted-foreground">
          {label}
        </p>
      ) : null}

      {error ? (
        <div className="px-3 py-2.5">
          <p className="text-[10px] leading-relaxed text-destructive">{error}</p>
          <button
            type="button"
            onClick={() => setError(null)}
            className="mt-1 inline-flex items-center gap-1 text-[9px] text-muted-foreground hover:text-foreground"
          >
            <RotateCcw className="size-2.5" /> Dismiss
          </button>
        </div>
      ) : null}

      {response ? (
        <div>
          <div className="flex flex-wrap items-center gap-2 border-b border-border/60 px-3 py-1.5">
            <span
              className={cn(
                "rounded-full border px-1.5 py-0.5 font-mono text-[9px]",
                statusTone(response.status),
              )}
            >
              {response.status} {response.statusText}
            </span>
            <span className="text-[9px] text-muted-foreground">{response.durationMs} ms</span>
            <span className="text-[9px] text-muted-foreground">
              {response.bytes < 1024
                ? `${response.bytes} B`
                : `${(response.bytes / 1024).toFixed(1)} KB`}
            </span>
            <button
              type="button"
              onClick={() => setShowHeaders((value) => !value)}
              className="ml-auto text-[9px] text-muted-foreground hover:text-foreground"
            >
              {showHeaders ? "Hide headers" : "Show headers"}
            </button>
            <button
              type="button"
              onClick={() => setResponse(null)}
              title="Clear response"
              className="grid size-7 place-items-center rounded text-muted-foreground hover:bg-muted hover:text-foreground tap-target"
            >
              <Trash2 className="size-2.5" />
            </button>
          </div>
          {showHeaders ? (
            <div className="max-h-32 overflow-auto border-b border-border/60 bg-background/50 px-3 py-2">
              {response.headers.map(([key, value]) => (
                <div key={key} className="flex gap-2 py-px font-mono text-[9px]">
                  <span className="shrink-0 text-muted-foreground">{key}:</span>
                  <span className="break-all text-foreground/80">{value}</span>
                </div>
              ))}
            </div>
          ) : null}
          <pre className="max-h-72 overflow-auto bg-background/40 px-3 py-2 font-mono text-[10px] leading-relaxed">
            <code>{response.body || (response.isJson ? "{}" : "(empty body)")}</code>
          </pre>
        </div>
      ) : null}
    </NodeViewWrapper>
  );
}
