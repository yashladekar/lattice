import { writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

/**
 * The web app is a static export, so its API origin is chosen at runtime by
 * this file. On Vercel the API lives on the same domain, which keeps the auth
 * cookie first-party and avoids CORS entirely.
 */
const output = fileURLToPath(new URL("../out/config.js", import.meta.url));
const docsUrl = JSON.stringify(process.env.NEXT_PUBLIC_DOCS_URL ?? "");

writeFileSync(
  output,
  [
    "window.__LATTICE_CONFIG__ = {",
    "  apiBaseUrl: window.location.origin,",
    `  docsUrl: ${docsUrl},`,
    "  collabEnabled: false,",
    "};",
    "",
  ].join("\n"),
);

console.log(`Wrote runtime config to ${output}`);
