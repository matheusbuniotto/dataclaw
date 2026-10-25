/**
 * Per-agent compute.
 *
 * A specialist can have its own home directory and, when Docker is available, its own
 * container. The home is the conversation's cwd, so `read`, `write`, `edit` and `bash`
 * operate on that agent's files instead of the shared workspace.
 *
 * - `shared`: today's behavior, the workspace root.
 * - `local`: a private directory at `workspace/agents/<agent-id>` on this machine. Files are
 *   isolated, but the shell is still the host process: this is not a security boundary.
 * - `docker`: the same private directory, bind-mounted into a per-agent container. `bash`
 *   runs inside the container; file tools use the bind mount. The container is the isolation
 *   boundary, with CPU, memory, pid and network limits.
 */
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";

export type AgentComputeKind = "shared" | "local" | "docker";

export type AgentCompute =
    | { readonly kind: "shared" }
    | { readonly kind: "local" }
    | { readonly kind: "docker"; readonly image?: string; readonly network?: "none" | "bridge" };

export const DEFAULT_AGENT_COMPUTE: AgentCompute = { kind: "local" };
export const DEFAULT_DOCKER_IMAGE = "oven/bun:1";

const IMAGE = /^[a-zA-Z0-9][a-zA-Z0-9_.:/@-]{0,199}$/;

export function parseAgentCompute(raw: unknown): { ok: true; value: AgentCompute } | { ok: false; error: string } {
    if (raw === undefined) return { ok: true, value: DEFAULT_AGENT_COMPUTE };

    const source = typeof raw === "string" ? { kind: raw } : raw;
    if (!source || typeof source !== "object" || Array.isArray(source)) {
        return { ok: false, error: "compute must be \"shared\", \"local\", \"docker\", or an object with a kind." };
    }
    const object = source as Record<string, unknown>;
    const kindRaw = typeof object.kind === "string" ? object.kind.trim().toLowerCase() : "local";
    if (kindRaw !== "shared" && kindRaw !== "local" && kindRaw !== "docker") {
        return { ok: false, error: 'compute.kind must be "shared", "local" or "docker".' };
    }

    if (kindRaw === "shared") {
        return { ok: true, value: { kind: "shared" } };
    }
    if (kindRaw === "local") {
        return { ok: true, value: { kind: "local" } };
    }

    const image = typeof object.image === "string" ? object.image.trim() : "";
    if (image && !IMAGE.test(image)) {
        return { ok: false, error: `"${image}" is not a usable Docker image reference.` };
    }
    const network = typeof object.network === "string" ? object.network.trim().toLowerCase() : "none";
    if (network !== "none" && network !== "bridge") {
        return { ok: false, error: 'compute.network must be "none" or "bridge".' };
    }
    return {
        ok: true,
        value: {
            kind: "docker",
            ...(image ? { image } : {}),
            network,
        },
    };
}

export function normalizedCompute(compute: AgentCompute | undefined): AgentCompute {
    return compute ?? { kind: "shared" };
}

/** The conversation cwd for this agent. Shared agents keep the workspace root. */
export function computeCwd(agentId: string, compute: AgentCompute | undefined, workspaceDir: string): string {
    const value = normalizedCompute(compute);
    if (value.kind === "shared") return resolve(workspaceDir);
    return resolve(workspaceDir, "agents", agentId);
}

/** Create the private home on first use. Idempotent; shared agents need nothing. */
export async function ensureAgentCompute(
    agent: { id: string; name: string; compute?: AgentCompute | undefined },
    workspaceDir: string,
): Promise<string> {
    const cwd = computeCwd(agent.id, agent.compute, workspaceDir);
    if (normalizedCompute(agent.compute).kind === "shared") return cwd;

    await mkdir(join(cwd, "memory"), { recursive: true });
    const readme = join(cwd, "README.md");
    try {
        await readFile(readme, "utf8");
    } catch {
        await writeFile(readme, [
            `# ${agent.name} — agent home`,
            "",
            `This directory is ${agent.name}'s own compute. Files written by read, write, edit and bash stay here.`,
            "",
            "- `memory/` is for notes that should survive a turn.",
            "- Do not write tokens or passwords here.",
            "- The coordinator's workspace is shared; this home is not.",
            "",
        ].join("\n"), { flag: "wx" }).catch(() => undefined);
    }
    return cwd;
}

export function formatCompute(compute: AgentCompute | undefined): string {
    const value = normalizedCompute(compute);
    if (value.kind === "shared") return "shared workspace";
    if (value.kind === "local") return "private local";
    const image = value.image ?? process.env.DATACLAW_COMPUTE_IMAGE ?? DEFAULT_DOCKER_IMAGE;
    return `docker (${image}, network ${value.network ?? "none"})`;
}
