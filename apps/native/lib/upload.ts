import { File } from "expo-file-system";
import { Platform } from "react-native";

import { authClient } from "@/lib/auth-client";
import { SERVER_URL } from "@/lib/server-url";

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

async function bodyFor(uri: string): Promise<Blob> {
  if (Platform.OS === "web") {
    const response = await fetch(uri);
    return response.blob();
  }
  return new File(uri) as unknown as Blob;
}

function absolute(url: string): string {
  return url.startsWith("http") ? url : `${SERVER_URL}${url}`;
}

export async function uploadFile(input: {
  uri: string;
  name: string;
  mime: string;
}): Promise<UploadedFile> {
  const fetchImpl =
    Platform.OS === "web" ? globalThis.fetch : (await import("expo/fetch")).fetch;
  const cookie = Platform.OS === "web" ? null : await authClient.getCookie();
  const credentials = Platform.OS === "web" ? "include" : "omit";
  const authHeaders: Record<string, string> = cookie ? { Cookie: cookie } : {};
  const mime = input.mime || "application/octet-stream";
  const body = await bodyFor(input.uri);
  const size =
    typeof (body as { size?: unknown }).size === "number" ? (body as Blob).size : 0;

  // Serverless hosts cap request bodies, so try the signed direct upload first.
  let presign: Response | null = null;
  try {
    presign = await fetchImpl(`${SERVER_URL}/uploads/presign`, {
      method: "POST",
      headers: { "content-type": "application/json", ...authHeaders },
      body: JSON.stringify({ name: input.name, mime, size }),
      credentials,
    });
  } catch {
    presign = null;
  }

  if (
    presign &&
    presign.status !== 501 &&
    presign.status !== 404 &&
    presign.status !== 405
  ) {
    if (!presign.ok) {
      const message = await presign.text().catch(() => "");
      throw new Error(message || `Upload failed (${presign.status})`);
    }
    const direct = (await presign.json()) as PresignedUpload;
    const put = await fetchImpl(direct.uploadUrl, {
      method: "PUT",
      headers: direct.headers,
      body,
    });
    if (!put.ok) throw new Error(`Upload failed (${put.status})`);
    return {
      id: direct.id,
      url: absolute(direct.url),
      name: direct.name,
      size: direct.size,
      mime: direct.mime,
    };
  }

  const response = await fetchImpl(`${SERVER_URL}/uploads`, {
    method: "POST",
    headers: {
      "content-type": mime,
      "x-file-name": encodeURIComponent(input.name),
      ...authHeaders,
    },
    body,
    credentials,
  });

  if (!response.ok) {
    const message = await response.text().catch(() => "");
    throw new Error(message || `Upload failed (${response.status})`);
  }

  const data = (await response.json()) as UploadedFile;
  return { ...data, url: absolute(data.url) };
}
