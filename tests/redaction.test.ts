import { describe, expect, it } from "vitest";
import { redactText, redactValue } from "../src/core/redaction.js";

describe("credential redaction", () => {
  it("removes known and structured credentials from messages and details", () => {
    const secret = "private-value-123";
    expect(redactText(`failed: ${secret} Token token=another`, [secret])).toBe(
      "failed: [REDACTED] [REDACTED]",
    );
    const redacted = redactValue(
      {
        nested: [`Bearer abc.def`, secret],
        authorization: "anything",
        safe: "kept",
      },
      [secret],
    );
    expect(JSON.stringify(redacted)).not.toContain(secret);
    expect(redacted).toMatchObject({ authorization: "[REDACTED]", safe: "kept" });
  });
});
