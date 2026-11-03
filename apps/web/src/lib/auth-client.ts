import { polarClient } from "@polar-sh/better-auth/client";
import { createAuthClient } from "better-auth/react";

import { getApiBaseUrl } from "@/lib/config";

export const authClient = createAuthClient({
  baseURL: getApiBaseUrl(),
  plugins: [polarClient()],
});
