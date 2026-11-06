"use client";

import type { Role, Workspace } from "@notes-learning/domain";
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import { useLiveQuery } from "dexie-react-hooks";
import { toast } from "sonner";

import { authClient } from "@/lib/auth-client";
import { getLocalDb, getMeta, setMeta, type LatticeDB } from "@/lib/local/db";
import { createSyncEngine, type SyncEngine, type SyncState } from "@/lib/local/sync-engine";
import type { LocalConflict } from "@/lib/local/types";
import { client, setWorkspaceHeader } from "@/utils/orpc";

export interface UserSummary {
  id: string;
  name: string;
  email: string;
  image?: string | null;
}

interface CachedUser extends UserSummary {
  cachedAt: string;
}

interface AppDataValue {
  db: LatticeDB | null;
  user: UserSummary | null;
  sessionPending: boolean;
  booting: boolean;
  bootError: string | null;
  dismissBootError: () => void;
  online: boolean;
  workspaces: Workspace[];
  activeWorkspace: Workspace | null;
  activeWorkspaceId: string | null;
  setActiveWorkspace: (workspaceId: string) => void;
  role: Role | null;
  syncState: SyncState;
  conflicts: LocalConflict[];
  refreshWorkspaces: () => Promise<void>;
  refreshWorkspace: (workspaceId: string) => Promise<void>;
  retrySync: () => Promise<void>;
  resolveConflict: (
    conflict: LocalConflict,
    resolution: "KEEP_LOCAL" | "KEEP_REMOTE",
  ) => Promise<void>;
}

const AppDataContext = createContext<AppDataValue | null>(null);

const CACHE_KEY = "lattice.cachedUser";
const ACTIVE_KEY = "lattice.activeWorkspace";

function readCache(): UserSummary | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.localStorage.getItem(CACHE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as CachedUser;
    return parsed?.id ? parsed : null;
  } catch {
    return null;
  }
}

function writeCache(user: UserSummary | null): void {
  if (typeof window === "undefined") return;
  if (!user) {
    window.localStorage.removeItem(CACHE_KEY);
    return;
  }
  const cached: CachedUser = { ...user, cachedAt: new Date().toISOString() };
  window.localStorage.setItem(CACHE_KEY, JSON.stringify(cached));
}

const initialSyncState: SyncState = {
  status: "idle",
  pending: 0,
  conflicts: 0,
  lastSyncedAt: null,
};

