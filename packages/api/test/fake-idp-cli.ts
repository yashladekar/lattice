import { startFakeIdp } from "./fake-idp";

/**
 * Runs the fake identity provider for local manual testing.
 *
 *   pnpm --filter @notes-learning/api exec tsx test/fake-idp-cli.ts
 *
 * Point a workspace SSO connection at the printed issuer, then start sign-in
 * from the login page. Environment overrides: FAKE_IDP_PORT, FAKE_IDP_EMAIL,
 * FAKE_IDP_NAME, FAKE_IDP_CLIENT_ID.
 */
const idp = await startFakeIdp({
  clientId: process.env.FAKE_IDP_CLIENT_ID ?? "lattice-test",
  email: process.env.FAKE_IDP_EMAIL ?? "qa@lattice.local",
  name: process.env.FAKE_IDP_NAME ?? "QA Pass",
  port: Number(process.env.FAKE_IDP_PORT ?? 4111),
});

console.log(`fake IdP running at ${idp.issuer} (client ${idp.clientId})`);
console.log("Use that issuer in Settings → Members → Single sign-on.");
console.log("Stop with Ctrl-C.");

process.on("SIGINT", () => {
  void idp.close().then(() => process.exit(0));
});
