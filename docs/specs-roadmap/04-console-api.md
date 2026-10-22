# 04 · Give the console one HTTP seam

**Status:** `done` · **Strength:** Worth exploring · **Seam:** ports & adapters · **Size:** M

**Depends on:** 02 (the snapshot it serves), 03 (the catalog it serves).

## Problem

Nineteen route handlers live inline in a module that starts a listener when imported. Each repeats
the same read–validate–try–catch preamble, four different error conventions coexist, and the client
re-declares the server's wire types by hand. No handler can be exercised without binding a port.

## Evidence

| Where | What |
| --- | --- |
| `src/console/api/server.ts:51` | `Bun.serve({...})` at module scope; the module exports nothing |
| `src/console/api/server.ts:57–246` | 19 API routes + 7 page routes, ~190 lines |
| `src/console/api/server.ts:21,24,34` | `errorMessage`, `jsonError`, `readBody` — used inconsistently |
| `src/console/api/server.ts:62` | `/api/workspace` hand-rolls the shape `jsonError` exists for |
| `src/console/api/server.ts:196` | the four Databricks routes use a third convention (record, then re-serialize status) |
| `src/console/api/server.ts:178–207` | `/api/databricks/connect` spends 14 of 22 lines rebuilding the `oauth` sub-object |
| `src/console/api/capabilities-api.ts:33–38` | re-validates `id` / `enabled` that the route already coerced |
| `src/console/components/DatabricksAuth.tsx:26` vs `src/console/api/databricks-api.ts:19` | the same 16-field status type, copied |
| `src/console/pages/CapabilitiesPage.tsx:98` | `body as unknown as CapabilityCatalog` — the only contract |
| `src/console/DurableAgentConsole.tsx:83`, `CapabilitiesPage.tsx:31`, `DatabricksAuth.tsx:79` | three `readJson` variants that disagree about an empty body |
| `src/console/api/plugins-api.ts:78` vs `src/capabilities/catalog.ts:111` | two projections of one `LoadedPlugin`: `/api/plugins` and `/api/capabilities` render the same plugins from different field names |

`readBody` appears 10×, `jsonError` 9×, and `typeof x === "string"` 13× in the route table.

## Proposed direction

A route table where each entry declares its input once and calls one domain function. A single
adapter turns a returned result (or a thrown error) into a response with the right status, so the
nine `jsonError` call sites and the four conventions become one rule. `Bun.serve` shrinks to
mounting the table.

The domain functions stay where the logic already is — most of it in `*-api.ts` — but they return
values and throw, and they stop parsing untyped request bodies. The client imports the server's
types from one module instead of declaring them again.

The two plugin projections collapse into one: the Settings page and the Capabilities page read the
same shape.

## What changes for callers

- A route is three lines: method, input shape, domain function.
- Handlers become importable and testable without a listener.
- `checkPlugins` and `bun run plugins:list --check` keep one implementation, not two.
- The client's `readJson` becomes one helper with one behaviour on an empty body.

## Wins

- 19 try/catch blocks → 1 error adapter.
- 4 error conventions → 1.
- Handlers testable without a port.
- One plugin projection, two pages.
- Locality: a route is one entry; a status code is one rule.

## Open questions

- Is a schema library acceptable? Bun's router does not validate. If not, keep coercion helpers but
  move them next to the route they belong to instead of a preamble.
- `Bun.serve` at import time is convenient for `bun run console`. Keep an explicit `startServer()`
  entry for `bun run console` and make the module importable.
- The Databricks routes are the exceptional case: they attach a status snapshot to failures. Model
  that as a domain error carrying a payload, not as a fourth convention.

## Acceptance

- Starting the server is an explicit call; importing the route module has no side effect.
- Every route can be invoked in a test with a plain request object, with no port.
- One test asserts the error-to-status mapping for a validation error, a conflict (agent busy), and
  an unexpected failure.
- `/api/plugins` and `/api/capabilities` return the same plugin facts for the same fixture.
- The client compiles against the server's type module; deleting the local copy is the proof.

## Out of scope

The UI. `AgentsPage`'s fabricated routines, phantom teammates, and inline styles are tracked in the
roadmap README as cleanup, not as part of this seam.
