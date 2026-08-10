import { readFile, stat, writeFile } from "node:fs/promises";

const [statePath, command, ...args] = process.argv.slice(2);
if (!statePath || !command) fail("missing fake rclone arguments");

const state = JSON.parse(await readFile(statePath, "utf8"));
const files = state.files ?? {};

if (command === "listremotes") {
  process.stdout.write("pikpak:\n");
} else if (command === "lsjson") {
  if ((state.missingTargets ?? []).includes(args[0])) fail("directory not found", 3);
  if ((state.listFailureTargets ?? []).includes(args[0])) fail("remote access denied", 1);
  process.stdout.write(
    JSON.stringify(
      Object.entries(files).map(([Name, Size]) => ({ Name, Path: Name, Size })),
    ),
  );
} else if (command === "moveto") {
  const from = remoteName(args[0]);
  const to = remoteName(args[1]);
  if (files[from] === undefined || files[to] !== undefined) fail("immutable move rejected");
  files[to] = files[from];
  delete files[from];
  await save();
} else if (command === "copyto") {
  const localPath = args[0];
  const to = remoteName(args[1]);
  if (!localPath || files[to] !== undefined) fail("immutable copy rejected");
  files[to] = (await stat(localPath)).size;
  await save();
} else {
  fail(`unsupported fake rclone command: ${command}`);
}

async function save() {
  await writeFile(statePath, `${JSON.stringify({ files })}\n`, "utf8");
}

function remoteName(value) {
  if (!value) fail("missing remote path");
  const slash = value.lastIndexOf("/");
  return slash >= 0 ? value.slice(slash + 1) : value.slice(value.indexOf(":") + 1);
}

function fail(message, exitCode = 1) {
  process.stderr.write(`${message}\n`);
  process.exit(exitCode);
}
