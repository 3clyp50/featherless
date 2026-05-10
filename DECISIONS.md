# DECISIONS.md

**Project:** Featherless
**Hackathon:** Agents Assemble: The Healthcare AI Endgame Challenge
**Current architecture:** Cloudflare Workers MCP server + Cloudflare Workers A2A orchestrator
**Status:** D5 implementation checkpoints green locally

## D-001 · Product Surface

**Decision:** The submission is Featherless: three reusable clinical MCP tools plus one A2A orchestrator that composes them for a visit-closure workflow.

**Rationale:** the hackathon pass/fail gate requires a real MCP server or A2A-enabled agent discoverable in Prompt Opinion. Featherless exposes both surfaces: the MCP server is reusable by other agents, and the orchestrator demonstrates multi-agent composition.

## D-002 · Worker-Native TypeScript

**Decision:** implement the build natively in TypeScript on Cloudflare Workers.

**Rationale:** the substrate already runs on Workers and already implements SHARP-style context propagation. Keeping the visit workflow in the same runtime avoids a Python sidecar, avoids new network glue, and makes deployment easy to explain.

## D-003 · Workers AI Boundary

**Decision:** patient packet generation uses Cloudflare Workers AI via the Worker `AI` binding. No external LLM provider API keys.

**Rationale:** health-data safety and the rest of the codebase's provider posture matter more than theoretical model portability. The implementation is still testable through a local LLM seam, but production execution stays inside the Workers AI boundary.

## D-004 · Tool Names

**Decision:** use native Featherless clinical namespaces:

- `clinical_pack_visit_context`
- `clinical_generate_patient_packet`
- `clinical_prepare_care_team_closure`

**Rationale:** tool names should fit the existing `src/tools/` substrate and be reusable beyond the orchestrator.

## D-005 · FHIR Write-Back Posture

**Decision:** closure resources are emitted and validated by default. PUT write-back only happens when the caller requests it and `WRITE_BACK=1` is set.

**Rationale:** judges need standards-correct FHIR resources, not risky autonomous sends. The default posture is dry-run, human-reviewed, and demo-safe.

## D-006 · CommunicationRequest Semantics

**Decision:** use `CommunicationRequest.status = "draft"` with `intent = "proposal"`.

**Rationale:** local HAPI R4 validation rejects `status = "proposed"` because R4 `CommunicationRequest.status` does not include that code. `draft` plus `proposal` preserves the human-review meaning and validates against R4.

## D-007 · A2A Surface

**Decision:** serve a Prompt Opinion-compatible A2A AgentCard at `/.well-known/agent-card.json` and accept JSON-RPC `message/send` at `/`.

**Rationale:** the local Prompt Opinion reference shows external agents are registered by AgentCard URL. The reference SDK uses Express and `@a2a-js/sdk`, which are not Worker-native, so Featherless hand-rolls the small non-streaming surface with `fetch()`.

## D-008 · No Token Storage

**Decision:** FHIR tokens flow from Prompt Opinion metadata to SHARP headers per request, then disappear.

**Rationale:** no credential persistence is central to the healthcare safety story. The orchestrator tests assert that token values are forwarded to MCP but not returned in A2A responses.

## D-009 · Synthetic Data Only

**Decision:** demo and tests use the synthetic María García HAPI bundle.

**Rationale:** Stage One requires no PHI. The hand-crafted bundle is deterministic, clinically legible, and enough to prove the workflow.

## D-010 · Scope Cap

**Decision:** ship three tools and one orchestrator. New ideas go to `BACKLOG.md`.

**Rationale:** the deadline rewards a working, registered, invokable project over a sprawling prototype.
