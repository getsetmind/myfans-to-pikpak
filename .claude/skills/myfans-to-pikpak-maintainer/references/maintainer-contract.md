# Maintainer contract

## Source map

- `src/core`: canonical JSON, filenames, plan validation, cleanup plans, ledger types, and stable errors. Keep it free of service I/O.
- `src/adapters`: authentication, MyFans, FFmpeg/FFprobe, rclone, and child processes.
- `src/services`: local discovery and synchronization orchestration.
- `src/state`: platform paths and atomic JSON persistence.
- `src/cli.ts`: minimal executable entry point.
- `src/cli`: Commander wiring, shared option parsing, and JSON envelope output.
- `src/commands`: one implementation module for each public CLI command.
- `schemas`: published machine-readable contracts.
- `tests`: deterministic unit, integration, and contract tests.

## Required checks

Use Node.js 22.12 or newer.

```text
npm ci
npm run check
npm audit --omit=dev
npm pack --dry-run
```

When a canonical skill changes, `npm run agents:sync` updates the generated Claude copies. `npm run agents:check` fails if they drift.

## Contract changes

Keep the common envelope shape stable: `schemaVersion`, `command`, `ok`, `result`, `warnings`, and `error`. JSON goes to stdout; diagnostics go to stderr. Never add progress lines to JSON stdout.

Schema version changes require matching runtime validation, files in `schemas`, tests, README examples, changelog notes, and an explicit compatibility decision.

## Safety tests

For relevant changes, cover:

- wrong digest, tampered plan, expired sync plan, and changed remote snapshot;
- an external remote change between writes;
- title sanitization, empty titles, reserved Windows names, Unicode, long names, and collisions;
- interrupted state updates and retry behavior;
- cleanup path containment and post-plan ledger drift;
- rollback conflicts and the rule that uploads remain;
- credential redaction and one valid JSON document on stdout;
- path and executable discovery on Windows, macOS, and Linux.

Live service tests are manual release checks and must be opt-in. Never put a personal plan ID, destination path, token, downloaded filename, or private manifest in the repository.
