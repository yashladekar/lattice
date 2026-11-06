"use client";

import {
  isGranted,
  type Capability,
  type PluginCanvasTool,
  type PluginManifest,
  type PluginToolDefinition,
} from "@notes-learning/domain";
import { useEffect, useState } from "react";

import { runPlugin, type PluginHandlers, type PluginRunResult } from "./plugin-runtime";

export interface StoredPlugin {
  manifest: PluginManifest;
  granted: Capability[];
  enabled: boolean;
  source: string;
  installedAt: string;
}

const STORAGE_KEY = "lattice.plugins";
const DATA_PREFIX = "lattice.plugin.data.";
const CHANGE_EVENT = "lattice:plugins-changed";

export function loadPlugins(): StoredPlugin[] {
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

export function savePlugins(plugins: StoredPlugin[]): void {
  window.localStorage.setItem(STORAGE_KEY, JSON.stringify(plugins));
  window.dispatchEvent(new Event(CHANGE_EVENT));
}

export function readPluginData(pluginId: string): Record<string, unknown> {
  try {
    const raw = window.localStorage.getItem(`${DATA_PREFIX}${pluginId}`);
    return raw ? (JSON.parse(raw) as Record<string, unknown>) : {};
  } catch {
    return {};
  }
}

export function writePluginData(pluginId: string, data: Record<string, unknown>): void {
  window.localStorage.setItem(`${DATA_PREFIX}${pluginId}`, JSON.stringify(data));
}

export interface PluginBlockEntry {
  plugin: StoredPlugin;
  tool: PluginToolDefinition;
}

export interface PluginCanvasToolEntry {
  plugin: StoredPlugin;
  tool: PluginCanvasTool;
}

export function pluginBlockEntries(): PluginBlockEntry[] {
  return loadPlugins()
    .filter((plugin) => plugin.enabled)
    .flatMap((plugin) =>
      (plugin.manifest.blocks ?? []).map((tool) => ({ plugin, tool })),
    );
}

export function pluginCanvasToolEntries(): PluginCanvasToolEntry[] {
  return loadPlugins()
    .filter((plugin) => plugin.enabled)
    .flatMap((plugin) =>
      (plugin.manifest.canvasTools ?? []).map((tool) => ({ plugin, tool })),
    );
}

/** Plugins installed on this device, kept in sync across tabs. */
export function useInstalledPlugins(): StoredPlugin[] {
  const [plugins, setPlugins] = useState<StoredPlugin[]>([]);
  useEffect(() => {
    const sync = () => setPlugins(loadPlugins());
    sync();
    window.addEventListener(CHANGE_EVENT, sync);
    window.addEventListener("storage", sync);
    return () => {
      window.removeEventListener(CHANGE_EVENT, sync);
      window.removeEventListener("storage", sync);
    };
  }, []);
  return plugins;
}

export interface PluginHostContext {
  plugin: StoredPlugin;
  page?: { pageId: string; title: string; text: string; markdown: string } | null;
  /** Text the user typed into the plugin's block, if it was run from one. */
  input?: string | null;
  /** The block or canvas tool the run came from, so the plugin can branch. */
  tool?: { id: string; label: string } | null;
  canvas?: {
    title: string;
    nodes: Array<{ id: string; title: string; body?: string }>;
    edges: Array<{ from: string; to: string; label?: string }>;
  } | null;
  search?: (query: string) => unknown;
  createPage?: (input: { title: string; markdown: string }) => Promise<{ pageId: string; title: string }>;
  writePage?: (markdown: string) => Promise<unknown>;
  askAi?: (prompt: string) => Promise<unknown>;
}

/**
 * Runs a plugin with the context the caller can supply. Handlers exist only
 * for capabilities the record granted, so a plugin cannot reach beyond its
 * consent by being invoked from a new place.
 */
export async function runPluginCommand(context: PluginHostContext): Promise<PluginRunResult> {
  const { plugin } = context;
  const record = { granted: plugin.granted, enabled: plugin.enabled };
  const canvas = isGranted(record, "graph:read") ? (context.canvas ?? null) : null;

  const handlers: PluginHandlers = {
    "page:read": () => context.page ?? null,
    "page:write": async (payload) => {
      if (!context.writePage) throw new Error("page:write is not available here.");
      await context.writePage(String(payload ?? ""));
      return { characters: String(payload ?? "").length };
    },
    "page:create": async (payload) => {
      if (!context.createPage) throw new Error("page:create is not available here.");
      const input = (payload ?? {}) as { title?: unknown; markdown?: unknown };
      const title =
        typeof input.title === "string" && input.title.trim()
          ? input.title.trim().slice(0, 120)
          : "From a plugin";
      const markdown = typeof input.markdown === "string" ? input.markdown : "";
      return context.createPage({ title, markdown });
    },
    "graph:read": () => canvas ?? { nodes: [], edges: [] },
    "search:read": async (payload) => {
      if (!context.search) throw new Error("search:read is not available here.");
      return context.search(String(payload ?? ""));
    },
    "ai:use": async (payload) => {
      if (!context.askAi) throw new Error("ai:use is not available here.");
      return context.askAi(String(payload ?? ""));
    },
    storage: async (payload, method) => {
      const data = readPluginData(plugin.manifest.id);
      if (method === "getItem") return data[String(payload)] ?? null;
      const { key, value } = (payload ?? {}) as { key?: string; value?: unknown };
      if (!key) throw new Error("setItem needs a key.");
      data[key] = value;
      writePluginData(plugin.manifest.id, data);
      return true;
    },
  };

  return runPlugin({
    source: plugin.source,
    record,
    handlers,
    context: { input: context.input ?? null, canvas, tool: context.tool ?? null },
  });
}
