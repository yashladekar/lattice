function inTauri(): boolean {
  return typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;
}

function fileFilters(filename: string): { name: string; extensions: string[] }[] | undefined {
  const extension = filename.split(".").pop()?.toLowerCase();
  if (!extension || extension === filename.toLowerCase()) return undefined;
  return [{ name: extension.toUpperCase(), extensions: [extension] }];
}

async function saveWithNativeDialog(
  filename: string,
  content: Uint8Array,
): Promise<boolean> {
  if (!inTauri()) return false;
  try {
    const [{ save }, { writeFile }] = await Promise.all([
      import("@tauri-apps/plugin-dialog"),
      import("@tauri-apps/plugin-fs"),
    ]);
    const path = await save({
      defaultPath: filename,
      filters: fileFilters(filename),
    });
    // A null path means the user dismissed the dialog; the save is handled.
    if (!path) return true;
    await writeFile(path, content);
    return true;
  } catch (error) {
    console.error("Native save failed, falling back to browser download:", error);
    return false;
  }
}

function browserDownload(filename: string, content: Uint8Array, mime: string): void {
  const copy = new Uint8Array(content.byteLength);
  copy.set(content);
  const blob = new Blob([copy.buffer], { type: mime });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}

export function downloadTextFile(
  filename: string,
  content: string,
  mime = "application/json",
): void {
  downloadBytes(filename, new TextEncoder().encode(content), mime);
}

export function downloadBytes(
  filename: string,
  content: Uint8Array,
  mime = "application/octet-stream",
): void {
  const copy = new Uint8Array(content.byteLength);
  copy.set(content);
  void saveWithNativeDialog(filename, copy).then((handled) => {
    if (!handled) browserDownload(filename, copy, mime);
  });
}
