import { getApiBaseUrl } from "@/lib/config";

export async function uploadFile(file: File): Promise<{
  id: string;
  url: string;
  name: string;
  size: number;
  mime: string;
}> {
  const response = await fetch(`${getApiBaseUrl()}/uploads`, {
    method: "POST",
    credentials: "include",
    headers: {
      "content-type": file.type || "application/octet-stream",
      "x-file-name": encodeURIComponent(file.name),
    },
    body: file,
  });
  if (!response.ok) {
    const message = await response.text().catch(() => "");
    throw new Error(message || `Upload failed (${response.status})`);
  }
  const data = (await response.json()) as {
    id: string;
    url: string;
    name: string;
    size: number;
    mime: string;
  };
  return {
    ...data,
    url: data.url.startsWith("http") ? data.url : `${getApiBaseUrl()}${data.url}`,
  };
}
