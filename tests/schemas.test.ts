import { readFile } from "node:fs/promises";
import { Ajv2020 } from "ajv/dist/2020.js";
import { describe, expect, it } from "vitest";
import { buildCleanupPlan } from "../src/core/cleanup-plan.js";
import { emptyLedger } from "../src/core/ledger.js";
import { buildPlan } from "../src/core/plan.js";

describe("published JSON schemas", () => {
  it("accepts generated synchronization and cleanup plans", async () => {
    const ajv = new Ajv2020({ validateFormats: false });
    const syncSchema = JSON.parse(await readFile("schemas/sync-plan.schema.json", "utf8"));
    const cleanupSchema = JSON.parse(await readFile("schemas/cleanup-plan.schema.json", "utf8"));
    const plansSchema = JSON.parse(await readFile("schemas/plans.schema.json", "utf8"));
    const ledgerSchema = JSON.parse(await readFile("schemas/ledger.schema.json", "utf8"));
    const envelopeSchema = JSON.parse(await readFile("schemas/envelope.schema.json", "utf8"));
    const ledger = emptyLedger("plan-1", "pikpak:Archive");
    const plan = buildPlan({
      planId: "plan-1",
      target: "pikpak:Archive",
      remoteFiles: [],
      localFiles: [],
      ledger,
      posts: [{ id: "post-0001", body: "One", publishedAt: null, thumbnailUrl: null }],
    });
    ledger.runs.push({
      planDigest: plan.digest,
      startedAt: "2026-01-01T00:00:00.000Z",
      completedAt: "2026-01-01T00:00:01.000Z",
      completedItems: 1,
      status: "completed",
    });
    expect(ajv.validate(syncSchema, plan), JSON.stringify(ajv.errors)).toBe(true);
    expect(
      ajv.validate(cleanupSchema, buildCleanupPlan(plan, ledger)),
      JSON.stringify(ajv.errors),
    ).toBe(true);
    expect(
      ajv.validate(plansSchema, {
        count: 1,
        plans: [
          {
            id: "fixture-plan-0001",
            name: "Fixture Gold",
            postsCount: 12,
            creatorUsername: "fixture_creator",
            creatorName: "Fixture Creator",
            url: "https://myfans.jp/fixture_creator/plans/fixture-plan-0001",
            subscriptionId: "fixture-subscription-0001",
            subscribedAt: "2026-01-01T00:00:00Z",
            activeUntil: "2026-02-01T00:00:00Z",
            willCancel: false,
          },
        ],
      }),
      JSON.stringify(ajv.errors),
    ).toBe(true);
    expect(ajv.validate(ledgerSchema, ledger), JSON.stringify(ajv.errors)).toBe(true);
    expect(
      ajv.validate(envelopeSchema, {
        schemaVersion: 1,
        command: "plan",
        ok: true,
        result: { digest: plan.digest },
        warnings: [],
        error: null,
      }),
      JSON.stringify(ajv.errors),
    ).toBe(true);
    expect(
      ajv.validate(envelopeSchema, {
        schemaVersion: 1,
        command: "sync",
        ok: false,
        result: null,
        warnings: [],
        error: { code: "PLAN_STALE", message: "stale" },
      }),
      JSON.stringify(ajv.errors),
    ).toBe(true);
  });
});
