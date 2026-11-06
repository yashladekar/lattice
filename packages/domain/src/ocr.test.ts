import { describe, expect, it } from "vitest";

import { cleanOcrText, hasSelectableText } from "./ocr";

describe("ocr helpers", () => {
  it("treats near-empty extractions as scanned pages", () => {
    expect(hasSelectableText("")).toBe(false);
    expect(hasSelectableText(null)).toBe(false);
    expect(hasSelectableText("   \n  ")).toBe(false);
    expect(hasSelectableText("page 1")).toBe(false);
    expect(hasSelectableText("This paragraph has enough real letters in it.")).toBe(true);
  });

  it("honors a custom minimum", () => {
    expect(hasSelectableText("abcd", 4)).toBe(true);
    expect(hasSelectableText("abc", 4)).toBe(false);
  });

  it("normalizes OCR whitespace", () => {
    expect(cleanOcrText("Hello   \r\nWorld\r\n\r\n\r\n\r\nEnd  ")).toBe("Hello\nWorld\n\nEnd");
    expect(cleanOcrText("   ")).toBe("");
  });
});
