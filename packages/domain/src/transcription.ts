/**
 * Appends a transcript to a capture body. Re-running the same transcript is a
 * no-op so a retry cannot duplicate text.
 */
export function appendTranscript(existing: string | null, transcript: string): string {
  const current = (existing ?? "").trim();
  const clean = transcript.trim();
  if (!clean) return current;
  if (current.includes(clean)) return current;
  if (!current) return `### Transcript\n\n${clean}`;
  return `${current}\n\n### Transcript\n\n${clean}`;
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
