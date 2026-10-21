import { afterAll, describe, expect, test } from "bun:test";
import { mkdtempSync, readFileSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
    computeCwd,
    ensureAgentCompute,
    formatCompute,
    normalizedCompute,
    parseAgentCompute,
} from "../src/compute/agent-compute";
import {
    commandString,
    containerName,
    dockerExecArgs,
    dockerRunArgs,
    idleStopMs,
    shellQuote,
    stopDockerContainer,
    sweepDockerContainers,
} from "../src/compute/docker-env";

const tmp = mkdtempSync(join(tmpdir(), "dataclaw-compute-"));
afterAll(() => rmSync(tmp, { recursive: true, force: true }));

describe("agent compute profiles", () => {
    test("parses shared, local, and docker compute", () => {
        expect(parseAgentCompute(undefined)).toEqual({ ok: true, value: { kind: "local" } });
        expect(parseAgentCompute("shared")).toEqual({ ok: true, value: { kind: "shared" } });
        expect(parseAgentCompute({ kind: "docker" })).toEqual({
            ok: true,
            value: { kind: "docker", network: "none" },
        });
        expect(parseAgentCompute({ kind: "docker", image: "oven/bun:1", network: "bridge" })).toEqual({
            ok: true,
            value: { kind: "docker", image: "oven/bun:1", network: "bridge" },
        });
        expect(parseAgentCompute({ kind: "vm" }).ok).toBe(false);
        expect(parseAgentCompute({ kind: "docker", image: "bad image" }).ok).toBe(false);
        expect(normalizedCompute(undefined)).toEqual({ kind: "shared" });
    });

    test("private homes live under workspace/agents and are created on first use", async () => {
        const workspaceDir = join(tmp, "workspace");
        const compute = { kind: "local" as const };
        const cwd = computeCwd("churn-bot", compute, workspaceDir);
        expect(cwd).toBe(join(workspaceDir, "agents", "churn-bot"));

        const ensured = await ensureAgentCompute({ id: "churn-bot", name: "Churn Bot", compute }, workspaceDir);
        expect(ensured).toBe(cwd);
        expect(statSync(join(cwd, "memory")).isDirectory()).toBe(true);
        expect(readFileSync(join(cwd, "README.md"), "utf8")).toContain("Churn Bot");
        expect(formatCompute(compute)).toBe("private local");

        expect(computeCwd("lead", { kind: "shared" }, workspaceDir)).toBe(workspaceDir);
        expect(formatCompute({ kind: "docker", image: "oven/bun:1", network: "none" }))
            .toContain("docker (oven/bun:1");
    });
});

describe("docker environment wiring", () => {
    test("quotes commands for the container shell", () => {
        expect(shellQuote("a b")).toBe("'a b'");
        expect(shellQuote("it's")).toBe("'it'\\''s'");
        expect(commandString(["echo", "hello world"])).toBe("'echo' 'hello world'");
        expect(commandString("echo hi")).toBe("echo hi");
    });

    test("runs with limits, a private mount, and the project mounted read-only", () => {
        const args = dockerRunArgs({
            agentId: "churn-bot",
            home: "/work/agents/churn-bot",
            projectRoot: "/work",
            image: "oven/bun:1",
            network: "none",
        });
        const line = args.join(" ");
        expect(containerName("churn-bot")).toBe("dataclaw-agent-churn-bot");
        expect(containerName("churn-bot", "/work")).toMatch(/^dataclaw-agent-[a-f0-9]{8}-churn-bot$/);
        expect(line).toMatch(/--name dataclaw-agent-[a-f0-9]{8}-churn-bot/);
        expect(line).toContain("--memory 2g");
        expect(line).toContain("--cpus 2");
        expect(line).toContain("--pids-limit 2048");
        expect(line).toContain("--cap-drop ALL");
        expect(line).toContain("--network none");
        expect(line).toContain("--label dataclaw.project=/work");
        expect(line).toContain("-v /work:/work:ro");
        expect(line).toContain("-v /work/agents/churn-bot:/work/agents/churn-bot:rw");
        expect(line).toContain("oven/bun:1 sleep infinity");
    });

    test("idle stop is fifteen minutes by default and can be disabled", () => {
        const previous = process.env.DATACLAW_COMPUTE_IDLE_MS;
        try {
            delete process.env.DATACLAW_COMPUTE_IDLE_MS;
            expect(idleStopMs()).toBe(15 * 60_000);
            process.env.DATACLAW_COMPUTE_IDLE_MS = "2500";
            expect(idleStopMs()).toBe(2500);
            process.env.DATACLAW_COMPUTE_IDLE_MS = "0";
            expect(idleStopMs()).toBe(0);
            process.env.DATACLAW_COMPUTE_IDLE_MS = "nonsense";
            expect(idleStopMs()).toBe(15 * 60_000);
        } finally {
            if (previous === undefined) delete process.env.DATACLAW_COMPUTE_IDLE_MS;
            else process.env.DATACLAW_COMPUTE_IDLE_MS = previous;
        }
    });

    test("the startup sweep can be switched off and stop is a no-op without Docker", async () => {
        const previous = process.env.DATACLAW_COMPUTE_SWEEP;
        try {
            process.env.DATACLAW_COMPUTE_SWEEP = "off";
            expect(await sweepDockerContainers()).toEqual([]);
        } finally {
            if (previous === undefined) delete process.env.DATACLAW_COMPUTE_SWEEP;
            else process.env.DATACLAW_COMPUTE_SWEEP = previous;
        }
        await expect(stopDockerContainer("churn-bot")).resolves.toBeUndefined();
    });

    test("exec keeps the host and container paths identical", () => {
        const args = dockerExecArgs(
            "dataclaw-agent-churn-bot",
            "/work/agents/churn-bot",
            ["bun", "-e", "console.log('hi')"],
            { FOO: "bar" },
        );
        expect(args).toEqual([
            "exec", "-i",
            "-w", "/work/agents/churn-bot",
            "-e", "FOO=bar",
            "dataclaw-agent-churn-bot",
            "sh", "-lc", "'bun' '-e' 'console.log('\\''hi'\\'')'",
        ]);
    });
});
