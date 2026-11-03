import type { Role } from "@notes-learning/domain";
import { useQueryClient } from "@tanstack/react-query";
import { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";
import { View } from "react-native";
import { ActivityIndicator, Text } from "react-native";
import { Button } from "heroui-native";

import { authClient } from "@/lib/auth-client";
import { appStorage } from "@/lib/storage";
import { client, setWorkspaceHeader } from "@/utils/orpc";

type Membership = Awaited<ReturnType<typeof client.workspace.ensure>>["memberships"][number];

interface WorkspaceContextValue {
  memberships: Membership[];
  workspace: Membership["workspace"] | null;
  role: Role | null;
  switching: boolean;
  switchWorkspace: (workspaceId: string) => Promise<void>;
  refresh: () => Promise<void>;
  signOut: () => Promise<void>;
}

const WorkspaceContext = createContext<WorkspaceContextValue | null>(null);
const ACTIVE_KEY = "lattice.activeWorkspace";

export function WorkspaceProvider({ children }: { children: React.ReactNode }) {
  const queryClient = useQueryClient();
  const [memberships, setMemberships] = useState<Membership[]>([]);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [switching, setSwitching] = useState(false);

  const load = useCallback(async () => {
    setError(null);
    try {
      const result = await client.workspace.ensure({});
      setMemberships(result.memberships);
      const stored = await appStorage.getItem(ACTIVE_KEY);
      const valid = result.memberships.some((entry) => entry.workspace.id === stored);
      const next = valid ? stored : result.memberships[0]?.workspace.id ?? null;
      setActiveId(next);
      setWorkspaceHeader(next);
      if (next) await appStorage.setItem(ACTIVE_KEY, next);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Could not reach the Lattice server.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const switchWorkspace = useCallback(
    async (workspaceId: string) => {
      setSwitching(true);
      try {
        setWorkspaceHeader(workspaceId);
        setActiveId(workspaceId);
        await appStorage.setItem(ACTIVE_KEY, workspaceId);
        await queryClient.invalidateQueries();
      } finally {
        setSwitching(false);
      }
    },
    [queryClient],
  );

  const signOut = useCallback(async () => {
    setWorkspaceHeader(null);
    await authClient.signOut();
    await appStorage.removeItem(ACTIVE_KEY);
    queryClient.clear();
  }, [queryClient]);

  const workspace = useMemo(
    () => memberships.find((entry) => entry.workspace.id === activeId) ?? null,
    [memberships, activeId],
  );

  const value = useMemo<WorkspaceContextValue>(
    () => ({
      memberships,
      workspace: workspace?.workspace ?? null,
      role: (workspace?.role as Role | undefined) ?? null,
      switching,
      switchWorkspace,
      refresh: load,
      signOut,
    }),
    [memberships, workspace, switching, switchWorkspace, load, signOut],
  );

  if (loading) {
    return (
      <View className="flex-1 items-center justify-center bg-background">
        <ActivityIndicator color="#e8892f" />
        <Text className="mt-3 text-xs text-muted">Opening your workspace…</Text>
      </View>
    );
  }

  if (error || !workspace) {
    return (
      <View className="flex-1 items-center justify-center bg-background px-8">
        <Text className="text-center text-lg font-semibold text-foreground">Workspace unavailable</Text>
        <Text className="mt-2 text-center text-xs leading-5 text-muted">
          {error ?? "No workspace was returned for this account."}
        </Text>
        <View className="mt-5 w-full max-w-xs gap-2">
          <Button onPress={() => void load()}>
            <Button.Label>Retry</Button.Label>
          </Button>
          <Button variant="outline" onPress={() => void signOut()}>
            <Button.Label>Sign out</Button.Label>
          </Button>
        </View>
      </View>
    );
  }

  return <WorkspaceContext.Provider value={value}>{children}</WorkspaceContext.Provider>;
}

export function useWorkspace(): WorkspaceContextValue {
  const context = useContext(WorkspaceContext);
  if (!context) throw new Error("useWorkspace must be used inside WorkspaceProvider");
  return context;
}
