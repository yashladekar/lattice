import type { AppRouterClient } from "@notes-learning/api/routers/index";
import { createORPCClient } from "@orpc/client";
import { RPCLink } from "@orpc/client/fetch";
import { createTanstackQueryUtils } from "@orpc/tanstack-query";
import { QueryCache, QueryClient } from "@tanstack/react-query";
import { Platform } from "react-native";

import { authClient } from "@/lib/auth-client";
import { SERVER_URL } from "@/lib/server-url";
import { appStorage } from "@/lib/storage";

export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      // Keep queries in cache long enough to survive a persistence restore, so
      // recent pages, notebooks, and decks render offline.
      gcTime: 7 * 24 * 60 * 60 * 1000,
    },
  },
  queryCache: new QueryCache({
    onError: (error) => {
      console.log(error);
    },
  }),
});

let activeWorkspaceId: string | null = null;

export function setWorkspaceHeader(workspaceId: string | null): void {
  activeWorkspaceId = workspaceId;
}

async function expoFetch(request: Request, init?: RequestInit) {
  const fetchImpl =
    Platform.OS === "web" ? globalThis.fetch : (await import("expo/fetch")).fetch;

  return fetchImpl(request.url, {
    body: await request.blob(),
    headers: request.headers,
    method: request.method,
    signal: request.signal,
    ...init,
  });
}

export const link = new RPCLink({
  url: `${SERVER_URL}/rpc`,
  fetch(request, init) {
    return expoFetch(request, {
      ...init,
      // Better Auth Expo forwards the session cookie manually on native.
      credentials: Platform.OS === "web" ? "include" : "omit",
    });
  },
  async headers() {
    const headers = new Map<string, string>();
    let workspaceId = activeWorkspaceId;
    if (!workspaceId) {
      workspaceId = await appStorage.getItem("lattice.activeWorkspace");
    }
    if (workspaceId) {
      headers.set("x-workspace-id", workspaceId);
    }
    if (Platform.OS === "web") {
      return Object.fromEntries(headers);
    }
    const cookies = await authClient.getCookie();
    if (cookies) {
      headers.set("Cookie", cookies);
    }
    return Object.fromEntries(headers);
  },
});

export const client: AppRouterClient = createORPCClient(link);

export const orpc = createTanstackQueryUtils(client);
