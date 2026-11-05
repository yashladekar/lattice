import { createAsyncStoragePersister } from "@tanstack/query-async-storage-persister";
import { File, Paths } from "expo-file-system";

const CACHE_FILE = "lattice-query-cache.json";

/**
 * A tiny AsyncStorage-shaped wrapper over a JSON file in the app's document
 * directory. The persister only ever uses one key, so the key is ignored and
 * the whole cache lives in a single file.
 */
const fileStorage = {
  async getItem(): Promise<string | null> {
    try {
      const file = new File(Paths.document, CACHE_FILE);
      if (!file.exists) return null;
      return await file.text();
    } catch {
      return null;
    }
  },
  async setItem(_key: string, value: string): Promise<void> {
    try {
      const file = new File(Paths.document, CACHE_FILE);
      if (!file.exists) file.create({ intermediates: true, overwrite: true });
      await file.write(value);
    } catch {
      // The cache is best-effort; a failed write must never break the app.
    }
  },
  async removeItem(): Promise<void> {
    try {
      const file = new File(Paths.document, CACHE_FILE);
      if (file.exists) file.delete();
    } catch {
      // ignore
    }
  },
};

export const queryPersister = createAsyncStoragePersister({
  storage: fileStorage,
  key: "lattice-query-cache",
  throttleTime: 1500,
});

export const QUERY_CACHE_MAX_AGE = 7 * 24 * 60 * 60 * 1000;
