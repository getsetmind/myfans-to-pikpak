---
name: myfans-to-pikpak-maintainer
description: Develop, review, test, and release the TypeScript myfans-to-pikpak CLI while preserving its plan-confirm-execute safety model, JSON contracts, cross-platform behavior, and credential boundaries. Use for repository code changes, bug fixes, dependency updates, reviews, schemas, documentation, or releases.
---

# MyFans to PikPak Maintainer

Read `AGENTS.md`, then read `references/maintainer-contract.md` before changing behavior. Inspect the working tree and preserve private ignored migration artifacts.

## Work from invariants

- Keep MyFans, media, and rclone integrations behind ports; core planning must remain deterministic and testable without services.
- External writes require a persisted plan and exact digest confirmation.
- Re-check remote state before each write and prohibit overwrites.
- Keep local cleanup in its own plan-confirm-execute flow.
- Rollback may reverse renames but must never delete uploaded media.
- Keep credentials out of argv, stdout, errors, plans, ledgers, fixtures, and snapshots.
- Do not restore a global source/local/remote file-count assumption. Decide per post.

## Change workflow

1. Locate the smallest owning module using the map in the reference.
2. Add or update deterministic tests before changing a safety boundary.
3. Update JSON Schema and public docs when a machine-readable contract changes.
4. Preserve stable error codes; add a documented code rather than parsing prose.
5. Use fixtures and fake ports. Never run live `sync`, cleanup execution, or `rollback` while testing.
6. Run `npm run check` and inspect `npm pack --dry-run` before release work.

Edit canonical skills only under `.agents/skills`, then run `npm run agents:sync`. Do not hand-edit `.claude/skills`.

## Review focus

Prioritize credential exposure, unintended overwrite/delete, path traversal, stale-plan races, interrupted-run recovery, filename collisions, schema drift, stdout contamination in JSON mode, and Windows/macOS/Linux differences. Treat missing negative tests for these boundaries as defects.
