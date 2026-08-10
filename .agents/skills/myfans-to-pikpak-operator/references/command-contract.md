# Operator command contract

Run an installed release as `myfans-to-pikpak`. Inside this repository, run `npm run build` once and substitute `node dist/cli.js`.

## Read-only import preparation

```text
myfans-to-pikpak doctor --to pikpak:MyFans/example --json
myfans-to-pikpak plans --json
myfans-to-pikpak plan --plan-id PLAN_ID_OR_URL --to pikpak:MyFans/example --out .myfans-to-pikpak/sync-plan.json --json
```

Use `plans` when the user has not supplied a plan ID. Present each plan's ID, name, creator, post count, subscription dates, cancellation state, and URL as a numbered list. Wait for the user to choose one; listing plans does not select or authorize an import.

Show the target, digest, expiry, counts, bytes known before download, collisions, remote extras, and every warning. Planning does not authorize execution.

## Approved synchronization

```text
myfans-to-pikpak sync --plan .myfans-to-pikpak/sync-plan.json --confirm EXACT_SYNC_DIGEST --jobs 2 --json
myfans-to-pikpak verify --plan .myfans-to-pikpak/sync-plan.json --json
```

`--jobs` accepts 1 through 16. Regenerate the plan after `PLAN_STALE`; do not retry it by editing timestamps or snapshots.

## Status

```text
myfans-to-pikpak status --plan-id PLAN_ID_OR_URL --to pikpak:MyFans/example --json
```

## Separately approved cleanup

```text
myfans-to-pikpak cleanup --source-plan .myfans-to-pikpak/sync-plan.json --out .myfans-to-pikpak/cleanup-plan.json --json
myfans-to-pikpak cleanup --plan .myfans-to-pikpak/cleanup-plan.json --confirm EXACT_CLEANUP_DIGEST --json
```

The first command is read-only. Present its exact file list and digest, then wait for approval before the second command. Cleanup only removes still-verified ledger paths beneath the configured work directory.

## Rename rollback

```text
myfans-to-pikpak rollback --plan .myfans-to-pikpak/sync-plan.json --confirm EXACT_SYNC_DIGEST --json
```

Explain before approval that this reverses only `rename` items. It neither removes nor moves back uploaded items.

Global overrides are `--state-dir`, `--work-dir`, and `--cdp-url`. Use them only when the user supplies the alternate location or endpoint. Never pass authentication with an option.
