import { describe, expect, it } from "vitest";
import { assignFinalNames, extractTitle, sanitizeFileStem } from "../src/core/filename.js";

describe("filename rules", () => {
  it("extracts the first meaningful line and decodes common entities", () => {
    expect(extractTitle("<p>  First &amp; best </p><p>second</p>")).toBe("First & best");
  });

  it("makes Windows-safe, non-empty names", () => {
    expect(sanitizeFileStem("CON", "12345678-post")).toBe("_CON");
    expect(sanitizeFileStem("bad:/name*.", "12345678-post")).toBe("bad：／name＊．");
    expect(sanitizeFileStem("", "12345678-post")).toBe("Untitled [12345678]");
  });

  it("uses a sufficiently long stable post-ID suffix for title collisions", () => {
    const names = assignFinalNames([
      { id: "aaaaaaaa-1111", body: "Same", publishedAt: null, thumbnailUrl: null },
      { id: "aaaaaaaa-2222", body: "Same", publishedAt: null, thumbnailUrl: null },
    ]);
    expect(names.get("aaaaaaaa-1111")).toBe("Same [aaaaaaaa-1].mp4");
    expect(names.get("aaaaaaaa-2222")).toBe("Same [aaaaaaaa-2].mp4");
  });

  it("keeps names within a conservative cross-platform component length", () => {
    const longTitle = "😀".repeat(200);
    const names = assignFinalNames([
      { id: "post-0001", body: longTitle, publishedAt: null, thumbnailUrl: null },
      { id: "post-0002", body: longTitle, publishedAt: null, thumbnailUrl: null },
    ]);
    expect(names.get("post-0001")?.length).toBeLessThanOrEqual(240);
    expect(names.get("post-0002")?.length).toBeLessThanOrEqual(240);
  });
});
