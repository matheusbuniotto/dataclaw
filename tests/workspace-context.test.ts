import { expect, test } from "bun:test";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
    ensureWorkspace,
    formatSkillsForPrompt,
    loadProjectContext,
    loadSkills,
    parseFrontmatter,
} from "../src/workspace/context";

test("workspace bootstrap and skills follow the OpenClaw load order", async () => {
    const root = await mkdtemp(join(tmpdir(), "dataclaw-workspace-"));
    const workspaceDir = join(root, "workspace");
    const projectRoot = join(root, "project");
    try {
        await ensureWorkspace(workspaceDir);
        const original = await readFile(join(workspaceDir, "AGENTS.md"), "utf8");
        expect(original).toContain("data-exploration");
        await writeFile(join(workspaceDir, "AGENTS.md"), "custom agents\n");
        await ensureWorkspace(workspaceDir);
        expect(await readFile(join(workspaceDir, "AGENTS.md"), "utf8")).toBe("custom agents\n");

        await mkdir(join(projectRoot, ".agents", "skills", "data-exploration"), { recursive: true });
        await writeFile(join(projectRoot, ".agents", "skills", "data-exploration", "SKILL.md"), [
            "---",
            "name: data-exploration",
            "description: >-",
            "  Project copy that must lose to the workspace skill.",
            "---",
            "",
            "project body",
            "",
        ].join("\n"));
        await mkdir(join(projectRoot, ".agents", "skills", "notes"), { recursive: true });
        await writeFile(join(projectRoot, ".agents", "skills", "notes", "SKILL.md"), "# no frontmatter\n");

        const skills = await loadSkills({ workspaceDir, projectRoot });
        const exploration = skills.find((skill) => skill.name === "data-exploration");
        expect(exploration?.source).toBe("workspace");
        expect(exploration?.location.endsWith(join("skills", "data-exploration", "SKILL.md"))).toBe(true);
        expect(skills.some((skill) => skill.name === "notes")).toBe(false);

        const catalog = formatSkillsForPrompt(skills);
        expect(catalog).toContain("<available_skills>");
        expect(catalog).toContain("<name>data-exploration</name>");
        expect(catalog).toContain("read its SKILL.md");
        expect(catalog).toContain(exploration?.location ?? "");

        await rm(join(workspaceDir, "AGENTS.md"));
        await rm(join(workspaceDir, "USER.md"));
        const context = await loadProjectContext(workspaceDir);
        expect(context).toContain("## AGENTS.md");
        expect(context).toContain("[missing file]");
        expect(context).not.toContain("## USER.md");
        expect(context).toContain("## SOUL.md");

        await writeFile(join(workspaceDir, "USER.md"), "x".repeat(5_000));
        const withUser = await loadProjectContext(workspaceDir);
        expect(withUser).toContain("## USER.md");
        expect(withUser).toContain("[truncated; read the file for the rest]");
        expect(withUser.length).toBeLessThan(60_500);
    } finally {
        await rm(root, { recursive: true, force: true });
    }
});

test("skill frontmatter keeps a folded description", () => {
    const parsed = parseFrontmatter([
        "---",
        "name: data-exploration",
        "description: >-",
        "  Explore local CSV or JSON",
        "  and Databricks.",
        "---",
        "",
        "body",
    ].join("\n"));
    expect(parsed.name).toBe("data-exploration");
    expect(parsed.description).toBe("Explore local CSV or JSON and Databricks.");
});
