import { mkdir, readdir, readFile, stat, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";

const FILE_MAX_CHARS = 20_000;
const USER_MAX_CHARS = 4_000;
const TOTAL_MAX_CHARS = 60_000;
const SKILL_CATALOG_MAX = 64;
const SKILL_CATALOG_CHARS = 24_000;
const SKILL_DEPTH = 6;

const REQUIRED_FILES = ["AGENTS.md", "SOUL.md", "IDENTITY.md"] as const;
const OPTIONAL_FILES = ["USER.md", "BOOTSTRAP.md", "MEMORY.md"] as const;

export type SkillSource = "workspace" | "project" | "personal";

export interface AgentSkill {
    name: string;
    description: string;
    location: string;
    source: SkillSource;
}

export interface WorkspaceBinding {
    workspaceDir: string;
    projectRoot: string;
    /** Skills switched off in `dataclaw.capabilities.json`; they stay on disk but leave the prompt. */
    disabledSkills?: readonly string[];
}

let binding: WorkspaceBinding | undefined;

export function bindAgentWorkspace(next: WorkspaceBinding): void {
    binding = {
        workspaceDir: resolve(next.workspaceDir),
        projectRoot: resolve(next.projectRoot),
        ...(next.disabledSkills?.length ? { disabledSkills: [...new Set(next.disabledSkills)] } : {}),
    };
}

export function currentWorkspace(): WorkspaceBinding {
    return binding ?? {
        workspaceDir: resolveWorkspaceDir(),
        projectRoot: resolve(process.cwd()),
    };
}

/** `DATACLAW_WORKSPACE` wins. Otherwise the workspace is `<project>/workspace`. */
export function resolveWorkspaceDir(options?: { workspaceDir?: string; projectRoot?: string }): string {
    if (options?.workspaceDir?.trim()) return resolve(options.workspaceDir);
    if (process.env.DATACLAW_WORKSPACE?.trim()) return resolve(process.env.DATACLAW_WORKSPACE);
    const root = options?.projectRoot ?? process.cwd();
    return resolve(root, "workspace");
}

export async function ensureWorkspace(workspaceDir: string): Promise<void> {
    const root = resolve(workspaceDir);
    await mkdir(join(root, "memory"), { recursive: true });
    await mkdir(join(root, "skills"), { recursive: true });
    await copyMissing(templatesRoot(), root);
}

/** Bootstrap files for Project Context. Blank optional files are omitted. Missing required files leave a marker. */
export async function loadProjectContext(workspaceDir: string): Promise<string> {
    const root = resolve(workspaceDir);
    const parts: string[] = [`The workspace is ${root}.`, ""];
    let used = parts.join("\n").length;

    for (const name of [...REQUIRED_FILES, ...OPTIONAL_FILES]) {
        const loaded = await readBootstrapFile(join(root, name), name);
        if (!loaded) continue;
        const block = `## ${name}\n\n${loaded}`;
        if (used + block.length > TOTAL_MAX_CHARS) {
            const room = TOTAL_MAX_CHARS - used;
            if (room > 80) parts.push(clip(block, room).text);
            break;
        }
        parts.push(block);
        used += block.length + 2;
    }

    return parts.join("\n\n");
}

export async function loadSkills(workspace: WorkspaceBinding): Promise<AgentSkill[]> {
    const roots: Array<{ source: SkillSource; root: string }> = [
        { source: "workspace", root: join(workspace.workspaceDir, "skills") },
        { source: "project", root: join(workspace.projectRoot, ".agents", "skills") },
        { source: "personal", root: join(homedir(), ".agents", "skills") },
    ];

    const off = new Set(workspace.disabledSkills ?? []);
    const byName = new Map<string, AgentSkill>();
    for (const entry of roots) {
        const files = await findSkillFiles(entry.root, 0);
        for (const location of files) {
            const skill = await readSkill(location, entry.source);
            if (!skill || byName.has(skill.name) || off.has(skill.name)) continue;
            byName.set(skill.name, skill);
        }
    }
    return [...byName.values()];
}

export function formatSkillsForPrompt(skills: readonly AgentSkill[]): string | undefined {
    if (skills.length === 0) return undefined;

    const chosen: AgentSkill[] = [];
    let size = 0;
    for (const skill of skills) {
        if (chosen.length >= SKILL_CATALOG_MAX) break;
        const entry = skillEntry(skill);
        if (size + entry.length > SKILL_CATALOG_CHARS) break;
        chosen.push(skill);
        size += entry.length;
    }

    const omitted = skills.length - chosen.length;
    return [
        "## Skills",
        "Scan this list before answering. When one skill applies, read its SKILL.md at the listed location with the read tool, then follow it. Leave the others unread.",
        "",
        "<available_skills>",
        ...chosen.map(skillEntry),
        "</available_skills>",
        omitted > 0 ? `\n${omitted} more skills were omitted from this list.` : "",
    ].filter(Boolean).join("\n");
}

let promptInflight: Promise<{
    projectContext: string;
    skillsPrompt?: string;
    skills: AgentSkill[];
}> | undefined;
let promptKey = "";

export async function workspacePrompt(workspace: WorkspaceBinding = currentWorkspace()): Promise<{
    projectContext: string;
    skillsPrompt?: string;
    skills: AgentSkill[];
}> {
    const key = `${workspace.workspaceDir}\0${workspace.projectRoot}\0${(workspace.disabledSkills ?? []).join(",")}`;
    if (promptInflight && promptKey === key) return promptInflight;
    promptKey = key;
    const pending = assembleWorkspacePrompt(workspace);
    promptInflight = pending;
    void pending.finally(() => {
        if (promptInflight === pending) promptInflight = undefined;
    });
    return pending;
}

async function assembleWorkspacePrompt(workspace: WorkspaceBinding): Promise<{
    projectContext: string;
    skillsPrompt?: string;
    skills: AgentSkill[];
}> {
    const [projectContext, skills] = await Promise.all([
        loadProjectContext(workspace.workspaceDir),
        loadSkills(workspace),
    ]);
    const skillsPrompt = formatSkillsForPrompt(skills);
    return {
        projectContext,
        ...(skillsPrompt ? { skillsPrompt } : {}),
        skills,
    };
}

function templatesRoot(): string {
    return join(import.meta.dir, "templates");
}

async function copyMissing(from: string, to: string): Promise<void> {
    const entries = await readdir(from, { withFileTypes: true });
    for (const entry of entries) {
        const source = join(from, entry.name);
        const target = join(to, entry.name);
        if (entry.isDirectory()) {
            await mkdir(target, { recursive: true });
            await copyMissing(source, target);
            continue;
        }
        if (entry.isFile() && !await fileExists(target)) {
            await mkdir(dirname(target), { recursive: true });
            await writeFile(target, await readFile(source));
        }
    }
}

async function readBootstrapFile(path: string, name: string): Promise<string | undefined> {
    const optional = (OPTIONAL_FILES as readonly string[]).includes(name);
    if (!await fileExists(path)) {
        return optional ? undefined : "[missing file]";
    }
    const raw = (await readFile(path, "utf8")).trim();
    if (!raw) return optional ? undefined : "[missing file]";
    const max = name === "USER.md" ? USER_MAX_CHARS : FILE_MAX_CHARS;
    return clip(raw, max).text;
}

async function findSkillFiles(root: string, depth: number): Promise<string[]> {
    if (depth > SKILL_DEPTH || !await directoryExists(root)) return [];
    let entries;
    try {
        entries = await readdir(root, { withFileTypes: true });
    } catch {
        return [];
    }
    if (entries.some((entry) => entry.isFile() && entry.name === "SKILL.md")) {
        return [join(root, "SKILL.md")];
    }
    const found: string[] = [];
    for (const entry of entries) {
        if (!entry.isDirectory()) continue;
        if (entry.name === "node_modules" || entry.name.startsWith(".")) continue;
        found.push(...await findSkillFiles(join(root, entry.name), depth + 1));
    }
    return found;
}

async function readSkill(location: string, source: SkillSource): Promise<AgentSkill | undefined> {
    let raw: string;
    try {
        raw = await readFile(location, "utf8");
    } catch {
        return undefined;
    }
    const frontmatter = parseFrontmatter(raw);
    const description = frontmatter.description?.trim();
    if (!description) return undefined;
    const fallback = dirname(location).split(/[/\\]/).pop() ?? "skill";
    const name = (frontmatter.name?.trim() || fallback).replace(/\s+/g, "-");
    return { name, description: description.replace(/\s+/g, " "), location, source };
}

function skillEntry(skill: AgentSkill): string {
    return [
        "  <skill>",
        `    <name>${escapeXml(skill.name)}</name>`,
        `    <description>${escapeXml(skill.description)}</description>`,
        `    <location>${escapeXml(skill.location)}</location>`,
        "  </skill>",
    ].join("\n");
}

export function parseFrontmatter(raw: string): Record<string, string> {
    const match = raw.match(/^---\r?\n([\s\S]*?)\r?\n---/);
    if (!match?.[1]) return {};
    const values: Record<string, string> = {};
    let key: string | undefined;
    let lines: string[] = [];

    const flush = () => {
        if (!key) return;
        values[key] = lines.join(" ").replace(/\s+/g, " ").trim();
        key = undefined;
        lines = [];
    };

    for (const line of match[1].split(/\r?\n/)) {
        const header = /^([A-Za-z0-9_-]+):\s*(.*)$/.exec(line);
        if (header && !/^\s/.test(line)) {
            flush();
            key = header[1];
            const rest = header[2]?.trim() ?? "";
            if (rest !== ">-" && rest !== ">" && rest !== "|" && rest !== "|-") {
                lines = [rest.replace(/^["']|["']$/g, "")];
            }
            continue;
        }
        if (key && /^\s/.test(line)) lines.push(line.trim());
    }
    flush();
    return values;
}

function clip(text: string, max: number): { text: string } {
    if (text.length <= max) return { text };
    const marker = "\n\n[truncated; read the file for the rest]";
    return { text: text.slice(0, Math.max(0, max - marker.length)) + marker };
}

function escapeXml(value: string): string {
    return value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

async function fileExists(path: string): Promise<boolean> {
    try {
        return (await stat(path)).isFile();
    } catch {
        return false;
    }
}

async function directoryExists(path: string): Promise<boolean> {
    try {
        return (await stat(path)).isDirectory();
    } catch {
        return false;
    }
}
