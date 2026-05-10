# S-orchestrator

> Created 2026-05-10 (D5) per `featherless/PLAN.md` §11 row and TODO.md Block 3 entries 08:00 / 09:00 / 09:30.

## Contract (do not modify)

- **Writable:**
  - `orchestrator/src/index.ts` (new)
  - `test/orchestrator/orchestrator.test.ts` (new)
  - `wrangler-orchestrator.jsonc` (new)
  - `src/env.ts` — orchestrator env vars only
  - `tsconfig.json`, `package.json` — include / scripts only
  - `PLAN.md`, `TODO.md` — mirror scope status and dependency-free Worker decision only
- **Read-only context:**
  - `src/index.ts` — native Worker handler style and SHARP header propagation pattern.
  - `src/context.ts` — SHARP header names and no-token-storage posture.
  - `agents/S-po-manifest-spike/DECISION.md` — Prompt Opinion registration evidence.
  - `../po-adk-typescript/shared/appFactory.ts` — AgentCard shape reference; do not import it.
- **Acceptance:** `GET /.well-known/agent-card.json` returns a Prompt Opinion-compatible A2A AgentCard with `preferredTransport: "JSONRPC"` and the FHIR-context extension; `POST /` accepts JSON-RPC `message/send`, extracts `metadata[".../fhir-context"]`, translates it to `X-FHIR-*` headers on three outgoing MCP `tools/call` requests, never returns/logs tokens, and returns a trace with non-zero `ms` per hop.
- **Source of truth:** `../../PLAN.md` §4 / §11, `../../TODO.md` Block 3 entries 08:00 / 09:00 / 09:30, `../S-po-manifest-spike/DECISION.md`.

## Mirrored tasks

- [x] ~~**08:00** Scaffold `orchestrator/`~~ **DONE** — separate `wrangler-orchestrator.jsonc`, native Worker `orchestrator/src/index.ts`, public AgentCard route, and JSON-RPC `message/send` dispatcher.
- [x] ~~**09:00** SHARP header forwarding test~~ **DONE** — A2A FHIR metadata becomes `X-FHIR-Server-URL`, `X-FHIR-Access-Token`, and `X-Patient-ID` on outgoing MCP calls; token is never returned. Agent-card test covers required Prompt Opinion fields.
- [x] ~~**09:30** Local orchestrator e2e-style unit~~ **DONE** — three MCP calls run in order (`clinical_pack_visit_context` -> `clinical_generate_patient_packet` -> `clinical_prepare_care_team_closure`) and trace has non-zero timings.

## Decisions log

- `2026-05-10` · **Dependency-free Worker**: the original plan mentioned Hono, but this repo has no Hono dependency and the substrate already uses a native Worker `fetch()` handler. The orchestrator hand-rolls the small A2A surface directly to avoid adding a deadline-risk dependency.
- `2026-05-10` · **Workers AI stays inside Featherless MCP**: the orchestrator performs no LLM calls and stores no provider keys; patient packet generation remains the Workers AI-bound MCP tool.

## Open contract questions

- Marketplace publishing remains a human/platform step after URLs are deployed and registered; this scope only implements the A2A surface needed for Prompt Opinion invocation.

## Output

- **Files:** `orchestrator/src/index.ts`, `test/orchestrator/orchestrator.test.ts`, `wrangler-orchestrator.jsonc`, `src/env.ts`, `tsconfig.json`, `package.json`, `PLAN.md`, `TODO.md`.
- **Summary:** Implemented a dependency-free Cloudflare Worker A2A orchestrator. It serves a Prompt Opinion-compatible AgentCard, accepts JSON-RPC `message/send`, extracts exact or defensive `fhir-context` metadata keys, translates them to SHARP headers for the three Featherless MCP tools, returns a patient packet + closure resources + trace, and never returns FHIR tokens.
- **Open questions:** deployed Prompt Opinion registration and Marketplace publication remain a D6 platform step after public URLs exist.
