# Changelog

This project follows Semantic Versioning.

## Unreleased

- Renamed the project, npm package, executable, schemas, and Agent Skills to `myfans-to-pikpak`.
- Added automatic fallback to the legacy `myfans-pikpak` state directory when the new default directory does not exist.
- Added the read-only `plans` command for listing active MyFans subscriptions before planning an import.
- Added the machine-readable `plans` result schema.
- Treat rclone's directory-not-found exit code as an empty new destination while preserving all other remote errors.
- Split the executable entry point, Commander wiring, option validation, output contract, and command implementations into testable modules.
- Reworked the English README from a comparison of uv, mise, GitHub CLI, and rclone, and added a complete Japanese README.
- Included both README languages in the npm package allowlist.

## 1.0.0 - 2026-08-09

- Added the cross-platform TypeScript CLI with `doctor`, `plan`, `sync`, `status`, `verify`, `cleanup`, and `rollback`.
- Added per-post reconciliation, deterministic filenames, collision handling, durable ledgers, and interrupted-run recovery.
- Added persisted synchronization and cleanup plans with explicit digest confirmation.
- Added remote drift checks, immutable rclone writes, media probing, and contained local cleanup.
- Added stable JSON envelopes, JSON Schemas, error codes, fixtures, CI, packaging, and OSS policy files.
- Added repository instructions and separate operator and maintainer Agent Skills without an MCP server.
