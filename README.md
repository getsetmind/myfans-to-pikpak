# myfans-to-pikpak

[日本語](README.ja.md)

An unofficial, safety-focused CLI for synchronizing MyFans videos you are authorized to access to PikPak through rclone.

The CLI reconciles each post independently across MyFans, a local work directory, and PikPak.
It creates a reviewable plan before any remote write, requires the exact plan digest to execute, refuses overwrites, and keeps local cleanup behind a second confirmation.

> [!WARNING]
> This project is not affiliated with or endorsed by MyFans, PikPak, or rclone.
> Use it only for content you are authorized to access and store.
> You are responsible for complying with service terms, copyright, privacy, and applicable law.

The [MyFans terms reviewed on 2026-08-10](https://myfans.jp/terms) prohibit reposting content without the organizer's prior written consent and prohibit conduct that may infringe the service's intellectual property, including reverse engineering.
Paying for access does not by itself establish permission to use or publish this tool.
Obtain any permission you need from MyFans and the relevant rights holders before use or redistribution.
This notice is not legal advice.

## Project status

The source, tests, schemas, and npm package layout are prepared for a `1.0.0` release.
The package has not been published to npm yet.
The npm release remains gated on confirming publication permission, configuring npm ownership and publishing, and passing CI and tarball review from a clean checkout.

## Highlights

- Reconciles by post instead of assuming source, local, and remote counts match.
- Classifies each post as `skip`, `rename`, or `transfer` before making changes.
- Persists a canonical plan with a SHA-256 digest and a 24-hour expiry.
- Rechecks remote state before writes and uses rclone's immutable mode.
- Saves a durable per-post ledger so interrupted runs can resume safely.
- Requires a separate plan and digest before deleting verified local files.
- Emits one stable JSON envelope on stdout for automation and AI agents.
- Runs deterministic tests without real MyFans or PikPak accounts.
- Supports Windows, macOS, and Linux from the first public release target.

## Requirements

- Node.js 22.12 or newer
- FFmpeg and FFprobe on `PATH`
- rclone on `PATH`
- A PikPak remote configured in rclone
- A MyFans session in a local Chromium-based browser, or `MYFANS_TOKEN` in the process environment

rclone includes a PikPak backend.
Run `rclone config` and follow the [official PikPak configuration guide](https://rclone.org/pikpak/) before using this CLI.

## Installation

Until the first npm release, install from source:

```console
git clone https://github.com/getsetmind/myfans-to-pikpak.git
cd myfans-to-pikpak
npm ci
npm run build
npm link
myfans-to-pikpak --help
```

After the package is published, the global install command will be:

```console
npm install --global myfans-to-pikpak
```

The release notes will state when that package is available.

## Authentication

The CLI deliberately has no token command-line option, because command arguments may remain in shell history or process listings.

For interactive use, start a Chromium-based browser with a dedicated profile and a localhost debugging endpoint, then sign in to MyFans in that browser:

```console
chromium --remote-debugging-port=9222 --user-data-dir=/absolute/path/to/a/dedicated-profile
```

The executable name and path differ by operating system and browser.
Keep the endpoint on localhost, do not expose the port to a network, and close the browser when finished.
The CLI reads the session from a MyFans tab at `http://127.0.0.1:9222` by default.
Use the global `--cdp-url` option for a different local endpoint.

For non-interactive use, provide `MYFANS_TOKEN` through the process environment.
Do not store the value in repository files, shared logs, plan files, or shell scripts.
PikPak credentials remain in rclone's configuration and are never read directly by this CLI.

## Quick start

The normal workflow is deliberately split into read-only planning and explicitly confirmed execution:

```text
doctor -> plans -> plan -> review digest -> sync -> verify
                              |
                              +-> separate cleanup plan -> review digest -> cleanup
```

### 1. Check the environment

`doctor` checks Node.js, FFmpeg, FFprobe, rclone, MyFans authentication, and whether the named rclone remote is configured.
It does not change MyFans, local media, or PikPak.

```console
myfans-to-pikpak doctor --to pikpak:MyFans/example --json
```

### 2. List available plans

If you do not know the target plan ID, list the active subscriptions for the signed-in account:

```console
myfans-to-pikpak plans --json
```

The result includes each plan's ID, URL, name, creator, post count, subscription date, and renewal or expiry date when available.
This command is read-only.

### 3. Create a synchronization plan

Pass either a plan ID or a MyFans plan URL.
The destination must be an rclone remote path.

```console
myfans-to-pikpak plan --plan-id PLAN_ID_OR_URL --to pikpak:MyFans/example --out .myfans-to-pikpak/sync-plan.json --json
```

Review the items, counts, warnings, expiry, and 64-character `digest` in the result.
The plan file contains private titles and local paths, so never commit or share it.
The CLI will not overwrite an existing plan file.

If the destination folder does not exist, `plan` treats it as a new empty folder.
Authentication, connectivity, and other rclone errors still fail with `REMOTE_ERROR`.

### 4. Execute exactly the reviewed plan

Only proceed if the plan is correct.
Copy the digest exactly as printed:

```console
myfans-to-pikpak sync --plan .myfans-to-pikpak/sync-plan.json --confirm EXACT_SYNC_DIGEST --jobs 2 --json
```

`sync` rejects a wrong digest, a modified or expired plan, changed remote state, and an existing upload destination.
The `--jobs` value must be from 1 to 16.

### 5. Verify the result

```console
myfans-to-pikpak verify --plan .myfans-to-pikpak/sync-plan.json --json
```

Do not prepare cleanup unless verification succeeds.
For providers that do not expose a usable hash, verification is limited to the expected filename and known size.

## Local cleanup

A successful sync is not permission to delete local media.
Prepare a separate cleanup plan from the verified synchronization plan:

```console
myfans-to-pikpak cleanup --source-plan .myfans-to-pikpak/sync-plan.json --out .myfans-to-pikpak/cleanup-plan.json --json
```

Review every path and the new digest, then execute only if correct:

```console
myfans-to-pikpak cleanup --plan .myfans-to-pikpak/cleanup-plan.json --confirm EXACT_CLEANUP_DIGEST --json
```

Cleanup deletes only regular files that are verified in the ledger, unchanged since planning, and physically contained by the configured work directory.
It never changes PikPak.

## Commands

| Command | Changes state | Purpose |
|---|---:|---|
| `doctor` | No | Check local dependencies, MyFans authentication, and optional rclone configuration. |
| `plans` | No | List active plans for the signed-in MyFans account. |
| `plan` | No | Create per-post `skip`, `rename`, and `transfer` actions. |
| `sync` | Yes, remote and local work state | Execute one current plan with its exact digest. |
| `status` | No | Read the durable ledger and run history. |
| `verify` | No | Compare planned names and known sizes with PikPak. |
| `cleanup` | Local files only | Prepare or execute a separately confirmed cleanup plan. |
| `rollback` | Remote renames only | Reverse renames recorded for a confirmed sync plan. |

`rollback` never deletes uploaded media and never changes unmanaged remote files.
Run `myfans-to-pikpak <command> --help` for command-specific options.

## Reconciliation and filenames

The first non-empty line of a post is used as its title.
The filename logic normalizes Unicode, replaces characters forbidden on Windows, handles empty titles and reserved names, removes invalid trailing characters, and limits length.

When multiple posts have the same title, the shortest unambiguous post ID prefix is added:

```text
Same title [12345678].mp4
```

For each post, an existing final title is `skip`, an existing legacy `POST_ID.mp4` is `rename`, and a missing remote item is `transfer`.
Transfer reuses a matching local file when available and downloads from MyFans only when needed.
Unmanaged remote files are reported as warnings and left untouched.

## JSON and automation contract

All primary commands accept the global `--json` option.
stdout contains exactly one JSON object; diagnostics remain on stderr.

```json
{
  "schemaVersion": 1,
  "command": "plan",
  "ok": true,
  "result": {},
  "warnings": [],
  "error": null
}
```

Machine-readable contracts are published in [`schemas/`](schemas).
Scripts should branch on `ok`, `error.code`, and the process exit code instead of parsing message text.

| Exit | Error code | Meaning |
|---:|---|---|
| 1 | `INTERNAL_ERROR` | An unclassified internal error occurred. |
| 2 | `USAGE_ERROR` | An option, identifier, target, or job count is invalid. |
| 3 | `DEPENDENCY_MISSING` | A required executable is unavailable on `PATH`. |
| 3 | `AUTH_REQUIRED` | MyFans authentication could not be obtained. |
| 4 | `SOURCE_ERROR` | The MyFans response or post data is invalid. |
| 5 | `REMOTE_ERROR` | rclone or the configured remote failed. |
| 6 | `REMOTE_CONFLICT` | Remote entries cannot be reconciled safely. |
| 7 | `PLAN_INVALID` | A plan structure, digest, or local path is invalid. |
| 7 | `PLAN_STALE` | A plan expired or external state changed after planning. |
| 7 | `PLAN_NOT_CONFIRMED` | `--confirm` does not match the plan digest. |
| 8 | `DOWNLOAD_FAILED` | HTTP or FFmpeg download failed. |
| 9 | `VERIFY_FAILED` | Media or remote verification failed. |
| 10 | `STATE_ERROR` | A ledger or state file could not be read or written. |

Error messages may improve between releases, but these codes are the automation contract for schema version 1.

## State and private files

The default state directories are:

| OS | State directory |
|---|---|
| Windows | `%LOCALAPPDATA%\myfans-to-pikpak` |
| macOS | `~/Library/Application Support/myfans-to-pikpak` |
| Linux | `$XDG_STATE_HOME/myfans-to-pikpak`, or `~/.local/state/myfans-to-pikpak` |

If the new directory does not exist but the legacy `myfans-pikpak` directory does, the CLI reuses the legacy directory without moving or deleting it.
If both directories exist, the new `myfans-to-pikpak` directory takes precedence.

Use `--state-dir` and `--work-dir` to override them.
Filesystem roots are rejected for both options.
State is saved atomically after per-post transitions so completed work remains visible after interruption.

Treat plan files, cleanup plans, ledgers, browser profiles, rclone configuration, and downloaded media as private.
The repository ignore rules exclude the standard local paths, but you should still inspect every commit and package before publication.

## Using the CLI with AI agents

This project uses the CLI itself as the agent contract and does not provide an MCP server.
Stable JSON, JSON Schema, error codes, persisted plans, and digest confirmation make the same interface usable by humans, scripts, and agents.

For an import operation in Codex, use the repository skill:

```text
Use $myfans-to-pikpak-operator to create a synchronization plan for PLAN_ID_OR_URL
to pikpak:MyFans/example. Run doctor and the read-only plan step, then report the
actions, counts, warnings, expiry, and digest. Do not run sync until I approve
that exact digest. Never expose tokens, private titles, or local absolute paths.
```

For maintenance work:

```text
Use $myfans-to-pikpak-maintainer to implement this change. Preserve the safety
invariants and JSON contracts, use only synthetic fixtures, and run npm run check.
Report changed files, verification results, and remaining limitations.
```

The canonical instructions are [`AGENTS.md`](AGENTS.md) and [`.agents/skills`](.agents/skills).
Claude Code copies are generated in `.claude/skills`, while `.github/copilot-instructions.md` points compatible agents to the same rules.
Agents without Skill discovery can read the relevant `SKILL.md` directly and operate the documented CLI commands.

The repository layout keeps the CLI primary while making Agent Skills discoverable, following patterns seen in [uv](https://github.com/astral-sh/uv), [mise](https://github.com/jdx/mise), [GitHub CLI](https://github.com/cli/cli), and [rclone](https://github.com/rclone/rclone).

## Troubleshooting

- `AUTH_REQUIRED`: confirm that the dedicated Chromium instance is running, signed in to MyFans, and reachable at the selected local CDP URL.
- `DEPENDENCY_MISSING`: install the named executable and confirm it is available on `PATH`.
- `REMOTE_ERROR`: run `rclone listremotes`, verify the remote name, and test the remote with rclone directly.
- `PLAN_STALE`: do not retry the old plan; create and review a new one.
- `VERIFY_FAILED`: keep local files and inspect the reported names or sizes before any cleanup.
- `REMOTE_CONFLICT`: preserve both sides, inspect the unexpected file, and create a new plan after resolving the conflict.

## Development

```console
npm ci
npm run check
npm audit --omit=dev
npm pack --dry-run
```

`npm run check` verifies generated Agent Skills, formatting, lint, TypeScript, coverage thresholds, the production build, and CLI smoke behavior.
Tests use fake MyFans, media, process, and storage boundaries and must not contact live services.

The CLI is organized as follows:

```text
src/cli.ts       executable entry point
src/cli/         Commander program, options, and output contract
src/commands/    one module per public command
src/core/        deterministic plans, naming, validation, and safety policy
src/services/    synchronization orchestration
src/adapters/    MyFans, browser auth, FFmpeg, rclone, and processes
src/state/       atomic plans and ledgers
schemas/         public JSON Schema contracts
```

Before contributing, read [`AGENTS.md`](AGENTS.md), keep changes focused, use synthetic fixtures, and run the four commands above.
Bug reports should include the CLI version, operating system, Node.js version, command, stable error code, and sanitized output.
Do not open a public issue for credential exposure, unintended overwrite or deletion, path traversal, or authentication bypass.
Use GitHub private vulnerability reporting when available, or contact the maintainer privately without sending credentials or private media.

## Limitations

- The MyFans adapter depends on an undocumented interface and may break when the service changes.
- The tool does not bypass DRM or access controls.
- A plan expires after 24 hours.
- Verification may be limited to filename and known size when PikPak does not return a usable hash.
- Publication and use may require permission beyond ordinary account access.

## License

The project is available under the [MIT License](LICENSE).
Product names and trademarks belong to their respective owners.
