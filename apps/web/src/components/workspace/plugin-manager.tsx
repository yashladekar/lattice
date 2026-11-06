"use client";

import {
  CAPABILITIES,
  CAPABILITY_INFO,
  DIRECTORY_PLUGINS,
  describeRecord,
  docToMarkdown,
  highestRisk,
  initialGrant,
  validateManifest,
  type Capability,
  type DirectoryPlugin,
  type PluginManifest,
} from "@notes-learning/domain";
import { Button } from "@notes-learning/ui/components/button";
import { cn } from "@notes-learning/ui/lib/utils";
import { Boxes, Check, Download, Loader2, Play, Plus, ShieldAlert, Trash2 } from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";
import { toast } from "sonner";

import { useAppData } from "@/components/app-data-provider";
import { useWorkspacePages, useWorkspaceSearchIndex } from "@/hooks/use-local-data";
import { markdownToDoc } from "@/lib/github-import";
import { savePageContentLocal, createPageLocal } from "@/lib/local/repository";
import { searchWorkspaceIndex } from "@/lib/local/search-local";
import { runPlugin, type PluginHandlers, type PluginRunResult } from "@/lib/plugin-runtime";
import { client } from "@/utils/orpc";

const STORAGE_KEY = "lattice.plugins";
const DATA_PREFIX = "lattice.plugin.data.";

export interface StoredPlugin {
  manifest: PluginManifest;
  granted: Capability[];
  enabled: boolean;
  source: string;
  installedAt: string;
}

const SAMPLE = {
  manifest: {
    id: "com.lattice.sample.words",
    name: "Word count",
    version: "1.0.0",
    description: "Counts words on a page and reports the longest one.",
    permissions: ["page:read", "storage"],
  },
  source: `async function run(ctx) {
  const page = await ctx.readPage();
  if (!page) return "No page selected.";
  const words = page.text.split(/\\s+/).filter(Boolean);
  ctx.log("Read " + words.length + " words from " + page.title);
  await ctx.setItem("lastRun", page.title);
  const previous = await ctx.getItem("lastRun");
  const longest = words.reduce(function (longest, word) {
    return word.length > longest.length ? word : longest;
  }, "");
  return {
    words: words.length,
    characters: page.text.length,
    longest: longest,
    previousRun: previous,
  };
}`,
};

function load(): StoredPlugin[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as unknown;
    return Array.isArray(parsed) ? (parsed as StoredPlugin[]) : [];
  } catch {
    return [];
  }
}

function save(plugins: StoredPlugin[]) {
  window.localStorage.setItem(STORAGE_KEY, JSON.stringify(plugins));
}

function readData(pluginId: string): Record<string, unknown> {
  try {
    const raw = window.localStorage.getItem(`${DATA_PREFIX}${pluginId}`);
    return raw ? (JSON.parse(raw) as Record<string, unknown>) : {};
  } catch {
    return {};
  }
}

