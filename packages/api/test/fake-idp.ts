import { randomUUID } from "node:crypto";
import { createServer, type Server } from "node:http";

import express from "express";
import { SignJWT, exportJWK, generateKeyPair } from "jose";

/**
 * Minimal OIDC provider for exercising the sign-in flow. It is a test double:
 * no consent screen, no refresh tokens, and the nonce comes straight back from
 * the authorize request. Listen on port 0 and use the returned issuer.
 */
export interface FakeIdp {
  issuer: string;
  clientId: string;
  /** Change who the provider authenticates, for testing unprovisioned identities. */
  setIdentity: (identity: { email: string; name?: string }) => void;
  close: () => Promise<void>;
}

export async function startFakeIdp(
  options: { clientId?: string; email?: string; name?: string; port?: number } = {},
): Promise<FakeIdp> {
  const clientId = options.clientId ?? "lattice-test";
  const identity = {
    email: options.email ?? "qa@lattice.local",
    name: options.name ?? "Fake Identity",
  };
  const { publicKey, privateKey } = await generateKeyPair("RS256");
  const jwk = await exportJWK(publicKey);
  jwk.kid = "fake-idp";
  jwk.alg = "RS256";
  jwk.use = "sig";

  const codes = new Map<string, { nonce: string }>();
  const app = express();
  app.use(express.urlencoded({ extended: false }));
  app.use(express.json());

  let issuer = "";

  app.get("/.well-known/openid-configuration", (_req, res) => {
    res.json({
      issuer,
      authorization_endpoint: `${issuer}/authorize`,
      token_endpoint: `${issuer}/token`,
      jwks_uri: `${issuer}/jwks`,
      userinfo_endpoint: `${issuer}/userinfo`,
      response_types_supported: ["code"],
      subject_types_supported: ["public"],
      id_token_signing_alg_values_supported: ["RS256"],
    });
  });
  app.get("/jwks", (_req, res) => {
    res.json({ keys: [jwk] });
  });
  app.get("/authorize", (req, res) => {
    const { redirect_uri, state, nonce, client_id, scope } = req.query as Record<string, string>;
    if (client_id !== clientId || !redirect_uri || !state || !nonce || !scope?.includes("openid")) {
      res.status(400).json({ error: "invalid_request" });
      return;
    }
    const code = randomUUID();
    codes.set(code, { nonce });
    const target = new URL(redirect_uri);
    target.searchParams.set("code", code);
    target.searchParams.set("state", state);
    res.redirect(target.toString());
  });
  app.post("/token", async (req, res) => {
    const { code, client_id, client_secret, code_verifier } = (req.body ?? {}) as Record<
      string,
      string | undefined
    >;
    const entry = code ? codes.get(code) : undefined;
    if (!code || !entry || client_id !== clientId || !client_secret || !code_verifier) {
      res.status(400).json({ error: "invalid_grant" });
      return;
    }
    codes.delete(code);
    const idToken = await new SignJWT({
      email: identity.email,
      email_verified: true,
      name: identity.name,
      nonce: entry.nonce,
    })
      .setProtectedHeader({ alg: "RS256", kid: "fake-idp" })
      .setIssuer(issuer)
      .setAudience(clientId)
      .setSubject("fake-subject")
      .setIssuedAt()
      .setExpirationTime("5m")
      .sign(privateKey);
    res.json({
      access_token: `access-${randomUUID()}`,
      token_type: "Bearer",
      expires_in: 300,
      id_token: idToken,
    });
  });
  app.get("/userinfo", (req, res) => {
    if (!req.headers.authorization?.startsWith("Bearer ")) {
      res.status(401).json({ error: "invalid_token" });
      return;
    }
    res.json({ sub: "fake-subject", email: identity.email, email_verified: true, name: identity.name });
  });

  const server: Server = createServer(app);
  await new Promise<void>((resolve) => server.listen(options.port ?? 0, "127.0.0.1", resolve));
  const address = server.address();
  const port = typeof address === "object" && address ? address.port : 0;
  issuer = `http://127.0.0.1:${port}`;

  return {
    issuer,
    clientId,
    setIdentity: (next) => {
      identity.email = next.email;
      if (next.name) identity.name = next.name;
    },
    close: () => new Promise<void>((resolve) => server.close(() => resolve())),
  };
}
