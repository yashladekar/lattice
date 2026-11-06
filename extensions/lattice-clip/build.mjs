#!/usr/bin/env node
/**
 * Packages the Lattice Clip extension for loading unpacked or uploading to a
 * store. Everything is validated first: a rejected store submission costs days,
 * a failed check here costs a second.
 *
 *   node build.mjs            validate, stage, and zip
 *   node build.mjs --check    validate only
 */
import { createHash } from "node:crypto";
import { deflateRawSync } from "node:zlib";
import { mkdirSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = dirname(fileURLToPath(import.meta.url));
const checkOnly = process.argv.includes("--check");
const errors = [];
const warnings = [];

function fail(message) {
  errors.push(message);
}
function warn(message) {
  warnings.push(message);
}

function readJson(path) {
  try {
    return JSON.parse(readFileSync(path, "utf8"));
  } catch (error) {
    fail(`${relative(root, path)} is not valid JSON: ${error.message}`);
    return null;
  }
}

const manifestPath = join(root, "manifest.json");
const manifest = readJson(manifestPath);
if (!manifest) finish();

/** Store limits: exceeding them rejects the upload outright. */
const LIMITS = { name: 45, description: 132, versionPart: 65535, zipBytes: 2 * 1024 * 1024 };
const ALLOWED_PERMISSIONS = new Set(["activeTab", "contextMenus", "storage", "scripting"]);

const iconSizes = Object.keys(manifest.icons ?? {});
for (const size of ["96", "192"]) {
  if (!iconSizes.includes(size)) fail(`icons.${size} is required by the store listing.`);
}

if (manifest.manifest_version !== 3) fail("manifest_version must be 3.");
if (typeof manifest.name !== "string" || !manifest.name.trim()) fail("name is required.");
else if (manifest.name.length > LIMITS.name) {
  fail(`name must be ${LIMITS.name} characters or fewer (is ${manifest.name.length}).`);
}
if (typeof manifest.description !== "string" || !manifest.description.trim()) {
  fail("description is required.");
} else if (manifest.description.length > LIMITS.description) {
  fail(
    `description must be ${LIMITS.description} characters or fewer (is ${manifest.description.length}).`,
  );
}
if (typeof manifest.version !== "string" || !/^\d+(\.\d+){0,3}$/.test(manifest.version)) {
  fail("version must be 1-4 dot-separated numbers, like 1.0.0.");
} else if (manifest.version.split(".").some((part) => Number(part) > LIMITS.versionPart)) {
  fail(`each version part must be ${LIMITS.versionPart} or less.`);
}

for (const permission of manifest.permissions ?? []) {
  if (!ALLOWED_PERMISSIONS.has(permission)) {
    fail(`permission "${permission}" is not in the reviewed allow-list; it needs a justification first.`);
  }
}
if (manifest.host_permissions?.length) {
  warn("host_permissions are declared; the store review will ask why activeTab is not enough.");
}
if (manifest.content_scripts?.length) {
  warn("content scripts run in every matching page; prefer activeTab injection where possible.");
}

/** Every file the manifest points at must exist and be a real PNG where expected. */
const referenced = new Set(["manifest.json"]);
const requireFile = (value, label) => {
  if (typeof value !== "string" || !value) {
    fail(`${label} is missing.`);
    return null;
  }
  const path = join(root, value);
  try {
    if (!statSync(path).isFile()) throw new Error("not a file");
  } catch {
    fail(`${label} points at a missing file: ${value}`);
    return null;
  }
  referenced.add(value.replace(/^\.\//, ""));
  return path;
};

const popupPath = requireFile(manifest.action?.default_popup, "action.default_popup");
const workerPath = requireFile(manifest.background?.service_worker, "background.service_worker");
for (const [size, icon] of Object.entries(manifest.icons ?? {})) {
  const path = requireFile(icon, `icons.${size}`);
  if (path) {
    const magic = readFileSync(path).subarray(0, 8);
    const isPng = magic.equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]));
    if (!isPng) fail(`icons.${size} is not a PNG (${icon}).`);
  }
}
for (const [size, icon] of Object.entries(manifest.action?.default_icon ?? {})) {
  requireFile(icon, `action.default_icon.${size}`);
}

/** Files the HTML pulls in must ship too, or the popup loads blank. */
if (popupPath) {
  const html = readFileSync(popupPath, "utf8");
  for (const match of html.matchAll(/(?:src|href)="([^"]+)"/g)) {
    const target = match[1];
    if (!target || /^(https?:|mailto:|#|data:)/.test(target)) continue;
    requireFile(join(dirname(relative(root, popupPath)), target), `popup.html asset`);
  }
}

/** Ship exactly the files we mean to: nothing stray, nothing missing. */
const SHIP = ["manifest.json", "popup.html", "popup.js", "background.js"];
const shipFiles = [...SHIP];
for (const icon of Object.values(manifest.icons ?? {})) shipFiles.push(icon);
for (const entry of readdirSync(root, { withFileTypes: true })) {
  if (entry.isFile() && !SHIP.includes(entry.name) && entry.name.endsWith(".js")) {
    warn(`${entry.name} is not listed in SHIP and will not be packaged.`);
  }
}
for (const file of shipFiles) requireFile(file, `shipped file ${file}`);

function crc32(buffer) {
  let crc = 0xffffffff;
  for (const byte of buffer) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit += 1) {
      crc = crc & 1 ? (crc >>> 1) ^ 0xedb88320 : crc >>> 1;
    }
  }
  return (crc ^ 0xffffffff) >>> 0;
}