export function PluginManager() {
  const { db, user, activeWorkspaceId } = useAppData();
  const pages = useWorkspacePages();
  const searchIndex = useWorkspaceSearchIndex();
  const [plugins, setPlugins] = useState<StoredPlugin[]>([]);
  const [manifestText, setManifestText] = useState("");
  const [sourceText, setSourceText] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [remoteUrl, setRemoteUrl] = useState("");
  const [remoteBusy, setRemoteBusy] = useState(false);
  const [pendingRemote, setPendingRemote] = useState<{
    manifest: PluginManifest;
    source: string;
    url: string;
  } | null>(null);
  const [pageId, setPageId] = useState("");
  const [running, setRunning] = useState<string | null>(null);
  const [result, setResult] = useState<{ pluginId: string; run: PluginRunResult } | null>(null);

  useEffect(() => {
    setPlugins(load());
  }, []);

  useEffect(() => {
    if (!pageId && pages.length) setPageId(pages[0].id);
  }, [pages, pageId]);

  const update = (next: StoredPlugin[]) => {
    setPlugins(next);
    save(next);
  };

  const install = () => {
    setError(null);
    let parsed: unknown;
    try {
      parsed = JSON.parse(manifestText);
    } catch {
      setError("The manifest is not valid JSON.");
      return;
    }
    const validation = validateManifest(parsed);
    if (!validation.ok || !validation.manifest) {
      setError(validation.errors.join(" "));
      return;
    }
    if (!sourceText.trim()) {
      setError("The plugin source is empty.");
      return;
    }
    const manifest = validation.manifest;
    const next = plugins.filter((plugin) => plugin.manifest.id !== manifest.id);
    next.push({
      manifest,
      granted: initialGrant(manifest),
      enabled: true,
      source: sourceText,
      installedAt: new Date().toISOString(),
    });
    update(next);
    setManifestText("");
    setSourceText("");
    toast.success(`${manifest.name} installed with ${manifest.permissions.length} permissions.`);
  };

  const fetchRemotePlugin = async () => {
    setError(null);
    setPendingRemote(null);
    let url: URL;
    try {
      url = new URL(remoteUrl.trim());
    } catch {
      setError("Enter a full URL.");
      return;
    }
    if (url.protocol !== "https:") {
      setError("Plugins can only be installed over HTTPS.");
      return;
    }
    setRemoteBusy(true);
    try {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 10_000);
      let text: string;
      try {
        const response = await fetch(url, {
          signal: controller.signal,
          credentials: "omit",
          redirect: "error",
        });
        if (!response.ok) throw new Error(`The server returned ${response.status}.`);
        text = await response.text();
      } finally {
        clearTimeout(timeout);
      }
      if (text.length > 256 * 1024) throw new Error("The plugin bundle is larger than 256 KB.");
      let parsed: unknown;
      try {
        parsed = JSON.parse(text);
      } catch {
        throw new Error("The bundle is not valid JSON.");
      }
      const record = parsed as { manifest?: unknown; source?: unknown };
      const validation = validateManifest(record.manifest);
      if (!validation.ok || !validation.manifest) throw new Error(validation.errors.join(" "));
      if (typeof record.source !== "string" || !record.source.trim()) {
        throw new Error("The bundle has no plugin source.");
      }
      setPendingRemote({
        manifest: validation.manifest,
        source: record.source,
        url: url.toString(),
      });
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Could not fetch the plugin.");
    } finally {
      setRemoteBusy(false);
    }
  };

  const installPendingRemote = () => {
    if (!pendingRemote) return;
    const { manifest, source, url } = pendingRemote;
    const next = plugins.filter((plugin) => plugin.manifest.id !== manifest.id);
    next.push({
      manifest,
      granted: initialGrant(manifest),
      enabled: true,
      source,
      installedAt: new Date().toISOString(),
    });
    update(next);
    setPendingRemote(null);
    setRemoteUrl("");
    toast.success(`${manifest.name} installed from ${new URL(url).host}.`);
  };

  const installDirectoryPlugin = (entry: DirectoryPlugin) => {
    const next = plugins.filter((plugin) => plugin.manifest.id !== entry.manifest.id);
    next.push({
      manifest: entry.manifest,
      granted: initialGrant(entry.manifest),
      enabled: true,
      source: entry.source,
      installedAt: new Date().toISOString(),
    });
    update(next);
    toast.success(`${entry.manifest.name} installed.`);
  };

  const makeHandlers = useCallback(
    (pluginId: string): PluginHandlers => ({
      "page:read": async () => {
        if (!db || !pageId) return null;
        const page = await db.pages.get(pageId);
        const document = await db.pageDocuments.get(pageId);
        if (!page || !document) return null;
        return {
          pageId: page.id,
          title: page.title,
          text: document.plainText,
          markdown: docToMarkdown(document.content),
        };
      },
      "page:write": async (payload) => {
        if (!db || !user || !pageId) throw new Error("No page selected.");
        const markdown = String(payload ?? "");
        await savePageContentLocal(db, {
          pageId,
          content: markdownToDoc(markdown),
          userId: user.id,
        });
        return { pageId, characters: markdown.length };
      },
      "page:create": async (payload) => {
        if (!db || !user || !activeWorkspaceId) throw new Error("No workspace.");
        const input = (payload ?? {}) as { title?: string; markdown?: string };
        const title = String(input.title ?? "From a plugin");
        const created = await createPageLocal(db, {
          workspaceId: activeWorkspaceId,
          userId: user.id,
          notebookId: null,
          title,
          icon: "◆",
          content: markdownToDoc(String(input.markdown ?? "")),
          properties: { source: "plugin" },
        });
        return { pageId: created.page.id, title };
      },
      "graph:read": async () => {
        if (!db || !activeWorkspaceId) return { nodes: [], edges: [] };
        const [nodes, edges] = await Promise.all([
          db.nodes.where("workspaceId").equals(activeWorkspaceId).toArray(),
          db.edges.where("workspaceId").equals(activeWorkspaceId).toArray(),
        ]);
        return {
          nodes: nodes.filter((node) => !node.deletedAt).map((node) => ({ title: node.title, kind: node.kind })),
          edges: edges
            .filter((edge) => !edge.deletedAt)
            .map((edge) => ({ relation: edge.relationType, origin: edge.origin })),
        };
      },
      "search:read": async (payload) => {
        if (!pageId) return [];
        return searchWorkspaceIndex(searchIndex, String(payload ?? ""), 20).map((hit) => ({
          title: hit.title,
          type: hit.type,
          snippet: hit.snippet,
        }));
      },
      "ai:use": async (payload) => {
        const response = await client.ai.ask({ question: String(payload ?? "") });
        return response;
      },
      storage: async (payload, method) => {
        const data = readData(pluginId);
        if (method === "getItem") return data[String(payload)] ?? null;
        const { key, value } = (payload ?? {}) as { key?: string; value?: unknown };
        if (!key) throw new Error("setItem needs a key.");
        data[key] = value;
        window.localStorage.setItem(`${DATA_PREFIX}${pluginId}`, JSON.stringify(data));
        return true;
      },
    }),
    [db, user, activeWorkspaceId, pageId, searchIndex],
  );

  const runPluginOn = async (plugin: StoredPlugin) => {
    setRunning(plugin.manifest.id);
    setResult(null);
    try {
      const outcome = await runPlugin({
        source: plugin.source,
        record: { granted: plugin.granted, enabled: plugin.enabled },
        handlers: makeHandlers(plugin.manifest.id),
      });
      setResult({ pluginId: plugin.manifest.id, run: outcome });
      if (outcome.denied.length) {
        toast.error(`${plugin.manifest.name} asked for something it was not granted.`);
      }
    } finally {
      setRunning(null);
    }
  };

  const toggleCapability = (plugin: StoredPlugin, capability: Capability) => {
    const granted = plugin.granted.includes(capability)
      ? plugin.granted.filter((entry) => entry !== capability)
      : [...plugin.granted, capability];
    update(
      plugins.map((entry) =>
        entry.manifest.id === plugin.manifest.id ? { ...entry, granted } : entry,
      ),
    );
  };

  return (
    <div className="space-y-3">
      <div className="rounded-xl border border-border/70 bg-card/35 p-4">
        <div className="flex items-center gap-2">
          <Boxes className="size-3.5 text-muted-foreground" />
          <h3 className="text-[11px] font-medium">Plugins</h3>
          <span className="ml-auto text-[8.5px] text-muted-foreground">
            {plugins.length} installed · device only
          </span>
        </div>
        <p className="mt-1 text-[9px] leading-relaxed text-muted-foreground">
          Plugins run in a worker with no network and no access to the local database. Everything they
          touch goes through the permissions you grant below, and each page write is saved as a new
          revision.
        </p>
      </div>

      {plugins.map((plugin) => {
        const risk = highestRisk(plugin.granted);
        return (
          <div key={plugin.manifest.id} className="rounded-xl border border-border/70 bg-card/35 p-4">
            <div className="flex items-start gap-2">
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-1.5">
                  <span className="text-[11px] font-medium">{plugin.manifest.name}</span>
                  <span className="font-mono text-[8.5px] text-muted-foreground">
                    {plugin.manifest.version}
                  </span>
                  {risk === "high" ? (
                    <span className="inline-flex items-center gap-0.5 text-[8.5px] text-destructive">
                      <ShieldAlert className="size-2.5" /> high risk
                    </span>
                  ) : null}
                </div>
                <div className="text-[9px] text-muted-foreground">{plugin.manifest.description}</div>
                <div className="font-mono text-[8.5px] text-muted-foreground">{plugin.manifest.id}</div>
              </div>
              <Button
                variant="outline"
                size="sm"
                className="h-6 rounded-md text-[9px]"
                disabled={!plugin.enabled || Boolean(running)}
                onClick={() => void runPluginOn(plugin)}
              >
                {running === plugin.manifest.id ? (
                  <Loader2 className="size-3 animate-spin" />
                ) : (
                  <Play className="size-3" />
                )}
                Run
              </Button>
              <Button
                variant="ghost"
                size="sm"
                className="h-6 rounded-md text-[9px]"
                onClick={() =>
                  update(
                    plugins.map((entry) =>
                      entry.manifest.id === plugin.manifest.id
                        ? { ...entry, enabled: !entry.enabled }
                        : entry,
                    ),
                  )
                }
              >
                {plugin.enabled ? "Disable" : "Enable"}
              </Button>
              <Button
                variant="ghost"
                size="sm"
                className="h-6 rounded-md text-[9px] text-destructive"
                onClick={() =>
                  update(plugins.filter((entry) => entry.manifest.id !== plugin.manifest.id))
                }
              >
                <Trash2 className="size-3" />
              </Button>
            </div>

            <div className="mt-2 flex flex-wrap gap-1">
              {CAPABILITIES.map((capability) => {
                const asked = plugin.manifest.permissions.includes(capability);
                const granted = plugin.granted.includes(capability);
                return (
                  <button
                    key={capability}
                    type="button"
                    disabled={!plugin.enabled}
                    onClick={() => toggleCapability(plugin, capability)}
                    title={CAPABILITY_INFO[capability].description}
                    className={cn(
                      "rounded border px-1.5 py-0.5 font-mono text-[8.5px] transition-colors",
                      granted
                        ? CAPABILITY_INFO[capability].risk === "high"
                          ? "border-destructive/50 text-destructive"
                          : "border-primary/40 text-primary"
                        : "border-border/60 text-muted-foreground",
                      !asked && "opacity-50",
                    )}
                  >
                    {capability}
                    {asked ? "" : " (not requested)"}
                  </button>
                );
              })}
            </div>
            <p className="mt-1.5 text-[8.5px] text-muted-foreground">
              {describeRecord({ manifest: plugin.manifest, granted: plugin.granted, enabled: plugin.enabled })}
            </p>

            {result?.pluginId === plugin.manifest.id ? (
              <div className="mt-2 rounded-lg border border-border/60 bg-background/60 p-2.5">
                <div className="flex items-center gap-2 text-[9px]">
                  <span className={result.run.ok ? "text-moss" : "text-destructive"}>
                    {result.run.ok ? "Finished" : "Failed"}
                  </span>
                  <span className="text-muted-foreground">{result.run.durationMs}ms</span>
                  {result.run.denied.length ? (
                    <span className="text-destructive">
                      denied: {result.run.denied.join(", ")}
                    </span>
                  ) : null}
                </div>
                {result.run.error ? (
                  <p className="mt-1 font-mono text-[10px] text-destructive">{result.run.error}</p>
                ) : null}
                {result.run.value !== undefined ? (
                  <pre className="mt-1 overflow-x-auto font-mono text-[10px]">
                    {JSON.stringify(result.run.value, null, 2)}
                  </pre>
                ) : null}
                {result.run.logs.length ? (
                  <div className="mt-1 space-y-0.5">
                    {result.run.logs.map((line, index) => (
                      <div key={index} className="font-mono text-[9px] text-muted-foreground">
                        {line}
                      </div>
                    ))}
                  </div>
                ) : null}
              </div>
            ) : null}
          </div>
        );
      })}

      <div className="rounded-xl border border-border/70 bg-card/35 p-4">
        <h3 className="text-[11px] font-medium">Directory</h3>
        <p className="mt-1 text-[9px] text-muted-foreground">
          Small, audited plugins that ship with Lattice. They run in the same sandbox and ask for the
          same consent as anything from a URL.
        </p>
        <div className="mt-2 space-y-2">
          {DIRECTORY_PLUGINS.map((entry) => {
            const installed = plugins.some(
              (plugin) => plugin.manifest.id === entry.manifest.id,
            );
            return (
              <div
                key={entry.manifest.id}
                className="rounded-lg border border-border/60 bg-background/40 p-2.5"
              >
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <div className="text-[10px] font-medium">
                      {entry.manifest.name}{" "}
                      <span className="font-mono text-[8px] text-muted-foreground">
                        v{entry.manifest.version}
                      </span>
                    </div>
                    <p className="mt-0.5 text-[9px] leading-relaxed text-muted-foreground">
                      {entry.manifest.description}
                    </p>
                    <p className="mt-1 text-[8px] text-muted-foreground">
                      {describeRecord({
                        manifest: entry.manifest,
                        granted: initialGrant(entry.manifest),
                        enabled: true,
                      })}
                    </p>
                  </div>
                  <Button
                    size="sm"
                    variant={installed ? "outline" : "default"}
                    className="h-7 shrink-0 rounded-md text-[9px]"
                    disabled={installed}
                    onClick={() => installDirectoryPlugin(entry)}
                  >
                    {installed ? (
                      <>
                        <Check className="size-3" /> Installed
                      </>
                    ) : (
                      <>
                        <Plus className="size-3" /> Install
                      </>
                    )}
                  </Button>
                </div>
              </div>
            );
          })}
        </div>
      </div>

      <div className="rounded-xl border border-border/70 bg-card/35 p-4">
        <h3 className="text-[11px] font-medium">Install</h3>
        <p className="mt-1 text-[9px] text-muted-foreground">
          Only install code you trust. The sandbox withholds the network and the local database, but it
          is a containment boundary, not a defence against hostile code.
        </p>

        <div className="mt-3 rounded-lg border border-border/60 bg-background/40 p-2.5">
          <div className="text-[9px] uppercase tracking-[0.12em] text-muted-foreground">
            Install from URL
          </div>
          <div className="mt-1.5 flex gap-1.5">
            <input
              value={remoteUrl}
              onChange={(event) => setRemoteUrl(event.target.value)}
              placeholder="https://example.com/lattice-plugin.json"
              spellCheck={false}
              aria-label="Plugin bundle URL"
              className="h-8 min-w-0 flex-1 rounded-md border border-border bg-background px-2 font-mono text-[10px] outline-none focus:border-primary/40"
            />
            <Button
              variant="outline"
              size="sm"
              className="h-8 rounded-md text-[9px]"
              disabled={remoteBusy || !remoteUrl.trim()}
              onClick={() => void fetchRemotePlugin()}
            >
              {remoteBusy ? <Loader2 className="size-3 animate-spin" /> : <Download className="size-3" />}{" "}
              Fetch
            </Button>
          </div>
          <p className="mt-1 text-[8px] leading-relaxed text-muted-foreground">
            Expects JSON: <span className="font-mono">{'{ "manifest": …, "source": … }'}</span>. HTTPS
            only, 256 KB maximum. Nothing installs until you review the requested permissions.
          </p>
          {pendingRemote ? (
            <div className="mt-2 rounded-md border border-saffron/40 bg-saffron/[0.06] p-2">
              <div className="text-[10px] font-medium">
                {pendingRemote.manifest.name}{" "}
                <span className="font-mono text-[8px] text-muted-foreground">
                  v{pendingRemote.manifest.version}
                </span>
              </div>
              <p className="mt-0.5 text-[9px] text-muted-foreground">
                {pendingRemote.manifest.description}
              </p>
              <div className="mt-1.5 space-y-1">
                {pendingRemote.manifest.permissions.length ? (
                  pendingRemote.manifest.permissions.map((capability) => (
                    <div key={capability} className="flex items-start gap-1.5 text-[8.5px]">
                      <ShieldAlert className="mt-0.5 size-2.5 shrink-0 text-saffron" />
                      <span>
                        <span className="font-medium">{CAPABILITY_INFO[capability].label}</span> —{" "}
                        {CAPABILITY_INFO[capability].description}
                      </span>
                    </div>
                  ))
                ) : (
                  <p className="text-[8.5px] text-muted-foreground">
                    Needs no access to your notes.
                  </p>
                )}
              </div>
              <div className="mt-1.5 flex items-center gap-2">
                <Button size="sm" className="h-7 rounded-md text-[9px]" onClick={installPendingRemote}>
                  Install with these permissions
                </Button>
                <button
                  type="button"
                  onClick={() => setPendingRemote(null)}
                  className="text-[8px] text-muted-foreground underline underline-offset-2 hover:text-foreground"
                >
                  Cancel
                </button>
              </div>
            </div>
          ) : null}
        </div>

        <label className="mt-2 block">
          <span className="mb-1 block text-[9px] uppercase tracking-[0.12em] text-muted-foreground">
            Manifest (JSON)
          </span>
          <textarea
            value={manifestText}
            onChange={(event) => setManifestText(event.target.value)}
            rows={5}
            spellCheck={false}
            aria-label="Plugin manifest"
            placeholder='{ "id": "com.you.plugin", "name": "…", "version": "1.0.0", "description": "…", "permissions": ["page:read"] }'
            className="w-full resize-y rounded-lg border border-border bg-background p-2.5 font-mono text-[10px] outline-none focus:border-primary/40"
          />
        </label>

        <label className="mt-2 block">
          <span className="mb-1 block text-[9px] uppercase tracking-[0.12em] text-muted-foreground">
            Source — define <span className="font-mono">async function run(ctx)</span>
          </span>
          <textarea
            value={sourceText}
            onChange={(event) => setSourceText(event.target.value)}
            rows={7}
            spellCheck={false}
            aria-label="Plugin source"
            placeholder="async function run(ctx) { return await ctx.readPage(); }"
            className="w-full resize-y rounded-lg border border-border bg-background p-2.5 font-mono text-[10px] outline-none focus:border-primary/40"
          />
        </label>

        {pages.length ? (
          <label className="mt-2 block">
            <span className="mb-1 block text-[9px] uppercase tracking-[0.12em] text-muted-foreground">
              Page used for a run
            </span>
            <select
              value={pageId}
              onChange={(event) => setPageId(event.target.value)}
              className="h-8 w-full rounded-lg border border-border bg-background px-2 text-[11px] outline-none focus:border-primary/40"
            >
              {pages.map((page) => (
                <option key={page.id} value={page.id}>
                  {page.title}
                </option>
              ))}
            </select>
          </label>
        ) : null}

        {error ? (
          <p className="mt-2 rounded-lg border border-destructive/30 bg-destructive/5 px-2.5 py-2 font-mono text-[10px] leading-relaxed text-destructive">
            {error}
          </p>
        ) : null}

        <div className="mt-2 flex items-center justify-between">
          <Button
            variant="ghost"
            size="sm"
            className="h-7 rounded-md text-[9px]"
            onClick={() => {
              setManifestText(JSON.stringify(SAMPLE.manifest, null, 2));
              setSourceText(SAMPLE.source);
              setError(null);
            }}
          >
            Load sample plugin
          </Button>
          <Button size="sm" className="h-7 rounded-md text-[9px]" onClick={install}>
            <Plus className="size-3" /> Install
          </Button>
        </div>
      </div>
    </div>
  );
}
