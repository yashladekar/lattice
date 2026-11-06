import { describe, expect, it } from "vitest";

import { captureFromEmail, htmlToText } from "./email-ingest";

describe("email ingestion", () => {
  it("uses the plain text body and subject", () => {
    const draft = captureFromEmail({
      subject: "Reading list",
      text: "Three papers to read this week.",
      from: "ada@example.com",
      to: "inbox@lattice.local",
    });
    expect(draft).toEqual({
      title: "Reading list",
      content: "Three papers to read this week.",
      source: "ada@example.com",
      metadata: { from: "ada@example.com", to: "inbox@lattice.local" },
    });
  });

  it("falls back to HTML when there is no text part", () => {
    const draft = captureFromEmail({
      subject: "Hello",
      html: "<p>First line</p><p>Second &amp; last</p><script>alert(1)</script>",
    });
    expect(draft?.content).toBe("First line\nSecond & last");
  });

  it("keeps the subject when the body is empty", () => {
    const draft = captureFromEmail({ subject: "Only a subject" });
    expect(draft?.content).toBe("Only a subject");
  });

  it("returns null when there is nothing to capture", () => {
    expect(captureFromEmail({})).toBeNull();
    expect(captureFromEmail({ text: "   ", html: "<p> </p>" })).toBeNull();
  });

  it("strips markup and dangerous blocks", () => {
    expect(htmlToText("<style>.x{}</style><b>Hi</b><br>there")).toBe("Hi\nthere");
  });
});
