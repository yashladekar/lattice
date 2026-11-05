"use client";

import { useEffect } from "react";

import { useLearningStats } from "@/hooks/use-local-data";

const REMINDER_KEY = "lattice.reminders.v1";
const REMINDER_LAST_KEY = "lattice.reminders.last";

export function remindersEnabled(): boolean {
  if (typeof window === "undefined") return false;
  return window.localStorage.getItem(REMINDER_KEY) === "on";
}

export async function enableReminders(): Promise<boolean> {
  if (typeof window === "undefined" || typeof Notification === "undefined") return false;
  const permission =
    Notification.permission === "granted" ? "granted" : await Notification.requestPermission();
  if (permission !== "granted") return false;
  window.localStorage.setItem(REMINDER_KEY, "on");
  return true;
}

export function disableReminders(): void {
  window.localStorage.setItem(REMINDER_KEY, "off");
}

/**
 * Best-effort due-card reminders. Browsers only allow notifications while a
 * page is open, so this checks on focus and on a slow interval, and never
 * sends more than one nudge per day.
 */
export function DueReminders() {
  const learning = useLearningStats();
  const dueCount = learning.due.length;

  useEffect(() => {
    if (!dueCount) return;
    const check = () => {
      if (!remindersEnabled()) return;
      if (typeof Notification === "undefined" || Notification.permission !== "granted") return;
      const today = new Date().toISOString().slice(0, 10);
      if (window.localStorage.getItem(REMINDER_LAST_KEY) === today) return;
      try {
        new Notification("Cards are due in Lattice", {
          body: `${dueCount} card${dueCount === 1 ? "" : "s"} ready for review.`,
          tag: "lattice-due",
        });
        window.localStorage.setItem(REMINDER_LAST_KEY, today);
      } catch {
        // Notifications are best-effort; some platforms throw without a service worker.
      }
    };
    check();
    const interval = window.setInterval(check, 30 * 60 * 1000);
    const onFocus = () => check();
    window.addEventListener("focus", onFocus);
    document.addEventListener("visibilitychange", onFocus);
    return () => {
      window.clearInterval(interval);
      window.removeEventListener("focus", onFocus);
      document.removeEventListener("visibilitychange", onFocus);
    };
  }, [dueCount]);

  return null;
}
