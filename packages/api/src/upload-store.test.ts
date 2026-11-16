import { describe, expect, it } from "vitest";

import { isUploadFilename, uploadFilename } from "./upload-store";

describe("upload filenames", () => {
  it("keeps only an extension and generates the stem", () => {
    expect(uploadFilename("../../evil.html")).toMatch(/^[a-f0-9-]+\.html$/);
    expect(uploadFilename("holiday photo.PNG")).toMatch(/^[a-f0-9-]+\.png$/);
    expect(uploadFilename("no-extension")).toMatch(/^[a-f0-9-]+$/);
  });

  it("rejects path segments and hidden names", () => {
    expect(isUploadFilename("abc.png")).toBe(true);
    expect(isUploadFilename("../abc.png")).toBe(false);
    expect(isUploadFilename(".meta")).toBe(false);
    expect(isUploadFilename("dir/abc.png")).toBe(false);
    expect(isUploadFilename("dir\\abc.png")).toBe(false);
  });
});
