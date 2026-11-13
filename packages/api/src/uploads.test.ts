import { mkdtemp, readdir, readFile, rm } from "node:fs/promises";
import { createServer, type Server } from "node:http";
import { tmpdir } from "node:os";
import path from "node:path";

import express from "express";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { createUploadHandler } from "./uploads";

describe("upload handler", () => {
  let server: Server;
  let base = "";
  let directory = "";
  let signedIn = true;

  beforeAll(async () => {
    directory = await mkdtemp(path.join(tmpdir(), "lattice-uploads-"));
    const app = express();
    app.post(
      "/uploads",
      express.raw({ type: "*/*", limit: "1mb" }),
      createUploadHandler({
        uploadRoot: directory,
        authenticate: async () => (signedIn ? { userId: "user" } : null),
      }),
    );
    server = createServer(app);
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    const address = server.address();
    const port = typeof address === "object" && address ? address.port : 0;
    base = `http://127.0.0.1:${port}`;
  });

  afterAll(async () => {
    await new Promise<void>((resolve) => server.close(() => resolve()));
    await rm(directory, { recursive: true, force: true });
  });

  const upload = (body: string, headers: Record<string, string> = {}) =>
    fetch(`${base}/uploads`, {
      method: "POST",
      headers: { "content-type": "application/octet-stream", "x-file-name": "photo.png", ...headers },
      body,
    });

  it("stores a file under a generated name", async () => {
    signedIn = true;
    const response = await upload("image-bytes");
    expect(response.status).toBe(200);
    const body = (await response.json()) as { url: string; name: string; size: number };
    expect(body.url).toMatch(/^\/uploads\/[a-f0-9-]+\.png$/);
    expect(body.name).toBe("photo.png");
    expect(body.size).toBe(11);
    const stored = await readFile(path.join(directory, body.url.replace("/uploads/", "")), "utf8");
    expect(stored).toBe("image-bytes");
    const meta = JSON.parse(
      await readFile(
        path.join(directory, ".meta", `${body.url.replace("/uploads/", "")}.json`),
        "utf8",
      ),
    ) as { userId: string };
    expect(meta.userId).toBe("user");
  });

  it("keeps only the extension of a hostile filename", async () => {
    signedIn = true;
    const response = await upload("payload", { "x-file-name": encodeURIComponent("../../evil.html") });
    expect(response.status).toBe(200);
    const body = (await response.json()) as { url: string };
    expect(body.url).toMatch(/^\/uploads\/[a-f0-9-]+\.html$/);
    const files = await readdir(directory);
    expect(files).toContain(body.url.replace("/uploads/", ""));
    expect(files.every((file) => !file.includes("/") && !file.includes(".."))).toBe(true);
  });

  it("refuses anonymous and empty uploads", async () => {
    signedIn = false;
    const unauthorized = await upload("nope");
    expect(unauthorized.status).toBe(401);
    signedIn = true;
    const empty = await upload("");
    expect(empty.status).toBe(400);
  });
});