/**
 * Minimal ZIP writer: deflated entries, no data descriptors, fixed timestamps
 * so the same inputs produce the same bytes.
 */
function createZip(entries) {
  const chunks = [];
  const central = [];
  let offset = 0;
  const dosTime = 0;
  const dosDate = (2024 - 1980) * 512 + 1 * 32 + 1;

  for (const { name, data } of entries) {
    const nameBytes = Buffer.from(name, "utf8");
    const compressed = deflateRawSync(data, { level: 9 });
    const crc = crc32(data);
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt16LE(0, 6);
    local.writeUInt16LE(8, 8);
    local.writeUInt16LE(dosTime, 10);
    local.writeUInt16LE(dosDate, 12);
    local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(compressed.length, 18);
    local.writeUInt32LE(data.length, 22);
    local.writeUInt16LE(nameBytes.length, 26);
    local.writeUInt16LE(0, 28);
    chunks.push(local, nameBytes, compressed);

    const entry = Buffer.alloc(46);
    entry.writeUInt32LE(0x02014b50, 0);
    entry.writeUInt16LE(20, 4);
    entry.writeUInt16LE(20, 6);
    entry.writeUInt16LE(0, 8);
    entry.writeUInt16LE(8, 10);
    entry.writeUInt16LE(dosTime, 12);
    entry.writeUInt16LE(dosDate, 14);
    entry.writeUInt32LE(crc, 16);
    entry.writeUInt32LE(compressed.length, 20);
    entry.writeUInt32LE(data.length, 24);
    entry.writeUInt16LE(nameBytes.length, 28);
    entry.writeUInt16LE(0, 30);
    entry.writeUInt16LE(0, 32);
    entry.writeUInt16LE(0, 34);
    entry.writeUInt16LE(0, 36);
    entry.writeUInt32LE(0, 38);
    entry.writeUInt32LE(offset, 42);
    central.push(entry, nameBytes);

    offset += local.length + nameBytes.length + compressed.length;
  }

  const centralBuffer = Buffer.concat(central);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(0, 4);
  end.writeUInt16LE(0, 6);
  end.writeUInt16LE(entries.length, 8);
  end.writeUInt16LE(entries.length, 10);
  end.writeUInt32LE(centralBuffer.length, 12);
  end.writeUInt32LE(offset, 16);
  end.writeUInt16LE(0, 20);
  return Buffer.concat([...chunks, centralBuffer, end]);
}

function finish() {
  if (warnings.length) {
    console.log("Warnings:");
    for (const message of warnings) console.log(`  ! ${message}`);
  }
  if (errors.length) {
    console.error("Extension packaging failed:");
    for (const message of errors) console.error(`  × ${message}`);
    process.exit(1);
  }
  console.log("Manifest and assets validated.");
  if (checkOnly) process.exit(0);
  return true;
}

finish();

const distDir = join(root, "dist");
const unpackedDir = join(distDir, "unpacked");
rmSync(distDir, { recursive: true, force: true });
mkdirSync(unpackedDir, { recursive: true });

const entries = [];
for (const file of [...new Set(shipFiles)]) {
  const data = readFileSync(join(root, file));
  entries.push({ name: file, data });
  const target = join(unpackedDir, file);
  mkdirSync(dirname(target), { recursive: true });
  writeFileSync(target, data);
}
entries.sort((a, b) => (a.name < b.name ? -1 : 1));

const zip = createZip(entries);
if (zip.length > LIMITS.zipBytes) {
  warn(`zip is ${zip.length} bytes; stores reject packages above ${LIMITS.zipBytes}.`);
}
const zipName = `lattice-clip-${manifest.version}.zip`;
writeFileSync(join(distDir, zipName), zip);

const report = {
  name: manifest.name,
  version: manifest.version,
  permissions: manifest.permissions ?? [],
  files: entries.map((entry) => ({ name: entry.name, bytes: entry.data.length })),
  totalBytes: entries.reduce((sum, entry) => sum + entry.data.length, 0),
  zipBytes: zip.length,
  sha256: createHash("sha256").update(zip).digest("hex"),
};
writeFileSync(join(distDir, "build-report.json"), `${JSON.stringify(report, null, 2)}\n`);

console.log(`Packaged ${entries.length} files (${report.totalBytes} bytes).`);
console.log(`  zip        ${relative(process.cwd(), join(distDir, zipName))} (${zip.length} bytes)`);
console.log(`  unpacked   ${relative(process.cwd(), unpackedDir)}`);
console.log(`  sha256     ${report.sha256}`);
console.log("Load unpacked from dist/unpacked, or upload the zip to a store.");
