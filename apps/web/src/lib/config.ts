type LatticeRuntimeConfig = {
  apiBaseUrl?: string;
  docsUrl?: string;
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
