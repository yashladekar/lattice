/**
 * Minimal OIDC provider for exercising the sign-in flow locally.
 *
 *   tsx fake-idp.ts
 *
 * Serves discovery, JWKS, an authorize redirect, and a token endpoint with an
 * RS256 ID token. It is a test double: no consent screen, no refresh tokens,
 * and the nonce comes straight back from the authorize request.
 */
import { randomUUID } from "node:crypto";

import express from "express";
import { SignJWT, exportJWK, generateKeyPair } from "jose";

const port = Number(process.env.FAKE_IDP_PORT ?? 4111);
const issuer = `http://localhost:${port}`;
const clientId = process.env.FAKE_IDP_CLIENT_ID ?? "lattice-test";

const { publicKey, privateKey } = await generateKeyPair("RS256");
const jwk = await exportJWK(publicKey);
jwk.kid = "fake-idp";
jwk.alg = "RS256";
jwk.use = "sig";

const codes = new Map<string, { nonce: string; email: string; name: string }>();

const app = express();
app.use(express.urlencoded({ extended: false }));
app.use(express.json());

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
  if (client_id !== clientId) {
    res.status(400).json({ error: "invalid_client" });
    return;
  }
  if (!redirect_uri || !state || !nonce || !scope?.includes("openid")) {
    res.status(400).json({ error: "invalid_request" });
    return;
  }
  const code = randomUUID();
  codes.set(code, {
    nonce,
    email: process.env.FAKE_IDP_EMAIL ?? "qa@lattice.local",
    name: process.env.FAKE_IDP_NAME ?? "QA Pass",
  });
  const target = new URL(redirect_uri);
  target.searchParams.set("code", code);
  target.searchParams.set("state", state);
  res.redirect(target.toString());
});

app.post("/token", async (req, res) => {
  const {
    code,
    client_id,
    client_secret,
    code_verifier,
  } = (req.body ?? {}) as Record<string, string | undefined>;
  const entry = code ? codes.get(code) : undefined;
  if (!code || !entry || client_id !== clientId || !client_secret || !code_verifier) {
    res.status(400).json({ error: "invalid_grant" });
    return;
  }
  codes.delete(code);
  const idToken = await new SignJWT({
    email: entry.email,
    email_verified: true,
    name: entry.name,
    nonce: entry.nonce,
  })
    .setProtectedHeader({ alg: "RS256", kid: "fake-idp" })
    .setIssuer(issuer)
    .setAudience(clientId)
    .setSubject("fake-subject-1")
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
  res.json({
    sub: "fake-subject-1",
    email: process.env.FAKE_IDP_EMAIL ?? "qa@lattice.local",
    email_verified: true,
    name: process.env.FAKE_IDP_NAME ?? "QA Pass",
  });
});

app.listen(port, () => {
  console.log(`fake IdP listening on ${issuer} (client ${clientId})`);
});
