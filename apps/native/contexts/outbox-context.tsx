import type { SyncConflictPayload } from "@notes-learning/domain";
import { useNetworkState } from "expo-network";
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from "react";
import { AppState } from "react-native";

import {
  flushOutbox,
  pendingCount,
  subscribeOutbox,
  type FlushResult,
} from "@/lib/outbox";

interface OutboxContextValue {
  pending: number;
  conflicts: SyncConflictPayload[];
  online: boolean;
  flushing: boolean;
  flush: () => Promise<FlushResult>;
  clearConflicts: () => void;
}

const OutboxContext = createContext<OutboxContextValue | null>(null);

export function OutboxProvider({ children }: { children: React.ReactNode }) {
  const network = useNetworkState();
  const [pending, setPending] = useState(0);
  const [conflicts, setConflicts] = useState<SyncConflictPayload[]>([]);
  const [flushing, setFlushing] = useState(false);

  const online =
    network.isConnected !== false && network.isInternetReachable !== false;

  const refreshPending = useCallback(() => {
    void pendingCount().then(setPending);
  }, []);

  const flush = useCallback(async () => {
    if (flushing) {
      return { sent: 0, failed: 0, conflicts: [] };
    }
    setFlushing(true);
    try {
      const result = await flushOutbox();
      if (result.conflicts.length) {
        setConflicts((current) => [...result.conflicts, ...current]);
      }
      await refreshPending();
      return result;
    } finally {
      setFlushing(false);
    }
  }, [flushing, refreshPending]);

  useEffect(() => {
    refreshPending();
    return subscribeOutbox(refreshPending);
  }, [refreshPending]);

  useEffect(() => {
    if (online) void flush();
  }, [online, flush]);

  useEffect(() => {
    const subscription = AppState.addEventListener("change", (state) => {
      if (state === "active") void flush();
    });
    return () => subscription.remove();
  }, [flush]);

  const value = useMemo<OutboxContextValue>(
    () => ({
      pending,
      conflicts,
      online,
      flushing,
      flush,
      clearConflicts: () => setConflicts([]),
    }),
    [pending, conflicts, online, flushing, flush],
  );

  return <OutboxContext.Provider value={value}>{children}</OutboxContext.Provider>;
}

export function useOutbox(): OutboxContextValue {
  const context = useContext(OutboxContext);
  if (!context) throw new Error("useOutbox must be used inside OutboxProvider");
  return context;
}
