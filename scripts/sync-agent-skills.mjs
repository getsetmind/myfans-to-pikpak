import { cp, mkdir, readdir, readFile, rm } from "node:fs/promises";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const source = resolve(repositoryRoot, ".agents", "skills");
const target = resolve(repositoryRoot, ".claude", "skills");
const mode = process.argv[2];

if (!target.startsWith(`${repositoryRoot}\\`) && !target.startsWith(`${repositoryRoot}/`)) {
  throw new Error("Generated skill target is outside the repository.");
}
if (mode !== "--write" && mode !== "--check") {
  throw new Error("Usage: node scripts/sync-agent-skills.mjs --write|--check");
}

const sourceFiles = await snapshot(source);
if (mode === "--check") {
  const targetFiles = await snapshot(target).catch(() => new Map());
  const drift = [...new Set([...sourceFiles.keys(), ...targetFiles.keys()])].filter(
    (path) => sourceFiles.get(path) !== targetFiles.get(path),
  );
  if (drift.length > 0) {
    process.stderr.write(
      `Generated Claude skills are stale:\n${drift.join("\n")}\nRun npm run agents:sync.\n`,
    );
    process.exitCode = 1;
  } else {
    process.stdout.write("Generated Claude skills match .agents/skills.\n");
  }
} else {
  await mkdir(dirname(target), { recursive: true });
  await rm(target, { recursive: true, force: true });
  await cp(source, target, { recursive: true });
  process.stdout.write("Synchronized .agents/skills to .claude/skills.\n");
}

async function snapshot(root) {
  const result = new Map();
  await visit(root);
  return result;

  async function visit(directory) {
    const entries = await readdir(directory, { withFileTypes: true });
    for (const entry of entries) {
      const absolute = join(directory, entry.name);
      if (entry.isDirectory()) {
        await visit(absolute);
      } else if (entry.isFile()) {
        result.set(
          relative(root, absolute).replaceAll("\\", "/"),
          await readFile(absolute, "utf8"),
        );
      }
    }
  }
}
