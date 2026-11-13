/**
 * Drops per-session browser state on sign-out, so a shared or offline device
 * cannot reopen the previous account's workspace or its saved Git token.
 */
export function clearDeviceSession(): void {
  if (typeof window === "undefined") return;
  const remove: string[] = [];
  for (let index = 0; index < window.localStorage.length; index += 1) {
    const key = window.localStorage.key(index);
    if (!key) continue;
    if (
      key === "lattice.cachedUser" ||
      key === "lattice.activeWorkspace" ||
      key.startsWith("lattice.gitSync.")
    ) {
      remove.push(key);
    }
  }
  for (const key of remove) window.localStorage.removeItem(key);
}
