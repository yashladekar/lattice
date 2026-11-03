import {
  capabilityForMethod,
  isGranted,
  type Capability,
  type PluginRecord,
} from "@notes-learning/domain";

const MAX_LOGS = 200;
const DEFAULT_TIMEOUT_MS = 5000;

/**
 * Runs inside the worker before any plugin code.
 *
 * Two jobs: provide the message-passing API the plugin calls, and take away
 * the ambient powers a worker would otherwise have. Without this a plugin
 * could simply `fetch` — or open IndexedDB and read the workspace directly —
 * and no capability check would matter.
 */
const WORKER_RUNTIME = `
// Assigning to these globals is not enough: several are read-only accessors on
// the worker prototype, so a plain \`self.indexedDB = undefined\` is silently
// ignored and the plugin keeps direct access to the workspace database.
function drop(name, replacement) {
  try {
    Object.defineProperty(self, name, { value: replacement, configurable: true, writable: true });
  } catch (error) {
    try { delete self[name]; } catch (ignored) {}
  }
}

drop("indexedDB", undefined);
drop("caches", undefined);
drop("XMLHttpRequest", undefined);
drop("WebSocket", undefined);
drop("EventSource", undefined);
drop("BroadcastChannel", undefined);
drop("Worker", undefined);
drop("SharedWorker", undefined);
drop("fetch", function () { return Promise.reject(new Error("Plugins have no network access.")); });
drop("importScripts", function () { throw new Error("Plugins cannot load other scripts."); });
drop("navigator", { userAgent: "lattice-plugin", sendBeacon: undefined });

const pending = new Map();
let nextId = 1;

function call(method, payload) {
  const id = nextId++;
  return new Promise(function (resolve, reject) {
    pending.set(id, { resolve: resolve, reject: reject });
    self.postMessage({ kind: "call", id: id, method: method, payload: payload });
  });
}

const ctx = {
  readPage: function () { return call("readPage"); },
  writePage: function (markdown) { return call("writePage", markdown); },
  createPage: function (input) { return call("createPage", input); },
  readGraph: function () { return call("readGraph"); },
  search: function (query) { return call("search", query); },
  askAi: function (prompt) { return call("askAi", prompt); },
  getItem: function (key) { return call("getItem", key); },
  setItem: function (key, value) { return call("setItem", { key: key, value: value }); },
  log: function (message) { self.postMessage({ kind: "log", message: String(message) }); }
};

self.addEventListener("message", function (event) {
  const data = event.data || {};
  if (data.kind === "response") {
    const entry = pending.get(data.id);
    if (!entry) return;
    pending.delete(data.id);
    if (data.error) entry.reject(new Error(data.error)); else entry.resolve(data.value);
    return;
  }
  if (data.kind === "run") {
    if (typeof run !== "function") {
      self.postMessage({ kind: "failed", error: "This plugin does not define run(ctx)." });
      return;
    }
    Promise.resolve()
      .then(function () { return run(ctx); })
      .then(function (value) { self.postMessage({ kind: "done", value: value }); })
      .catch(function (error) {
        self.postMessage({ kind: "failed", error: String((error && error.message) || error) });
      });
  }
});
`;

export interface PluginRunResult {
  ok: boolean;
  value?: unknown;
  error?: string;
  logs: string[];
  /** Capabilities the plugin reached for and was not allowed to use. */
  denied: Capability[];
  durationMs: number;
}

export type PluginHandlers = Partial<
  Record<Capability, (payload: unknown, method: string) => unknown | Promise<unknown>>
>;

export interface PluginRunOptions {
  source: string;
  record: Pick<PluginRecord, "granted" | "enabled">;
  handlers: PluginHandlers;
  timeoutMs?: number;
}

/**
 * Executes a plugin in a worker and answers its calls only when the manifest
 * granted the matching capability. Enforcement is here, on the trusted side,
 * so the worker never decides what it is allowed to do.
 */
export function runPlugin(options: PluginRunOptions): Promise<PluginRunResult> {
  const started = Date.now();
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const logs: string[] = [];
  const denied = new Set<Capability>();

  return new Promise<PluginRunResult>((resolve) => {
    let settled = false;
    let worker: Worker | null = null;
    let url: string | null = null;

    const finish = (result: Omit<PluginRunResult, "durationMs" | "logs" | "denied">) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      worker?.terminate();
      if (url) URL.revokeObjectURL(url);
      resolve({ ...result, logs, denied: [...denied], durationMs: Date.now() - started });
    };

    const timer = setTimeout(() => {
      finish({ ok: false, error: `Timed out after ${timeoutMs}ms.` });
    }, timeoutMs);

    try {
      const blob = new Blob([`${WORKER_RUNTIME}\n${options.source}`], {
        type: "text/javascript",
      });
      url = URL.createObjectURL(blob);
      worker = new Worker(url);
    } catch (error) {
      finish({ ok: false, error: error instanceof Error ? error.message : "Could not start the plugin." });
      return;
    }

    worker.onerror = (event) => {
      finish({ ok: false, error: event.message || "The plugin threw while loading." });
    };

    worker.onmessage = (event: MessageEvent) => {
      const data = event.data as
        | { kind: "call"; id: number; method: string; payload?: unknown }
        | { kind: "log"; message: string }
        | { kind: "done"; value?: unknown }
        | { kind: "failed"; error?: string };
      if (!data || typeof data !== "object") return;

      if (data.kind === "log") {
        if (logs.length < MAX_LOGS) logs.push(data.message);
        return;
      }

      if (data.kind === "done") {
        finish({ ok: true, value: data.value });
        return;
      }

      if (data.kind === "failed") {
        finish({ ok: false, error: data.error ?? "The plugin failed." });
        return;
      }

      if (data.kind === "call") {
        const capability = capabilityForMethod(data.method);
        const reply = (message: { value?: unknown; error?: string }) =>
          worker?.postMessage({ kind: "response", id: data.id, ...message });

        if (!capability) {
          reply({ error: `"${data.method}" is not part of the plugin API.` });
          return;
        }
        if (!isGranted(options.record, capability)) {
          denied.add(capability);
          reply({ error: `Permission denied: this plugin was not granted ${capability}.` });
          return;
        }
        const handler = options.handlers[capability];
        if (!handler) {
          reply({ error: `${capability} is not available here.` });
          return;
        }
        void Promise.resolve()
          .then(() => handler(data.payload, data.method))
          .then((value) => reply({ value }))
          .catch((error: unknown) =>
            reply({ error: error instanceof Error ? error.message : "That call failed." }),
          );
      }
    };

    worker.postMessage({ kind: "run" });
  });
}
