import { readFile } from "node:fs/promises";

const packageJson = JSON.parse(await readFile(new URL("../package.json", import.meta.url), "utf8"));
const expected = `v${packageJson.version}`;
const actual = process.env.GITHUB_REF_NAME ?? process.argv[2];

if (actual !== expected) {
  throw new Error(
    `Release tag ${actual ?? "(missing)"} does not match package version ${expected}.`,
  );
}

process.stdout.write(`Release tag matches package version: ${expected}\n`);
