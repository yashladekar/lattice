import Constants from "expo-constants";
import { Platform } from "react-native";

import { ENV } from "@/src/env";

const LOOPBACK_HOSTS = new Set(["localhost", "127.0.0.1", "::1", "[::1]"]);

/**
 * On a phone or tablet `localhost` points at the device itself, so a loopback
 * server URL can only reach the dev machine through the host Metro used.
 */
function devServerUrl(configured: string): string {
  if (Platform.OS === "web") return configured;

  const metroHost = Constants.expoConfig?.hostUri?.replace(/:\d+$/, "");
  if (!metroHost) return configured;

  try {
    const url = new URL(configured);
    if (!LOOPBACK_HOSTS.has(url.hostname)) return configured;
    url.hostname = metroHost;
    return url.toString().replace(/\/$/, "");
  } catch {
    return configured;
  }
}

export const SERVER_URL = devServerUrl(ENV.EXPO_PUBLIC_SERVER_URL);
