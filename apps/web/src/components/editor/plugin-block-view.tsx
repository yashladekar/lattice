"use client";

import { docToMarkdown, stripUnsafeHrefs } from "@notes-learning/domain";
import { Button } from "@notes-learning/ui/components/button";
import { NodeViewWrapper, type NodeViewProps } from "@tiptap/react";
import { Blocks, Loader2, RefreshCw, Trash2 } from "lucide-react";
import { useMemo, useState } from "react";
import { toast } from "sonner";

import { useAppData } from "@/components/app-data-provider";
import { useWorkspaceSearchIndex } from "@/hooks/use-local-data";
import { markdownToDoc } from "@/lib/github-import";
import { createPageLocal, savePageContentLocal } from "@/lib/local/repository";
import { searchWorkspaceIndex } from "@/lib/local/search-local";
import { runPluginCommand, useInstalledPlugins } from "@/lib/plugins";
import { client } from "@/utils/orpc";

import { useEditorPageInfo } from "./editor-page-context";
import { ReadOnlyDocument } from "./read-only-document";

function formatOutput(value: unknown): string {
  if (typeof value === "string") return value;
  if (value === null || value === undefined) return "";
  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return String(value);
  }
}

export function PluginBlockView({ node, updateAttributes, deleteNode }: NodeViewProps) {
  const { db, user, activeWorkspaceId } = useAppData();
  const pageInfo = useEditorPageInfo();
  const plugins = useInstalledPlugins();
  const searchIndex = useWorkspaceSearchIndex();
  const [busy, setBusy] = useState(false);
  const [input, setInput] = useState(() =>
    typeof node.attrs.input === "string" ? node.attrs.input : "",
  );

  const plugin = plugins.find((entry) => entry.manifest.id === node.attrs.pluginId) ?? null;
  const tool = plugin?.manifest.blocks?.find((entry) => entry.id === node.attrs.blockId) ?? null;
  const output = typeof node.attrs.output === "string" ? node.attrs.output : "";
  const error = typeof node.attrs.error === "string" ? node.attrs.error : "";
  const ranAt = typeof node.attrs.ranAt === "string" ? node.attrs.ranAt : "";

  const renderedDoc = useMemo(
    () => (tool?.output === "markdown" && output ? stripUnsafeHrefs(markdownToDoc(output)) : null),
    [tool?.output, output],
  );

  const run = async () => {
    if (!plugin || !tool) return;
    setBusy(true);
    try {
      updateAttributes({ input });
      const pageId = pageInfo?.pageId ?? null;
      const page = pageId && db ? await db.pages.get(pageId) : null;
      const document = pageId && db ? await db.pageDocuments.get(pageId) : null;
      const outcome = await runPluginCommand({
        plugin,
        input,
        tool: { id: tool.id, label: tool.label },
        page:
          page && document
            ? {
                pageId: page.id,
                title: page.title,
                text: document.plainText,
                markdown: docToMarkdown(document.content),
              }
            : null,
        search: (query) =>
          searchWorkspaceIndex(searchIndex, query, 20).map((hit) => ({
            title: hit.title,
            type: hit.type,
            snippet: hit.snippet,
          })),
        createPage: async ({ title, markdown }) => {
          if (!db || !user || !activeWorkspaceId) throw new Error("No workspace is active.");
          const created = await createPageLocal(db, {
            workspaceId: activeWorkspaceId,
            userId: user.id,
            notebookId: page?.notebookId ?? null,
            title,
            icon: "◆",
            content: markdownToDoc(markdown),
            properties: { source: "plugin" },
          });
          return { pageId: created.page.id, title };
        },
        writePage: async (markdown) => {
          if (!db || !user || !pageId) throw new Error("No page is open.");
          await savePageContentLocal(db, { pageId, content: markdownToDoc(markdown), userId: user.id });
          return true;
        },
        askAi: async (prompt) => client.ai.ask({ question: prompt }),
      });
      if (!outcome.ok) {
        updateAttributes({ error: outcome.error ?? "The plugin failed.", output: "", ranAt: new Date().toISOString() });
        toast.error(outcome.error ?? "The plugin failed.");
        return;
      }
      updateAttributes({
        output: formatOutput(outcome.value),
        error: "",
        ranAt: new Date().toISOString(),
      });
      if (outcome.denied.length) {
        toast.error(`${plugin.manifest.name} asked for something it was not granted.`);
      }
    } catch (caught) {
      const message = caught instanceof Error ? caught.message : "The plugin failed.";
      updateAttributes({ error: message, ranAt: new Date().toISOString() });
      toast.error(message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <NodeViewWrapper className="my-2" data-type="pluginBlock">
      <div
        className="rounded-xl border border-border/70 bg-card/40 p-2.5"
        contentEditable={false}
      >
        <div className="flex flex-wrap items-center gap-2">
          <Blocks className="size-3.5 text-moss" />
          <span className="text-[10px] font-medium">{tool?.label ?? "Plugin block"}</span>
          <span className="text-[8px] text-muted-foreground">
            {plugin?.manifest.name ?? node.attrs.pluginName ?? "Unknown plugin"}
          </span>
          <div className="ml-auto flex items-center gap-1">
            <Button
              variant="outline"
              size="sm"
              className="h-6 rounded-md text-[8px]"
              disabled={busy || !plugin || !tool}
              onClick={() => void run()}
            >
              {busy ? (
                <Loader2 className="size-2.5 animate-spin" />
              ) : output ? (
                <RefreshCw className="size-2.5" />
              ) : (
                <Blocks className="size-2.5" />
              )}{" "}
              {output ? "Refresh" : "Run"}
            </Button>
            <button
              type="button"
              aria-label="Remove plugin block"
              onClick={() => deleteNode()}
              className="grid size-5 place-items-center rounded text-muted-foreground/50 hover:bg-destructive/10 hover:text-destructive"
            >
              <Trash2 className="size-3" />
            </button>
          </div>
        </div>

        {tool?.description ? (
          <p className="mt-1 text-[8.5px] leading-relaxed text-muted-foreground">{tool.description}</p>
        ) : null}

        {!plugin || !tool ? (
          <p className="mt-2 rounded-lg border border-saffron/30 bg-saffron/[0.05] px-2 py-1.5 text-[9px] text-muted-foreground">
            This block&apos;s plugin is not installed or is disabled on this device. The stored output
            is kept below.
          </p>
        ) : (
          <input
            value={input}
            onChange={(event) => setInput(event.target.value)}
            onBlur={() => updateAttributes({ input })}
            placeholder="Optional input for this block"
            className="mt-2 h-7 w-full rounded-md border border-border/60 bg-background px-2 text-[10px] outline-none focus:border-primary/40"
          />
        )}

        {error ? (
          <p className="mt-2 rounded-lg border border-destructive/30 bg-destructive/[0.05] px-2 py-1.5 text-[9px] text-destructive">
            {error}
          </p>
        ) : null}

        {output ? (
          <div className="mt-2 rounded-lg border border-border/50 bg-background/50 px-2.5 py-2">
            {renderedDoc ? (
              <ReadOnlyDocument doc={renderedDoc} compact />
            ) : (
              <pre className="whitespace-pre-wrap break-words font-mono text-[10px] leading-relaxed">
                {output}
              </pre>
            )}
          </div>
        ) : !error ? (
          <p className="mt-2 text-[9px] text-muted-foreground">Not run yet.</p>
        ) : null}

        {ranAt ? (
          <p className="mt-1 text-[8px] text-muted-foreground/70">
            Last run {new Date(ranAt).toLocaleString()}
          </p>
        ) : null}
      </div>
    </NodeViewWrapper>
  );
}
