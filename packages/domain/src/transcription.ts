/**
 * Appends a titled section to a capture body. Re-running the same body is a
 * no-op so a retry cannot duplicate text.
 */
export function appendSection(
  existing: string | null,
  heading: string,
  body: string,
): string {
  const current = (existing ?? "").trim();
  const clean = body.trim();
  if (!clean) return current;
  if (current.includes(clean)) return current;
  if (!current) return `### ${heading}\n\n${clean}`;
  return `${current}\n\n### ${heading}\n\n${clean}`;
}

export function appendTranscript(existing: string | null, transcript: string): string {
  return appendSection(existing, "Transcript", transcript);
}

const AUDIO_EXTENSIONS = new Set([
  "mp3",
  "m4a",
  "wav",
  "webm",
  "ogg",
  "oga",
  "opus",
  "aac",
  "flac",
  "mp4",
]);

export function isAudioFilename(name: string): boolean {
  const extension = name.split(".").pop()?.toLowerCase() ?? "";
  return AUDIO_EXTENSIONS.has(extension);
}
