"use client";

import { useCallback, useEffect, useState } from "react";

import type { AppView } from "@/lib/navigation";

export interface OpenTab {
  key: string;
  view: AppView;
  id: string | null;
  title: string;
  icon: string;
}

const STORAGE_KEY = "lattice.tabs.v1";

function loadTabs(): OpenTab[] {
  if (typeof window === "undefined") return [{ key: "home", view: "home", id: null, title: "Home", icon: "✦" }];
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return [{ key: "home", view: "home", id: null, title: "Home", icon: "✦" }];
    const parsed = JSON.parse(raw) as OpenTab[];
    if (!Array.isArray(parsed) || !parsed.length) {
      return [{ key: "home", view: "home", id: null, title: "Home", icon: "✦" }];
    }
    return parsed;
  } catch {
    return [{ key: "home", view: "home", id: null, title: "Home", icon: "✦" }];
  }
}

export function useTabs() {
  const [tabs, setTabs] = useState<OpenTab[]>(loadTabs);
  const [activeKey, setActiveKey] = useState<string>("home");

  useEffect(() => {
    if (typeof window === "undefined") return;
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(tabs));
  }, [tabs]);

  const openTab = useCallback((tab: OpenTab) => {
    setTabs((current) => {
      const existing = current.find((entry) => entry.key === tab.key);
      if (existing) {
        if (existing.title === tab.title && existing.icon === tab.icon) return current;
        return current.map((entry) =>
          entry.key === tab.key
            ? { ...entry, title: tab.title, icon: tab.icon }
            : entry,
        );
      }
      return [...current, tab];
    });
    setActiveKey(tab.key);
  }, []);

  const closeTab = useCallback((key: string) => {
    setTabs((current) => {
      const next = current.filter((tab) => tab.key !== key);
      return next.length
        ? next
        : [{ key: "home", view: "home" as const, id: null, title: "Home", icon: "✦" }];
    });
    setActiveKey((current) => (current === key ? "home" : current));
  }, []);

  return { tabs, activeKey, setActiveKey, openTab, closeTab, setTabs };
}
