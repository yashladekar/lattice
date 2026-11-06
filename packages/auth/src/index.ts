import { expo } from "@better-auth/expo";
import type { Database } from "@notes-learning/db";
import { polar, checkout, portal } from "@polar-sh/better-auth";
import { betterAuth, type BetterAuthPlugin } from "better-auth";
import { prismaAdapter } from "better-auth/adapters/prisma";

import { createPolarClient } from "./lib/payments";
import { createSsoPlugin } from "./lib/sso-plugin";

export { decryptSsoSecret, discoverOidc, encryptSsoSecret } from "./lib/sso";

export type AuthConfig = {
  BETTER_AUTH_URL: string;
  BETTER_AUTH_SECRET: string;
  CORS_ORIGIN: string;
  POLAR_ACCESS_TOKEN?: string;
  POLAR_SUCCESS_URL?: string;
};

export function createAuth(
  env: AuthConfig,
  database: Database,
  desktopOrigins: readonly string[] = [],
) {
  const polarToken = env.POLAR_ACCESS_TOKEN;
  const polarEnabled = process.env.POLAR_ENABLED === "true" && Boolean(polarToken);
  const plugins: BetterAuthPlugin[] = [
    ...(polarEnabled && polarToken
      ? [
          polar({
            client: createPolarClient({ POLAR_ACCESS_TOKEN: polarToken }),
            createCustomerOnSignUp: true,
            use: [
              checkout({
                products: [{ productId: "your-product-id", slug: "pro" }],
                successUrl: env.POLAR_SUCCESS_URL ?? env.BETTER_AUTH_URL,
                authenticatedUsersOnly: true,
              }),
              portal(),
            ],
          }),
        ]
      : []),
    expo(),
  ];

  const trustedOrigins = [
    env.CORS_ORIGIN,
    ...desktopOrigins,
    "notes-learning://",
    "exp://",
    "http://localhost:8081",
    "http://localhost:3101",
  ];
  plugins.push(
    createSsoPlugin({
      database,
      secret: env.BETTER_AUTH_SECRET,
      appOrigin: env.CORS_ORIGIN,
      trustedOrigins: [env.CORS_ORIGIN, "http://localhost:3101"],
    }),
  );

  return betterAuth({
    database: prismaAdapter(database, {
      provider: "postgresql",
    }),
    trustedOrigins,
    emailAndPassword: { enabled: true },
    secret: env.BETTER_AUTH_SECRET,
    baseURL: env.BETTER_AUTH_URL,
    advanced: {
      defaultCookieAttributes: {
        sameSite: "none",
        secure: true,
        httpOnly: true,
      },
    },
    plugins,
  });
}

export type Session = ReturnType<typeof createAuth>["$Infer"]["Session"];
