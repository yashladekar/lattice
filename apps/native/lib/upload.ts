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

async function bodyFor(uri: string): Promise<Blob> {
  if (Platform.OS === "web") {
    const response = await fetch(uri);
    return response.blob();
  }
  return new File(uri) as unknown as Blob;
}

export async function uploadFile(input: {
  uri: string;
  name: string;
  mime: string;
}): Promise<UploadedFile> {
  const fetchImpl =
    Platform.OS === "web" ? globalThis.fetch : (await import("expo/fetch")).fetch;
  const cookie = Platform.OS === "web" ? null : await authClient.getCookie();

  const response = await fetchImpl(`${SERVER_URL}/uploads`, {
    method: "POST",
    headers: {
      "content-type": input.mime || "application/octet-stream",
      "x-file-name": encodeURIComponent(input.name),
      ...(cookie ? { Cookie: cookie } : {}),
    },
    body: await bodyFor(input.uri),
    credentials: Platform.OS === "web" ? "include" : "omit",
  });

  if (!response.ok) {
    const message = await response.text().catch(() => "");
    throw new Error(message || `Upload failed (${response.status})`);
  }

  const data = (await response.json()) as UploadedFile;
  return {
    ...data,
    url: data.url.startsWith("http")
      ? data.url
      : `${SERVER_URL}${data.url}`,
  };
}
