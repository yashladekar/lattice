import { writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

/**
 * The installer embeds the static export. This file chooses which API that
 * export talks to, so a release build points at the hosted deployment while
 * `pnpm desktop:build` keeps the local default.
 */
const apiBaseUrl = (process.env.LATTICE_SERVER_URL ?? "").trim().replace(/\/$/, "");
const docsUrl = JSON.stringify(process.env.NEXT_PUBLIC_DOCS_URL ?? "");
const output = fileURLToPath(new URL("../public/config.js", import.meta.url));

writeFileSync(
  output,
  [
    "window.__LATTICE_CONFIG__ = {",
    `  apiBaseUrl: ${JSON.stringify(apiBaseUrl)},`,
    `  docsUrl: ${docsUrl},`,
    "  collabEnabled: true,",
    "};",
    "",
  ].join("\n"),
);

console.log(
  apiBaseUrl
    ? `Desktop builds will use ${apiBaseUrl}`
    : "LATTICE_SERVER_URL is unset; desktop builds will fall back to the build-time API URL.",
);
