/**
 * Docker-backed compute for one agent.
 *
 * The agent's private home is bind-mounted at the same absolute path inside the container, so
 * the read/write/edit tools (which use the host side of the mount) and `bash` (which runs in
 * the container) see the same files and paths. Only the agent home is writable; the project
 * root is mounted read-only so the agent can still read sample data.
 *
 * This is intentionally a small provider, not a general sandbox platform. A remote provider
 * (E2B, Daytona, a Kubernetes pod) implements the same `createDocker`-style factory: return an
 * `ExecutionEnv` whose `exec` runs elsewhere and whose file operations share the same namespace.
 */
import { createHash } from "node:crypto";
import { isAbsolute, resolve } from "node:path";
import type { Context } from "@earendil-works/chord";
import {
    ExecutionError,
    err,
    type ExecutionEnv,
    type Result,
    type ShellExecOptions,
    type ShellExecResult,
} from "@earendil-works/pi-durable/env";
import { NodeExecutionEnv } from "@earendil-works/pi-durable/env/node";
import { DEFAULT_DOCKER_IMAGE } from "./agent-compute";

export interface DockerEnvOptions {
    agentId: string;
    /** Private host home, also the path inside the container. */
    home: string;
    /** Mounted read-only at the same path when provided. */
    projectRoot?: string;
    image?: string;
    network?: "none" | "bridge";
    /** Extra environment variables for the container. */
    env?: Record<string, string>;
}

interface DockerResult {
    code: number;
    stdout: string;
    stderr: string;
}

const DEFAULT_IDLE_MS = 15 * 60_000;

/** `DATACLAW_COMPUTE_IDLE_MS`: default 15 minutes, 0 disables idle stop. */
export function idleStopMs(): number {
    const raw = process.env.DATACLAW_COMPUTE_IDLE_MS;
    if (raw === undefined || raw.trim() === "") return DEFAULT_IDLE_MS;
    const value = Number(raw);
    return Number.isFinite(value) && value >= 0 ? value : DEFAULT_IDLE_MS;
}

function docker(args: string[]): DockerResult {
    let proc: ReturnType<typeof Bun.spawnSync>;
    try {
        proc = Bun.spawnSync(["docker", ...args], {
            stdout: "pipe",
            stderr: "pipe",
        });
    } catch (err) {
        return {
            code: 1,
            stdout: "",
            stderr: err instanceof Error ? err.message : String(err),
        };
    }
    const decoder = new TextDecoder();
    return {
        code: proc.exitCode ?? 1,
        stdout: decoder.decode(proc.stdout),
        stderr: decoder.decode(proc.stderr),
    };
}

/** Single-quote for a POSIX shell. */
export function shellQuote(value: string): string {
    return `'${value.replace(/'/g, "'\\''")}'`;
}

export function commandString(command: string | readonly string[]): string {
    return typeof command === "string"
        ? command
        : command.map((part) => shellQuote(part)).join(" ");
}

export function containerName(agentId: string, projectRoot?: string): string {
    const slug = agentId.replace(/[^a-z0-9_.-]/g, "-");
    if (!projectRoot) return `dataclaw-agent-${slug}`;
    const project = createHash("sha1").update(resolve(projectRoot)).digest("hex").slice(0, 8);
    return `dataclaw-agent-${project}-${slug}`;
}

function projectLabel(projectRoot: string | undefined): string[] {
    return projectRoot ? ["--label", `dataclaw.project=${projectRoot}`] : [];
}

export function dockerRunArgs(options: DockerEnvOptions): string[] {
    const image = options.image ?? process.env.DATACLAW_COMPUTE_IMAGE ?? DEFAULT_DOCKER_IMAGE;
    const network = options.network ?? "none";
    const uid = typeof process.getuid === "function" ? process.getuid() : undefined;
    const gid = typeof process.getgid === "function" ? process.getgid() : undefined;
    const args = [
        "run",
        "-d",
        "--name", containerName(options.agentId, options.projectRoot),
        ...projectLabel(options.projectRoot),
        "--label", `dataclaw.agent=${options.agentId}`,
        "--memory", process.env.DATACLAW_COMPUTE_MEMORY ?? "2g",
        "--cpus", process.env.DATACLAW_COMPUTE_CPUS ?? "2",
        "--pids-limit", process.env.DATACLAW_COMPUTE_PIDS ?? "2048",
        "--cap-drop", "ALL",
        "--security-opt", "no-new-privileges",
        "--network", network,
        "--env", "HOME=/tmp",
        "--env", "TMPDIR=/tmp",
        ...(uid === undefined || gid === undefined ? [] : ["--user", `${uid}:${gid}`]),
        ...(options.projectRoot ? ["-v", `${options.projectRoot}:${options.projectRoot}:ro`] : []),
        "-v", `${options.home}:${options.home}:rw`,
        "-w", options.home,
        ...Object.entries(options.env ?? {}).flatMap(([key, value]) => ["-e", `${key}=${value}`]),
        image,
        "sleep", "infinity",
    ];
    return args;
}

export function dockerExecArgs(
    container: string,
    cwd: string,
    command: string | readonly string[],
    env?: Record<string, string>,
): string[] {
    return [
        "exec",
        "-i",
        "-w", cwd,
        ...Object.entries(env ?? {}).flatMap(([key, value]) => ["-e", `${key}=${value}`]),
        container,
        "sh", "-lc", commandString(command),
    ];
}

const running = new Map<string, string>();
const lastUsed = new Map<string, number>();
const activeExecs = new Map<string, number>();
const idleTimers = new Map<string, ReturnType<typeof setTimeout>>();

function clearIdleTimer(name: string): void {
    const timer = idleTimers.get(name);
    if (timer) clearTimeout(timer);
    idleTimers.delete(name);
}

