import { describe, expect, it } from "vitest";
import { emptyLedger } from "../src/core/ledger.js";
import {
  assertPlanExecutable,
  assertRemoteSnapshot,
  assertValidPlan,
  buildPlan,
} from "../src/core/plan.js";
import { sha256 } from "../src/core/canonical-json.js";

const posts = [
  { id: "post-0001", body: "One", publishedAt: "2026-01-01T00:00:00Z", thumbnailUrl: null },
  { id: "post-0002", body: "Two", publishedAt: null, thumbnailUrl: null },
  { id: "post-0003", body: "Three", publishedAt: null, thumbnailUrl: null },
];

describe("synchronization plan", () => {
  it("plans per post without requiring equal local and source counts", () => {
    const ledger = emptyLedger("plan-1", "pikpak:Archive");
    const plan = buildPlan({
      planId: "plan-1",
      target: "pikpak:Archive",
      posts,
      remoteFiles: [
        { name: "post-0001.mp4", size: 10 },
        { name: "Two.mp4", size: 20 },
        { name: "unmanaged.txt", size: 1 },
      ],
      localFiles: [{ name: "post-0003.mp4", path: "C:/work/post-0003.mp4", size: 30 }],
      ledger,
      now: new Date("2026-01-01T00:00:00Z"),
    });
    expect(plan.stats).toMatchObject({
      posts: 3,
      rename: 1,
      skip: 1,
      transfer: 1,
      download: 0,
      remoteExtras: 1,
    });
    expect(plan.items.map((item) => item.action)).toEqual(["rename", "skip", "transfer"]);
    expect(plan.warnings).toEqual(["Unmanaged remote file: unmanaged.txt"]);
    expect(() => assertValidPlan(plan)).not.toThrow();
  });

  it("detects content tampering, wrong confirmation, expiry, and remote drift", () => {
    const plan = buildPlan({
      planId: "plan-1",
      target: "pikpak:Archive",
      posts: posts.slice(0, 1),
      remoteFiles: [],
      localFiles: [],
      ledger: emptyLedger("plan-1", "pikpak:Archive"),
      now: new Date("2026-01-01T00:00:00Z"),
      validityMs: 1_000,
    });
    expect(() =>
      assertPlanExecutable(plan, "wrong", new Date("2026-01-01T00:00:00Z")),
    ).toThrowError(/confirmation/i);
    expect(() =>
      assertPlanExecutable(plan, plan.digest, new Date("2026-01-01T00:00:02Z")),
    ).toThrowError(/expired/i);
    expect(() => assertRemoteSnapshot(plan, [{ name: "new.mp4", size: 1 }])).toThrowError(
      /remote changed/i,
    );
    const tampered = structuredClone(plan);
    const tamperedItem = tampered.items[0];
    if (!tamperedItem) throw new Error("fixture plan item is missing");
    tamperedItem.finalName = "changed.mp4";
    expect(() => assertValidPlan(tampered)).toThrowError(/digest/i);

    const malicious = structuredClone(plan);
    const maliciousItem = malicious.items[0];
    if (!maliciousItem) throw new Error("fixture plan item is missing");
    maliciousItem.finalName = "../outside.mp4";
    const { digest: _oldDigest, ...maliciousContent } = malicious;
    malicious.digest = sha256(maliciousContent);
    expect(() => assertValidPlan(malicious)).toThrowError(/invalid|inconsistent/i);
  });

  it("rejects duplicate source IDs", () => {
    const firstPost = posts[0];
    if (!firstPost) throw new Error("post fixture is missing");
    expect(() =>
      buildPlan({
        planId: "plan-1",
        target: "pikpak:Archive",
        posts: [firstPost, firstPost],
        remoteFiles: [],
        localFiles: [],
        ledger: emptyLedger("plan-1", "pikpak:Archive"),
      }),
    ).toThrowError(/duplicate/i);
  });
});
