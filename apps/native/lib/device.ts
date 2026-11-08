import * as Device from "expo-device";
import { Platform } from "react-native";

import { appStorage } from "@/lib/storage";
import { client } from "@/utils/orpc";

const DEVICE_KEY = "lattice.deviceId";

async function deviceId(): Promise<string> {
  const existing = await appStorage.getItem(DEVICE_KEY);
  if (existing) return existing;
  const created = `${Platform.OS}-${Date.now().toString(36)}-${Math.random()
    .toString(36)
    .slice(2, 10)}`;
  await appStorage.setItem(DEVICE_KEY, created);
  return created;
}

export async function registerDevice(): Promise<void> {
  try {
    const id = await deviceId();
    const name = Device.modelName ?? (Platform.OS === "ios" ? "iPhone or iPad" : "Android device");
    const platform = `${Device.osName ?? Platform.OS} ${Device.osVersion ?? ""}`.trim();
    await client.device.register({ deviceId: id, name, platform });
  } catch {
    // Device registration is diagnostic; a failure must not block sign-in.
  }
}
