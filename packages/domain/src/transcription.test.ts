import { describe, expect, it } from "vitest";

import { appendSection, appendTranscript, isAudioFilename } from "./transcription";

describe("transcription helpers", () => {
  it("appends a transcript under a heading", () => {
    expect(appendTranscript("Interview notes", "We talked about spacing.")).toBe(
      "Interview notes\n\n### Transcript\n\nWe talked about spacing.",
    );
  });

  it("appends any titled section once", () => {
    expect(appendSection("PDF capture", "Extracted text", "Chapter one")).toBe(
      "PDF capture\n\n### Extracted text\n\nChapter one",
    );
    expect(appendSection("PDF capture", "Extracted text", "")).toBe("PDF capture");
  });

  it("turns an empty capture into a transcript", () => {
    expect(appendTranscript(null, "  hello  ")).toBe("### Transcript\n\nhello");
  });

  it("is idempotent for the same transcript", () => {
    const once = appendTranscript("Notes", "hello");
    expect(appendTranscript(once, "hello")).toBe(once);
    expect(appendTranscript("Notes", "   ")).toBe("Notes");
  });

  it("recognizes audio file names", () => {
    expect(isAudioFilename("meeting.mp3")).toBe(true);
    expect(isAudioFilename("voice-note.M4A")).toBe(true);
    expect(isAudioFilename("recording.webm")).toBe(true);
    expect(isAudioFilename("notes.pdf")).toBe(false);
    expect(isAudioFilename("noextension")).toBe(false);
  });
});
