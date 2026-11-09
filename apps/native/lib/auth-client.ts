import { expoClient } from "@better-auth/expo/client";
import type { polar } from "@polar-sh/better-auth";
import type { BetterAuthClientPlugin } from "better-auth/client";
import { createAuthClient } from "better-auth/react";
import Constants from "expo-constants";
import * as SecureStore from "expo-secure-store";
import { Platform } from "react-native";

import { SERVER_URL } from "@/lib/server-url";

const scheme = Constants.expoConfig?.scheme as string;
const isWeb = Platform.OS === "web";

export const authClient = createAuthClient({
  baseURL: SERVER_URL,
  fetchOptions: isWeb ? { credentials: "include" } : undefined,
  plugins: [
    // Infer Polar endpoints without importing its browser checkout embed.
    {
      id: "polar-client",
      $InferServerPlugin: {} as ReturnType<typeof polar>,
    } satisfies BetterAuthClientPlugin,
    // The Expo plugin forwards cookies manually for native, where there is no cookie
    // jar. On web it would opt out of credentials, so let the browser handle cookies.
    ...(isWeb
      ? []
      : [
          expoClient({
            scheme,
            storagePrefix: scheme,
            storage: SecureStore,
          }),
        ]),
  ],
});