export function AppDataProvider({ children }: { children: React.ReactNode }) {
  const { data: session, isPending } = authClient.useSession();
  const [online, setOnline] = useState(() =>
    typeof navigator === "undefined" ? true : navigator.onLine,
  );
  const [cachedUser, setCachedUser] = useState<UserSummary | null>(() => readCache());
  const [db, setDb] = useState<LatticeDB | null>(null);
  const [booting, setBooting] = useState(true);
  const [bootError, setBootError] = useState<string | null>(null);
  const [activeWorkspaceId, setActiveWorkspaceId] = useState<string | null>(() => {
    if (typeof window === "undefined") return null;
    return window.localStorage.getItem(ACTIVE_KEY);
  });
  const [role, setRole] = useState<Role | null>(null);
  const [syncState, setSyncState] = useState<SyncState>(initialSyncState);
  const [conflicts, setConflicts] = useState<LocalConflict[]>([]);
  const engineRef = useRef<SyncEngine | null>(null);
  const ensureGeneration = useRef(0);

  const effectiveUser: UserSummary | null = useMemo(() => {
    if (session?.user) {
      return {
        id: session.user.id,
        name: session.user.name,
        email: session.user.email,
        image: session.user.image ?? null,
      };
    }
    if (!isPending && online) return null;
    return cachedUser;
  }, [session, isPending, online, cachedUser]);

  useEffect(() => {
    if (session?.user) {
      const user: UserSummary = {
        id: session.user.id,
        name: session.user.name,
        email: session.user.email,
        image: session.user.image ?? null,
      };
      writeCache(user);
      setCachedUser(user);
    } else if (!isPending && online) {
      writeCache(null);
      setCachedUser(null);
    }
  }, [session, isPending, online]);

  useEffect(() => {
    const handleOnline = () => setOnline(true);
    const handleOffline = () => setOnline(false);
    window.addEventListener("online", handleOnline);
    window.addEventListener("offline", handleOffline);
    return () => {
      window.removeEventListener("online", handleOnline);
      window.removeEventListener("offline", handleOffline);
    };
  }, []);

  useEffect(() => {
    if (!effectiveUser) {
      setDb(null);
      return;
    }
    setDb(getLocalDb(effectiveUser.id));
    if (typeof navigator !== "undefined" && navigator.storage?.persist) {
      void navigator.storage.persist().catch(() => undefined);
    }
  }, [effectiveUser?.id]);

  const workspaces = useLiveQuery(
    async () => {
      if (!db) return [];
      const rows = await db.workspaces.toArray();
      return rows
        .filter((workspace) => !workspace.deletedAt)
        .sort((a, b) => {
          if (a.type !== b.type) return a.type === "PERSONAL" ? -1 : 1;
          return a.name.localeCompare(b.name);
        });
    },
    [db],
    [],
  );

  useEffect(() => {
    if (!workspaces.length) return;
    const stored =
      activeWorkspaceId && workspaces.some((workspace) => workspace.id === activeWorkspaceId)
        ? activeWorkspaceId
        : workspaces[0]?.id ?? null;
    if (stored && stored !== activeWorkspaceId) {
      setActiveWorkspaceId(stored);
      window.localStorage.setItem(ACTIVE_KEY, stored);
    }
  }, [workspaces, activeWorkspaceId]);

  const activeWorkspace = useMemo(
    () => workspaces.find((workspace) => workspace.id === activeWorkspaceId) ?? null,
    [workspaces, activeWorkspaceId],
  );

  useEffect(() => {
    setWorkspaceHeader(activeWorkspaceId);
  }, [activeWorkspaceId]);

  useEffect(() => {
    let cancelled = false;
    if (!db || !effectiveUser || !activeWorkspaceId) {
      setRole(null);
      return;
    }
    void (async () => {
      const member = await db.members
        .where("[workspaceId+userId]")
        .equals([activeWorkspaceId, effectiveUser.id])
        .first();
      const storedRole = await getMeta<Role>(db, `role:${activeWorkspaceId}`);
      if (!cancelled) setRole((member?.role as Role | undefined) ?? storedRole ?? null);
    })();
    return () => {
      cancelled = true;
    };
  }, [db, effectiveUser?.id, activeWorkspaceId, syncState.lastSyncedAt, syncState.status]);

  const refreshWorkspaces = useCallback(async () => {
    if (!db || !effectiveUser || !online) return;
    const generation = ++ensureGeneration.current;
    try {
      const response = await client.workspace.ensure({});
      if (generation !== ensureGeneration.current) return;
      await db.transaction("rw", [db.workspaces, db.meta], async () => {
        for (const membership of response.memberships) {
          const workspace = membership.workspace as unknown as Workspace;
          await db.workspaces.put(workspace);
          await setMeta(db, `role:${workspace.id}`, membership.role);
        }
      });
      setBootError(null);
    } catch (error) {
      if (generation !== ensureGeneration.current) return;
      const message = error instanceof Error ? error.message : "Could not reach the workspace server";
      setBootError(message);
    }
  }, [db, effectiveUser?.id, online]);

  useEffect(() => {
    let cancelled = false;
    if (!db || !effectiveUser) {
      setBooting(true);
      return;
    }
    void (async () => {
      setBooting(true);
      if (online) {
        await refreshWorkspaces();
      }
      if (cancelled) return;
      setBooting(false);
      engineRef.current?.sync().catch(() => undefined);
    })();
    return () => {
      cancelled = true;
    };
  }, [db, effectiveUser?.id, online, refreshWorkspaces]);

  useEffect(() => {
    if (!db || !effectiveUser) {
      engineRef.current?.stop();
      engineRef.current = null;
      return;
    }
    const engine = createSyncEngine({
      db,
      userId: effectiveUser.id,
      getWorkspaceIds: async () => {
        const rows = await db.workspaces.toArray();
        return rows.filter((workspace) => !workspace.deletedAt).map((workspace) => workspace.id);
      },
      onState: (state) => {
        setSyncState(state);
      },
      onConflict: (conflict) => {
        setConflicts((current) => [
          conflict,
          ...current.filter((entry) => entry.id !== conflict.id),
        ]);
        toast.warning("A sync conflict was preserved. Choose which version to keep.", {
          description: conflict.entity === "pageDocument" ? "Page document" : conflict.entity,
        });
      },
      onError: (message) => {
        setBootError(message);
      },
    });
    engineRef.current = engine;
    engine.start();
    return () => {
      engine.stop();
      engineRef.current = null;
    };
  }, [db, effectiveUser?.id]);

  useEffect(() => {
    if (!db) {
      setConflicts([]);
      return;
    }
    void db.conflicts
      .filter((conflict) => !conflict.resolvedAt)
      .toArray()
      .then((rows) => setConflicts(rows));
  }, [db, syncState.conflicts, syncState.lastSyncedAt]);

  const setActiveWorkspace = useCallback((workspaceId: string) => {
    setActiveWorkspaceId(workspaceId);
    window.localStorage.setItem(ACTIVE_KEY, workspaceId);
  }, []);

  const retrySync = useCallback(async () => {
    await engineRef.current?.retry();
  }, []);

  const dismissBootError = useCallback(() => setBootError(null), []);

  const refreshWorkspace = useCallback(async (workspaceId: string) => {
    try {
      await engineRef.current?.bootstrapWorkspace(workspaceId);
      await engineRef.current?.sync();
      setBootError(null);
    } catch (error) {
      setBootError(error instanceof Error ? error.message : "Could not load that workspace.");
    }
  }, []);

  const resolveConflict = useCallback(
    async (conflict: LocalConflict, resolution: "KEEP_LOCAL" | "KEEP_REMOTE") => {
      if (!engineRef.current) return;
      await engineRef.current.resolveConflict(conflict, resolution);
      setConflicts((current) => current.filter((entry) => entry.id !== conflict.id));
    },
    [],
  );

  const value = useMemo<AppDataValue>(
    () => ({
      db,
      user: effectiveUser,
      sessionPending: isPending,
      booting,
      bootError,
      dismissBootError,
      online,
      workspaces,
      activeWorkspace,
      activeWorkspaceId,
      setActiveWorkspace,
      role,
      syncState,
      conflicts,
      refreshWorkspaces,
      refreshWorkspace,
      retrySync,
      resolveConflict,
    }),
    [
      db,
      effectiveUser,
      isPending,
      booting,
      bootError,
      dismissBootError,
      online,
      workspaces,
      activeWorkspace,
      activeWorkspaceId,
      setActiveWorkspace,
      role,
      syncState,
      conflicts,
      refreshWorkspaces,
      refreshWorkspace,
      retrySync,
      resolveConflict,
    ],
  );

  return <AppDataContext.Provider value={value}>{children}</AppDataContext.Provider>;
}

export function useAppData(): AppDataValue {
  const value = useContext(AppDataContext);
  if (!value) throw new Error("useAppData must be used inside AppDataProvider");
  return value;
}

export function useWorkspaceRole(): Role | null {
  return useAppData().role;
}
