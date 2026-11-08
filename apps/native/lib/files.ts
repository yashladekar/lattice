import * as Clipboard from "expo-clipboard";
import * as DocumentPicker from "expo-document-picker";
import * as ImagePicker from "expo-image-picker";
import * as Sharing from "expo-sharing";
import { Platform, Share } from "react-native";

export interface PickedFile {
  uri: string;
  name: string;
  mime: string;
  size?: number;
}

export async function pickImage(source: "library" | "camera" = "library"): Promise<PickedFile | null> {
  if (source === "camera") {
    const permission = await ImagePicker.requestCameraPermissionsAsync();
    if (!permission.granted) throw new Error("Camera access is needed to take a photo.");
  }
  const result =
    source === "camera"
      ? await ImagePicker.launchCameraAsync({ quality: 0.9, mediaTypes: ["images"] })
      : await ImagePicker.launchImageLibraryAsync({
          quality: 0.9,
          mediaTypes: ["images"],
          allowsMultipleSelection: false,
        });
  if (result.canceled || !result.assets[0]) return null;
  const asset = result.assets[0];
  return {
    uri: asset.uri,
    name: asset.fileName ?? `image-${Date.now()}.jpg`,
    mime: asset.mimeType ?? "image/jpeg",
    size: asset.fileSize,
  };
}

export async function pickDocument(): Promise<PickedFile | null> {
  const result = await DocumentPicker.getDocumentAsync({
    copyToCacheDirectory: true,
    multiple: false,
    type: ["application/pdf", "audio/*", "image/*", "text/*", "video/*", "*/*"],
  });
  if (result.canceled || !result.assets[0]) return null;
  const asset = result.assets[0];
  return {
    uri: asset.uri,
    name: asset.name ?? `file-${Date.now()}`,
    mime: asset.mimeType ?? "application/octet-stream",
    size: asset.size,
  };
}

export async function copyText(value: string): Promise<void> {
  await Clipboard.setStringAsync(value);
}

export async function shareText(value: string, title = "Lattice"): Promise<void> {
  await Share.share({ message: value, title });
}

export async function shareUrl(url: string, title = "Lattice"): Promise<void> {
  if (Platform.OS === "ios") {
    await Share.share({ url, title });
    return;
  }
  await Share.share({ message: url, title });
}

export async function shareFile(uri: string, mime: string, title = "Lattice"): Promise<void> {
  if (!(await Sharing.isAvailableAsync())) {
    throw new Error("Sharing is not available on this device.");
  }
  await Sharing.shareAsync(uri, { mimeType: mime, dialogTitle: title });
}
