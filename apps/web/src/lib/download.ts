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
