import type { AppRouterClient } from "@notes-learning/api/routers/index";
import { createORPCClient } from "@orpc/client";
import { RPCLink } from "@orpc/client/fetch";
import { createTanstackQueryUtils } from "@orpc/tanstack-query";
import { environmentManager, QueryCache, QueryClient } from "@tanstack/react-query";
import { toast } from "sonner";

import { getApiBaseUrl } from "@/lib/config";

export function createQueryClient() {
  return new QueryClient({
    queryCache: new QueryCache({
      onError: (error, query) => {
        toast.error(`Error: ${error.message}`, {
          action: {
            label: "retry",
            onClick: () => {
              query.invalidate();
            },
          },
        });
      },
    }),
  });
}

let browserQueryClient: QueryClient | undefined;

export function getQueryClient() {
  if (environmentManager.isServer()) {
    return createQueryClient();
  }

  browserQueryClient ??= createQueryClient();
  return browserQueryClient;
}

let activeWorkspaceHeader: string | null = null;

export function setWorkspaceHeader(workspaceId: string | null): void {
  activeWorkspaceHeader = workspaceId;
}

function createLink(workspaceId?: string) {
  return new RPCLink({
    url: `${getApiBaseUrl()}/rpc`,
    async headers() {
      const stored =
        typeof window !== "undefined"
          ? window.localStorage.getItem("lattice.activeWorkspace")
          : null;
      const id = workspaceId ?? activeWorkspaceHeader ?? stored;
      return id ? { "x-workspace-id": id } : {};
    },
    fetch(url, options) {
      return fetch(url, {
        ...options,
        credentials: "include",
      });
    },
  });
}

export const link = createLink();

export const client: AppRouterClient = createORPCClient(link);

export function workspaceClient(workspaceId: string): AppRouterClient {
  return createORPCClient(createLink(workspaceId));
}

export const orpc = createTanstackQueryUtils(client);
