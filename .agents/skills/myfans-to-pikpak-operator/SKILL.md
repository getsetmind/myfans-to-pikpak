---
name: myfans-to-pikpak-operator
description: Operate the myfans-to-pikpak CLI safely for diagnostics, planning, synchronization, status, verification, cleanup, and rename rollback. Use when a user asks to import or check authorized MyFans videos in PikPak, or needs help interpreting CLI JSON and stable error codes.
---

# MyFans to PikPak Operator

Use the CLI as the only service interface. Do not reproduce MyFans requests, browser-token extraction, FFmpeg commands, or rclone writes by hand.

## Choose the workflow

- For environment problems, run `doctor --json` and explain failed checks without exposing secrets.
- For a new import, read `references/command-contract.md`. If the user has not supplied a plan ID, run `plans --json`, present the numbered results, and ask which plan to import before running `plan --json`.
- For progress questions, use `status --json`.
- For integrity questions, use `verify --json`.
- For local deletion, use the two-stage cleanup workflow in the reference.
- For undo requests, explain that rollback reverses planned renames only and never deletes uploaded media.

## Safety boundary

Treat `doctor`, `plans`, `plan`, `status`, and `verify` as read-only. Treat `sync`, cleanup execution, and `rollback` as external mutations.

Before any mutation:

1. Confirm the user supplied the plan ID/URL and rclone target; never guess either.
2. Generate or load the relevant plan.
3. Present the exact digest, operation counts, target, warnings, and expiry when applicable.
4. Stop unless the user has explicitly approved that exact digest in the current conversation.
5. Pass that digest through `--confirm`; never bypass, edit, or recompute approval data.

Never accept or print a MyFans token in a command line, log, plan, or response. Authentication comes from `MYFANS_TOKEN` or the configured Chromium debugging endpoint. Do not delete unverified files, files outside `--work-dir`, remote uploads, or unmanaged remote entries.

## Machine-readable operation

Prefer `--json`. Parse only stdout as the documented envelope. Treat a nonzero exit code or `ok: false` as failure. Report the stable error code and actionable message. Keep stderr available for diagnostics, but redact suspected credentials before quoting it.

If `PLAN_STALE` occurs, stop and create a new plan. If `REMOTE_CONFLICT` occurs, do not improvise a move or overwrite; report the conflicting post and paths.

## Finish

After a mutation, run `verify --json` against the synchronization plan. Report verified, missing, size mismatch, and unmanaged counts separately. Do not run cleanup merely because synchronization succeeded.
