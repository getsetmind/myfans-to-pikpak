import { describe, expect, it } from "vitest";
import { createProgram } from "../src/cli/program.js";
import { nodeVersionIsSupported, parseJobs, parsePlanId } from "../src/cli/options.js";

describe("CLI program", () => {
  it("uses the public myfans-to-pikpak command name", () => {
    expect(createProgram().name()).toBe("myfans-to-pikpak");
  });

  it("registers the complete public command set", () => {
    const commandNames = createProgram()
      .commands.map((command) => command.name())
      .sort();

    expect(commandNames).toEqual([
      "cleanup",
      "doctor",
      "plan",
      "plans",
      "rollback",
      "status",
      "sync",
      "verify",
    ]);
  });
});

describe("CLI option parsing", () => {
  it("accepts a bare plan ID or a MyFans plan URL", () => {
    expect(parsePlanId("synthetic-plan_01")).toBe("synthetic-plan_01");
    expect(parsePlanId("https://myfans.jp/plans/synthetic-plan_01")).toBe("synthetic-plan_01");
  });

  it("rejects plan URLs outside MyFans", () => {
    expect(() => parsePlanId("https://example.com/plans/synthetic-plan_01")).toThrow(
      "myfans.jp domain",
    );
  });

  it("limits parallel jobs to the documented range", () => {
    expect(parseJobs("2")).toBe(2);
    expect(() => parseJobs("0")).toThrow("integer from 1 to 16");
    expect(() => parseJobs("17")).toThrow("integer from 1 to 16");
    expect(() => parseJobs("2.5")).toThrow("integer from 1 to 16");
    expect(() => parseJobs("2jobs")).toThrow("integer from 1 to 16");
    expect(() => parseJobs("two")).toThrow("integer from 1 to 16");
  });

  it("checks the complete minimum Node.js version", () => {
    expect(nodeVersionIsSupported("22.12.0")).toBe(true);
    expect(nodeVersionIsSupported("22.11.0")).toBe(false);
    expect(nodeVersionIsSupported("23.0.0")).toBe(true);
  });
});
