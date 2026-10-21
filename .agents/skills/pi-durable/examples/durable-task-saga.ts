import { defineTask, type TaskId, defineTool, defineExtension } from "@earendil-works/pi-durable";
import { Type } from "@earendil-works/pi-ai";

/**
 * Child task representing an atomic unit of work (e.g. reserving a compute node).
 * Includes an explicit abort compensation handler.
 */
interface NodeReservationInput { nodeType: string }
type NodeReservationState = { phase: "reserve" };

export const ReserveNodeTask = defineTask<NodeReservationInput, NodeReservationState, string>({
    name: "cloud.reserve_node",
    version: 1,
    initial: () => ({ phase: "reserve" }),
    phases: {
        reserve: async (task, runtime, context) => {
            // Idempotent reservation using task.id
            const reservationId = `res-${task.id}`;
            console.log(`[Task ${task.id}] Reserving ${task.input.nodeType}...`);

            // Simulate reservation call
            const success = true; 

            await runtime.commit(() => ({
                status: "terminal",
                outcome: success
                    ? { status: "completed", result: reservationId }
                    : { status: "failed", error: { message: "Out of capacity" } },
            }), context);
        },
    },
    // Compensation handler: releases node if overall workflow is aborted
    abort: async (task, runtime, context) => {
        console.log(`[Task ${task.id}] Aborting and releasing reservation...`);
        // await cloud.release(`res-${task.id}`);
        await runtime.commit(() => ({
            status: "terminal",
            outcome: { status: "aborted" },
        }), context);
    },
});

/**
 * Parent orchestrator task: allocates multiple nodes in parallel.
 * If one node fails, failFast automatically aborts other pending/completed nodes.
 */
interface ClusterInput { nodes: string[] }
type ClusterState =
    | { phase: "provision" }
    | { phase: "decide"; reservations: TaskId<string>[] };

export const ProvisionClusterTask = defineTask<ClusterInput, ClusterState, string>({
    name: "cloud.provision_cluster",
    version: 1,
    initial: () => ({ phase: "provision" }),
    phases: {
        provision: async (task, runtime, context) => {
            await runtime.commit(async (tx) => {
                const reservations: TaskId<string>[] = [];
                for (const nodeType of task.input.nodes) {
                    reservations.push(
                        await tx.createTask(ReserveNodeTask, { nodeType }, {
                            ownership: { kind: "task", taskId: task.id },
                        }),
                    );
                }
                return {
                    status: "waiting",
                    checkpoint: { phase: "decide", reservations },
                    on: reservations,
                    policy: "failFast", // First failure triggers abort on siblings
                };
            }, context);
        },
        decide: async (task, runtime, context) => {
            const outcomes = await runtime.outcomes(task.state.checkpoint.reservations, context);
            const allPassed = outcomes.every((o) => o.status === "completed");

            await runtime.commit(() => ({
                status: "terminal",
                outcome: allPassed
                    ? { status: "completed", result: `Cluster provisioned: ${task.state.checkpoint.reservations.length} nodes ready.` }
                    : { status: "failed", error: { message: "One or more nodes failed to provision." } },
            }), context);
        },
    },
    abort: async (_task, runtime, context) => {
        await runtime.commit(() => ({
            status: "terminal",
            outcome: { status: "aborted" },
        }), context);
    },
});

/**
 * Tool allowing the agent to launch the cluster task and await result.
 */
export const provisionClusterTool = defineTool({
    name: "provision_cluster",
    description: "Provisions a distributed cluster of nodes with atomic rollback",
    parameters: Type.Object({
        nodes: Type.Array(Type.String()),
    }),
    execute: async (args, api, context) => {
        const taskId = await api.createTask(
            ProvisionClusterTask,
            { nodes: args.nodes },
            { ownership: { kind: "task", taskId: api.taskId } },
            context,
        );

        const taskResult = await api.waitForTask(taskId, context);
        const { outcome } = taskResult.state;

        const text = outcome.status === "completed" 
            ? outcome.result 
            : `Failed: ${outcome.status}`;

        return { content: [{ type: "text", text }] };
    },
});

export const CloudProvisioningExtension = defineExtension({
    name: "cloud-provisioning",
    tools: [provisionClusterTool],
    tasks: [ReserveNodeTask, ProvisionClusterTask],
});
