import { spawn } from "node:child_process";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

const cli = resolve("dist", "cli.js");
const packageJson = JSON.parse(await readFile(resolve("package.json"), "utf8"));

const version = await run(["--version"]);
assert(
  version.code === 0 && version.stdout.trim() === packageJson.version,
  "CLI version drifted from package.json",
);

const help = await run(["--help"]);
assert(help.code === 0, "--help did not exit successfully");
assert(
  help.stdout.includes("Usage: myfans-to-pikpak") &&
    help.stdout.includes("doctor") &&
    help.stdout.includes("plans") &&
    help.stdout.includes("rollback"),
  "--help omitted commands",
);

const status = await run([
  "status",
  "--plan-id",
  "synthetic-plan",
  "--to",
  "pikpak:Synthetic",
  "--state-dir",
  resolve(".smoke-state-that-does-not-exist"),
  "--json",
]);
assert(status.code === 0, "status smoke test failed");
const statusEnvelope = parseOneJson(status.stdout);
assert(
  statusEnvelope.ok === true && statusEnvelope.command === "status",
  "status envelope is invalid",
);

const secret = "smoke-secret-value";
const failure = await run(
  ["sync", "--plan", resolve(`${secret}-missing.json`), "--confirm", "wrong", "--json"],
  { ...process.env, MYFANS_TOKEN: secret },
);
assert(failure.code === 7, "invalid plan returned the wrong exit code");
assert(
  !failure.stdout.includes(secret) && !failure.stderr.includes(secret),
  "CLI output exposed a known secret",
);
const failureEnvelope = parseOneJson(failure.stdout);
assert(
  failureEnvelope.ok === false && failureEnvelope.error?.code === "PLAN_INVALID",
  "failure envelope is invalid",
);

process.stdout.write("CLI smoke tests passed.\n");

function run(args, env = process.env) {
  return new Promise((resolveRun, rejectRun) => {
    const child = spawn(process.execPath, [cli, ...args], {
      env,
      windowsHide: true,
      stdio: ["ignore", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";
    child.stdout.setEncoding("utf8").on("data", (chunk) => {
      stdout += chunk;
    });
    child.stderr.setEncoding("utf8").on("data", (chunk) => {
      stderr += chunk;
    });
    child.once("error", rejectRun);
    child.once("close", (code) => resolveRun({ code: code ?? 1, stdout, stderr }));
  });
}

function parseOneJson(output) {
  const trimmed = output.trim();
  assert(trimmed.startsWith("{") && trimmed.endsWith("}"), "stdout is not one JSON object");
  try {
    return JSON.parse(trimmed);
  } catch (error) {
    throw new Error(
      `stdout is invalid JSON: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
}

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}