function scheduleIdleStop(name: string, agentId: string): void {
    clearIdleTimer(name);
    const delay = idleStopMs();
    if (delay <= 0) return;
    const timer = setTimeout(() => void stopIfIdle(name, agentId), delay);
    (timer as { unref?: () => void }).unref?.();
    idleTimers.set(name, timer);
}

function touchContainer(name: string, agentId: string): void {
    lastUsed.set(name, Date.now());
    scheduleIdleStop(name, agentId);
}

async function stopIfIdle(name: string, agentId: string): Promise<void> {
    if ((activeExecs.get(name) ?? 0) > 0) {
        scheduleIdleStop(name, agentId);
        return;
    }
    const idleFor = Date.now() - (lastUsed.get(name) ?? 0);
    if (idleFor < idleStopMs()) {
        scheduleIdleStop(name, agentId);
        return;
    }
    docker(["stop", "-t", "10", name]);
    running.delete(name);
    clearIdleTimer(name);
}

/** Stop a running compute container but keep its home and container for a fast wake. */
export async function stopDockerContainer(agentId: string, projectRoot?: string): Promise<void> {
    const name = containerName(agentId, projectRoot);
    clearIdleTimer(name);
    activeExecs.delete(name);
    lastUsed.delete(name);
    running.delete(name);
    docker(["stop", "-t", "10", name]);
}

/** Stop every container this app left running. Called once at process startup. */
export async function sweepDockerContainers(projectRoot?: string): Promise<string[]> {
    if (process.env.DATACLAW_COMPUTE_SWEEP === "off") return [];
    const listed = docker([
        "ps", "-q",
        "--filter", "label=dataclaw.agent",
        ...(projectRoot ? ["--filter", `label=dataclaw.project=${projectRoot}`] : []),
    ]);
    if (listed.code !== 0) return [];
    const stopped: string[] = [];
    for (const id of listed.stdout.split(/\s+/).filter(Boolean)) {
        if (docker(["stop", "-t", "10", id]).code === 0) stopped.push(id);
    }
    return stopped;
}

const swept = new Set<string>();

/** Once per project per process; a second harness does not sweep containers the first one may use. */
export async function sweepDockerContainersOnce(projectRoot?: string): Promise<string[]> {
    const key = projectRoot ?? "";
    if (swept.has(key)) return [];
    swept.add(key);
    return sweepDockerContainers(projectRoot);
}

/** Start (or reuse) the long-lived container for this agent. */
export async function ensureDockerContainer(options: DockerEnvOptions): Promise<string> {
    const name = containerName(options.agentId, options.projectRoot);
    const cached = running.get(name);
    if (cached) {
        touchContainer(name, options.agentId);
        return cached;
    }

    const inspect = docker(["inspect", "-f", "{{.State.Running}}", name]);
    if (inspect.code === 0) {
        if (inspect.stdout.trim() !== "true") {
            const start = docker(["start", name]);
            if (start.code !== 0) throw new Error(`could not start ${name}: ${start.stderr.trim() || start.stdout.trim()}`);
        }
        running.set(name, name);
        touchContainer(name, options.agentId);
        return name;
    }

    const created = docker(dockerRunArgs(options));
    if (created.code !== 0) {
        throw new Error(`could not start Docker compute ${name}: ${created.stderr.trim() || created.stdout.trim()}`);
    }
    running.set(name, name);
    touchContainer(name, options.agentId);
    return name;
}

export async function removeDockerContainer(agentId: string, projectRoot?: string): Promise<void> {
    const name = containerName(agentId, projectRoot);
    clearIdleTimer(name);
    activeExecs.delete(name);
    lastUsed.delete(name);
    docker(["rm", "-f", name]);
    running.delete(name);
}

/**
 * An `ExecutionEnv` whose shell is the container and whose files are the bind mount. The
 * object is a proxy over a NodeExecutionEnv: every file operation stays local to the mount,
 * only `exec` is redirected.
 */
export async function createDockerExecutionEnv(options: DockerEnvOptions): Promise<ExecutionEnv> {
    const container = await ensureDockerContainer(options);
    const host = new NodeExecutionEnv({ cwd: options.home });

    const exec = async (
        command: string | readonly string[],
        shellOptions: ShellExecOptions | undefined,
        context: Context,
    ): Promise<Result<ShellExecResult, ExecutionError>> => {
        try {
            // An idle stop may have put the container to sleep since this env was built.
            await ensureDockerContainer(options);
        } catch (error) {
            return err(new ExecutionError(
                "unknown",
                error instanceof Error ? error.message : String(error),
            ));
        }
        const cwd = shellOptions?.cwd
            ? (isAbsolute(shellOptions.cwd) ? shellOptions.cwd : resolve(options.home, shellOptions.cwd))
            : options.home;
        const args = dockerExecArgs(container, cwd, command, shellOptions?.env);
        const line = ["docker", ...args].map(shellQuote).join(" ");
        const { cwd: _cwd, ...rest } = shellOptions ?? {};
        activeExecs.set(container, (activeExecs.get(container) ?? 0) + 1);
        touchContainer(container, options.agentId);
        try {
            return await host.exec(line, rest, context);
        } finally {
            activeExecs.set(container, Math.max(0, (activeExecs.get(container) ?? 1) - 1));
            touchContainer(container, options.agentId);
        }
    };

    return new Proxy(host, {
        get(target, property, receiver) {
            if (property === "id") return `docker:${container}`;
            if (property === "exec") return exec;
            const value = Reflect.get(target, property, receiver);
            return typeof value === "function" ? value.bind(target) : value;
        },
    }) as ExecutionEnv;
}
