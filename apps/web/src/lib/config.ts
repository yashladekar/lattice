type LatticeRuntimeConfig = {
  apiBaseUrl?: string;
  docsUrl?: string;
  /**
   * Set to false on a host without a WebSocket relay (Vercel Functions). The
   * editor then stays on the local-first Dexie path instead of opening a
   * socket that can never connect.
   */
  collabEnabled?: boolean;
};

declare global {
  interface Window {
    __LATTICE_CONFIG__?: LatticeRuntimeConfig;
  }
}

export function getApiBaseUrl(): string {
  if (typeof window !== "undefined") {
    const configured = window.__LATTICE_CONFIG__?.apiBaseUrl?.trim();
    if (configured) return configured.replace(/\/$/, "");
  }
  return (process.env.NEXT_PUBLIC_SERVER_URL ?? "http://localhost:3100").replace(/\/$/, "");
}

export function getAppOrigin(): string {
  if (typeof window !== "undefined") return window.location.origin;
  return getApiBaseUrl();
}

export function getDocsUrl(): string {
  if (typeof window !== "undefined") {
    const configured = window.__LATTICE_CONFIG__?.docsUrl?.trim();
    if (configured) return configured;
  }
  return (process.env.NEXT_PUBLIC_DOCS_URL ?? "http://localhost:4000/docs").replace(/\/$/, "");
}

export function isCollabEnabled(): boolean {
  if (typeof window === "undefined") return true;
  return window.__LATTICE_CONFIG__?.collabEnabled !== false;
}
