import { getApiBaseUrl } from "@/lib/config";

export interface UploadedFile {
  id: string;
  url: string;
  name: string;
  size: number;
  mime: string;
}

type PresignedUpload = UploadedFile & {
  uploadUrl: string;
  headers: Record<string, string>;
};

/**
 * Serverless hosts cap request bodies, so they hand out a signed PUT instead.
 * A disk-backed API answers 501 and the caller below keeps the raw POST.
 */
async function presign(file: File): Promise<PresignedUpload | null> {
  let response: Response;
  try {
    response = await fetch(`${getApiBaseUrl()}/uploads/presign`, {
      method: "POST",
      credentials: "include",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        name: file.name,
        mime: file.type || "application/octet-stream",
        size: file.size,
      }),
    });
  } catch {
    return null;
  }
  if (response.status === 501 || response.status === 404 || response.status === 405) {
    return null;
  }
  if (!response.ok) {
    const message = await response.text().catch(() => "");
    throw new Error(message || `Upload failed (${response.status})`);
  }
  return (await response.json()) as PresignedUpload;
}

function absolute(url: string): string {
  return url.startsWith("http") ? url : `${getApiBaseUrl()}${url}`;
}

export async function uploadFile(file: File): Promise<UploadedFile> {
  const direct = await presign(file);
  if (direct) {
    const put = await fetch(direct.uploadUrl, {
      method: "PUT",
      headers: direct.headers,
      body: file,
    });
    if (!put.ok) {
      throw new Error(`Upload failed (${put.status})`);
    }
    return {
      id: direct.id,
      url: absolute(direct.url),
      name: direct.name,
      size: direct.size,
      mime: direct.mime,
    };
  }

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
  const data = (await response.json()) as UploadedFile;
  return { ...data, url: absolute(data.url) };
}
