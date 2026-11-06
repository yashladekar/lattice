export const OCR_MAX_PAGES = 15;
export const MIN_SELECTABLE_CHARS = 25;

export interface OcrProgress {
  stage: string;
  progress: number;
  page?: number;
  pages?: number;
}

/**
 * Whether an extraction produced enough text to be worth keeping. A handful of
 * stray characters usually means a scanned page rather than real content.
 */
export function hasSelectableText(
  text: string | null | undefined,
  minimum = MIN_SELECTABLE_CHARS,
): boolean {
  if (!text) return false;
  return text.replace(/\s+/g, "").length >= minimum;
}

/** Normalizes OCR output: consistent newlines, no trailing spaces, no blank runs. */
export function cleanOcrText(text: string): string {
  return text
    .replace(/\r\n?/g, "\n")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}
