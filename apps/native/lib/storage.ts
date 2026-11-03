import * as SecureStore from "expo-secure-store";
import { Platform } from "react-native";

interface AppStorage {
  getItem(key: string): Promise<string | null>;
  setItem(key: string, value: string): Promise<void>;
  removeItem(key: string): Promise<void>;
}

const nativeStorage: AppStorage = {
  getItem: (key) => SecureStore.getItemAsync(key),
  setItem: (key, value) => SecureStore.setItemAsync(key, value),
  removeItem: (key) => SecureStore.deleteItemAsync(key),
};

// expo-secure-store has no web implementation, so fall back to localStorage there.
const webStorage: AppStorage = {
  async getItem(key) {
    return globalThis.localStorage?.getItem(key) ?? null;
  },
  async setItem(key, value) {
    globalThis.localStorage?.setItem(key, value);
  },
  async removeItem(key) {
    globalThis.localStorage?.removeItem(key);
  },
};

export const appStorage: AppStorage = Platform.OS === "web" ? webStorage : nativeStorage;
