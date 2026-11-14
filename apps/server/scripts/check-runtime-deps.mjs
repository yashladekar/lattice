import { readFileSync } from "node:fs";
import path from "node:path";

/**
 * The server image installs only the npm packages left external by tsdown.
 * This check keeps that runtime manifest honest: a new external import fails
 * the build instead of failing at container start, and a version bump in the
 * workspace fails until the manifest is pinned to what was actually bundled.
 */
const serverDir = path.resolve(import.meta.dirname, "..");
const bundlePath = path.join(serverDir, "dist", "index.mjs");
const manifestPath = path.join(serverDir, "runtime.package.json");

const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
const declared = new Map(Object.entries(manifest.dependencies ?? {}));
const source = readFileSync(bundlePath, "utf8");

// Only the ESM import block rolldown emits at the top of the bundle. Matching
// `from "..."` anywhere would also hit comments and prompt strings.
const specifiers = new Set();
for (const line of source.split("\n")) {
  const match = /^(?:import|export)\s+(?:[^"']*?\bfrom\s*)?["']([^"']+)["']/.exec(line);
  if (match) specifiers.add(match[1]);
}

function packageName(specifier) {
  if (
    specifier.startsWith(".") ||
    specifier.startsWith("/") ||
    specifier.startsWith("node:") ||
    specifier.startsWith("data:") ||
    specifier.startsWith("http:")
  ) {
    return null;
  }
  const parts = specifier.split("/");
  return specifier.startsWith("@") ? parts.slice(0, 2).join("/") : parts[0];
}

const imported = new Set();
for (const specifier of specifiers) {
  const name = packageName(specifier);
  if (name) imported.add(name);
}

const missing = [...imported].filter((name) => !declared.has(name)).sort();
if (missing.length) {
  console.error(
    `runtime.package.json is missing external imports: ${missing.join(", ")}`,
  );
  process.exit(1);
}

const mismatches = [];
for (const [name, expected] of declared) {
  let installed;
  try {
    installed = JSON.parse(
      readFileSync(path.join(serverDir, "node_modules", name, "package.json"), "utf8"),
    ).version;
  } catch {
    mismatches.push(`${name}: not installed (manifest pins ${expected})`);
    continue;
  }
  if (installed !== expected) {
    mismatches.push(`${name}: installed ${installed}, manifest pins ${expected}`);
  }
}
if (mismatches.length) {
  console.error(`runtime.package.json does not match the build:\n  ${mismatches.join("\n  ")}`);
  process.exit(1);
}

const unused = [...declared.keys()].filter((name) => !imported.has(name)).sort();
if (unused.length) {
  console.warn(`runtime.package.json lists unused packages: ${unused.join(", ")}`);
}

console.log(`runtime.package.json covers ${imported.size} external packages.`);
