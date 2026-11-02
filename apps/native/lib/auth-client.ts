import { expoClient } from "@better-auth/expo/client";
import type { polar } from "@polar-sh/better-auth";
import type { BetterAuthClientPlugin } from "better-auth/client";
import { createAuthClient } from "better-auth/react";
import Constants from "expo-constants";
import * as SecureStore from "expo-secure-store";

import { ENV } from "../src/env";

export const authClient = createAuthClient({
  baseURL: ENV.EXPO_PUBLIC_SERVER_URL,
  plugins: [
    // Infer Polar endpoints without importing its browser checkout embed.
    {
      id: "polar-client",
      $InferServerPlugin: {} as ReturnType<typeof polar>,
    } satisfies BetterAuthClientPlugin,
    expoClient({
      scheme: Constants.expoConfig?.scheme as string,
      storagePrefix: Constants.expoConfig?.scheme as string,
      storage: SecureStore,
    }),
  ],
});
