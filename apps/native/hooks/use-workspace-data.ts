import { useQuery } from "@tanstack/react-query";

import { useWorkspace } from "@/contexts/workspace-context";
import { client } from "@/utils/orpc";

export function usePages() {
  const { workspace } = useWorkspace();
  return useQuery({
    queryKey: ["native-pages", workspace?.id],
    queryFn: async () => client.page.list(),
    enabled: Boolean(workspace),
  });
}

export function useRecentPages() {
  const { workspace } = useWorkspace();
  return useQuery({
    queryKey: ["native-recent", workspace?.id],
    queryFn: async () => client.page.recent(),
    enabled: Boolean(workspace),
  });
}

export function useCanvases() {
  const { workspace } = useWorkspace();
  return useQuery({
    queryKey: ["native-canvases", workspace?.id],
    queryFn: async () => client.canvas.list(),
    enabled: Boolean(workspace),
  });
}

export function useNotebooks() {
  const { workspace } = useWorkspace();
  return useQuery({
    queryKey: ["native-notebooks", workspace?.id],
    queryFn: async () => client.notebook.list(),
    enabled: Boolean(workspace),
  });
}

export function useLearningStats() {
  const { workspace } = useWorkspace();
  return useQuery({
    queryKey: ["native-learning-stats", workspace?.id],
    queryFn: async () => client.learning.stats(),
    enabled: Boolean(workspace),
  });
}

export function useGraph() {
  const { workspace } = useWorkspace();
  return useQuery({
    queryKey: ["native-graph", workspace?.id],
    queryFn: async () => client.graph.data(),
    enabled: Boolean(workspace),
  });
}

export function useMembers() {
  const { workspace } = useWorkspace();
  return useQuery({
    queryKey: ["native-members", workspace?.id],
    queryFn: async () => client.workspace.members(),
    enabled: Boolean(workspace),
  });
}

export function useNotifications() {
  const { workspace } = useWorkspace();
  const list = useQuery({
    queryKey: ["native-notifications", workspace?.id],
    queryFn: async () => client.notification.list({ limit: 50 }),
    enabled: Boolean(workspace),
  });
  const unread = useQuery({
    queryKey: ["native-notifications-unread", workspace?.id],
    queryFn: async () => client.notification.unreadCount(),
    enabled: Boolean(workspace),
  });
  return { list, unread };
}

export function useAiStatus() {
  const { workspace } = useWorkspace();
  return useQuery({
    queryKey: ["native-ai-status", workspace?.id],
    queryFn: async () => client.ai.status(),
    enabled: Boolean(workspace),
  });
}
