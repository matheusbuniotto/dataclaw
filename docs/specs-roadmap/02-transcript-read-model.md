# 02 · One transcript read model

**Status:** `done` · **Strength:** Strong · **Seam:** in-process · **Size:** M

## Problem

The same persisted messages are parsed four times, each parser with its own copy of the record and
text helpers and its own rule for pairing a tool result. The console and the eval harness can
disagree about what a run contained, and the interesting cases — a missing tool result, an aborted
turn, an error streak — are only reachable through a full harness.

## Evidence

| Parser | Where | Produces | Consumer |
| --- | --- | --- | --- |
| `buildTurns` | `src/console/api/workspace.ts:484` | goals, checkpoints, turn errors | `RunsPage`, `Overview` |
| `transcriptFrom` | `src/console/api/workspace.ts:712` | `TranscriptItem[]` with tool pairing | workspace snapshot → client |
| `groupIntoTurns` | `src/console/components/ChatComponents.tsx:963` | `ChatTurn[]` segments | `AssistantTurnView` |
| `extractTrace` | `evals/trace.ts:65` | `TraceToolCall[]`, final text, stop reason | evals + stuck detector |

Helper copies: `asRecord` at `workspace.ts:925`, `evals/trace.ts:27`, `evals/scripted-agent.ts:79`;
text extraction at `workspace.ts:916`, `evals/trace.ts:41`, `evals/scripted-agent.ts:81`.

All four independently skip system messages, walk content blocks for `type === "toolCall"`, join
results by `toolCallId`, and decide what a missing result means. Two of the four have tests:
`tests/chat-ui.test.ts` covers `transcriptFrom` and `groupIntoTurns`, `tests/evals.test.ts` covers
`extractTrace`. `buildTurns` is only exercised through `readWorkspace` in `tests/agents.test.ts`.

## Proposed direction

A transcript module parses the persisted messages once into typed events: turn boundaries, tool
calls, tool results (including "no result"), assistant text, and the last stop reason. The four
consumers read events and keep their own presentation. Nothing outside the module walks raw
messages.

This is the one candidate where the interface *is* the test surface: the parse rules are the rules
the console, the eval trace, and the stuck detector all depend on.

## What changes for callers

- `readWorkspace` stops calling two parsers to answer two questions about one conversation.
- `ChatComponents` groups events instead of re-deriving them from `TranscriptItem`s.
- `evals/trace.ts` becomes a projection over events, not a fourth parser.
- `evals/scripted-agent.ts` uses the module's helpers instead of its own.

## Wins

- Four parsers → one module; three helper copies → none.
- The console's edge cases become eval's edge cases, tested once.
- Stuck detection gets a seam it can be tested across, instead of ground-truth-free heuristics
  layered on a trace that was parsed differently.
- Leverage: one parse, four consumers.

## Open questions

- `TranscriptItem` is the wire type for the client and also a parse product. Decide whether events
  are the wire type or whether a thin projection to `TranscriptItem` stays. The latter keeps the UI
  unchanged and is probably right.
- Where does the module live? `src/transcript/` reads better than either `console/` or `evals/`,
  which is itself the point: it belongs to neither surface.
- `buildTurns` currently derives "data sources touched" from tool names. That mapping duplicates
  knowledge already listed in 03; move it there rather than into the parser.

## Acceptance

One test matrix over the parser, covering: assistant text only, parallel tool calls, a tool result
that arrives out of order, a missing result, an `isError` result, an `aborted` stop reason, and an
`error` stop reason. Then: the console run list, the chat view, and the eval trace each render the
same turn count and the same tool calls for one fixture conversation.

## Out of scope

Presentation. Segment boundaries, markdown, and tool display phrases stay in `ChatComponents`.
