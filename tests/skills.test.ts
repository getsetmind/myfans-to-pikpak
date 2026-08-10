import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";

const operatorPath = ".agents/skills/myfans-to-pikpak-operator";
const maintainerPath = ".agents/skills/myfans-to-pikpak-maintainer";

describe("repository Agent Skills", () => {
  it.each([
    [operatorPath, "myfans-to-pikpak-operator"],
    [maintainerPath, "myfans-to-pikpak-maintainer"],
  ])("has portable frontmatter and an explicit default prompt for %s", async (path, name) => {
    const skill = await readFile(`${path}/SKILL.md`, "utf8");
    const frontmatter = skill.match(/^---\r?\n([\s\S]*?)\r?\n---/)?.[1] ?? "";
    const keys = [...frontmatter.matchAll(/^([a-z-]+):/gm)].map((match) => match[1]);
    expect(keys).toEqual(["name", "description"]);
    expect(frontmatter).toContain(`name: ${name}`);
    const openai = await readFile(`${path}/agents/openai.yaml`, "utf8");
    expect(openai).toContain(`$${name}`);
  });

  it("keeps operator mutations behind exact plan approval", async () => {
    const skill = await readFile(`${operatorPath}/SKILL.md`, "utf8");
    expect(skill).toContain("explicitly approved that exact digest");
    expect(skill).toContain("--confirm");
    expect(skill).toContain("two-stage cleanup workflow");
    expect(skill).toContain("Never accept or print a MyFans token");
    expect(skill).toContain("plans --json");
  });

  it("keeps maintainer validation offline and the canonical copy unambiguous", async () => {
    const skill = await readFile(`${maintainerPath}/SKILL.md`, "utf8");
    expect(skill).toContain("Never run live");
    expect(skill).toContain("npm run check");
    expect(skill).toContain(".agents/skills");
    expect(skill).toContain("Do not hand-edit `.claude/skills`");
  });
});
