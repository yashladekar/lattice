import { SERVER_URL } from "@/lib/server-url";

/**
 * Web share links point at the web client, which can live on a different
 * origin from the API. Falls back to the API origin for single-origin
 * self-hosting.
 */
export const WEB_URL = process.env.EXPO_PUBLIC_WEB_URL || SERVER_URL;

export function shareLink(token: string, type: string): string {
  return `${WEB_URL.replace(/\/$/, "")}/share?token=${encodeURIComponent(token)}&type=${type}`;
}

export function inviteLink(token: string): string {
  return `${WEB_URL.replace(/\/$/, "")}/invite?token=${encodeURIComponent(token)}`;
}
