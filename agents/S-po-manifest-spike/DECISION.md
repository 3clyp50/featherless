# S-po-manifest-spike · DECISION

**Status:** RESOLVED — three answers, evidence-based, no fallback needed.
**Resolved:** 2026-05-10 (D5), within time-box.
**Resolved by:** Claude, working from PO docs the user pasted into the conversation + the local clone of `prompt-opinion/po-adk-typescript` at `../../po-adk-typescript/`. (An earlier autonomous spike attempt was sandboxed off the network and produced no evidence — superseded by this run.)

---

## Q1 — Does PO accept `kind: Agent` with an external HTTP endpoint (Cloudflare Workers URL)?

**ANSWER: YES — first-class supported. The framing is wrong, though: the unit is not a YAML manifest with `kind: Agent`, it is an A2A-spec *agent card* served at `/.well-known/agent-card.json`.**

PO's docs ("External Agents" page) state: *"You can add external agents to your workspace if they implement the A2A specification. To add an external agent, navigate to the Agents → External Agents page. Click on the Add Connection button… Add the URL to the agent card of the agent. This typically is a url that ends with `/.well-known/agent-card.json`."*

The reference SDK `prompt-opinion/po-adk-typescript` (locally at `../../po-adk-typescript/README.md`, "Connecting to Prompt Opinion" section) is unambiguous: *"Deploy your agent to a publicly reachable URL. … Register the agent in Prompt Opinion by providing the agent card URL: `https://your-agent.run.app/.well-known/agent-card.json`."* No hosted-SDK requirement; any A2A-compliant endpoint works.

There is **no `marketplace.yaml`** in the registration path the docs describe. The legacy hypothesis manifest was speculative and does not match how PO actually onboards external agents.

MCP servers follow a parallel, separate registration path: `Configuration → MCP Servers`, where PO sends an `initialize` JSON-RPC call to the URL and reads capabilities from the response. Extension declaration is via the `ai.promptopinion/fhir-context` capability key (not a YAML manifest).

## Q2 — Manifest shape: keys, required fields, agent-endpoint declaration

**ANSWER: There is no PO-proprietary manifest. The shape is the standard A2A `AgentCard` JSON, served at `GET /.well-known/agent-card.json`.**

Canonical structure (extracted from `../../po-adk-typescript/shared/appFactory.ts:257-278`, which is the working reference impl):

```jsonc
{
  "name": "string",                    // required
  "description": "string",             // required
  "url": "https://...",                // required — the public URL where this agent is reachable
  "version": "1.0.0",                  // required (semver)
  "protocolVersion": "1.0.0",          // required — A2A protocol version
  "preferredTransport": "JSONRPC",     // required by PO — declares HTTP POST + JSON-RPC 2.0 at `url`
  "defaultInputModes":  ["text/plain"],
  "defaultOutputModes": ["text/plain"],
  "capabilities": {
    "streaming": false,
    "pushNotifications": false,
    "stateTransitionHistory": true,
    "extensions": [                    // OPTIONAL — only if the agent uses FHIR context
      {
        "uri": "https://app.promptopinion.ai/schemas/a2a/v1/fhir-context",
        "description": "FHIR context …",
        "required": false,
        "params": {
          "scopes": [
            { "name": "patient/Patient.rs", "required": true },
            { "name": "patient/Condition.rs" }
          ]
        }
      }
    ]
  },
  "skills": [ /* required if A2A is enabled — at least one */ ],
  "securitySchemes": {                 // optional — see API security below
    "apiKey": { "type": "apiKey", "name": "X-API-Key", "in": "header" }
  },
  "security": [{ "apiKey": [] }]
}
```

**A2A endpoint contract the agent itself must implement:**
- `GET /.well-known/agent-card.json` → returns the JSON above. **Always public**, even when the agent requires API-key auth on POST.
- `POST /` → JSON-RPC 2.0 over HTTP. Methods: `message/send` (required), `message/stream` (optional, only if `capabilities.streaming=true`), `tasks/get` (optional). FHIR context arrives as `params.message.metadata["<fhir-extension-uri>"] = { fhirUrl, fhirToken, patientId }`. See PO docs "FHIR Context With A2A".

**MCP-server shape (separate from A2A — for the featherless Worker):**
- HTTP-Streamable JSON-RPC at the MCP endpoint.
- `initialize` response includes `result.capabilities.extensions["ai.promptopinion/fhir-context"]` with the same `{ scopes: [{ name, required }] }` structure.
- PO sends FHIR context as **headers** on each `tools/call`: `X-FHIR-Server-URL`, `X-FHIR-Access-Token`, `X-Patient-ID` (per PO docs "FHIR Context With MCP"). This is exactly what the existing `featherless` substrate already reads.

## Q3 — PLAN.md §3 path: two-Worker A2A or single-Worker fallback?

**ANSWER: Take the two-Worker A2A path. The original concern (PO might require an in-SDK agent) is disproven.**

**Architecture (now evidence-backed):**
- **`featherless` Worker** registers as a **PO MCP server** (Configuration → MCP Servers). Receives `X-FHIR-*` headers per call. Exposes the three Featherless visit-workflow tools as MCP tools. Already 80 % built.
- **`orchestrator` Worker** registers as a **PO External A2A Agent** (Agents → External Agents). Serves `/.well-known/agent-card.json` and `POST /` JSON-RPC `message/send`. Reads FHIR context from message metadata, then **internally** calls the featherless `/mcp` endpoint, translating metadata → SHARP headers verbatim (still "no token storage" — values flow through, never persist).

**One implementation caveat** worth surfacing now (does not change the recommendation): the reference SDK uses `@a2a-js/sdk` on top of Express. Express does not run on Cloudflare Workers. The Worker orchestrator must hand-roll the A2A protocol surface — but that surface is small for non-streaming `message/send`: agent-card GET (static JSON) + JSON-RPC POST dispatcher with one method. Estimate ~150 LOC on Hono. This is well within D5 Block 3's budget for `S-orchestrator`.

## Recommendation

**Two-Worker A2A.** No fallback. Update PLAN.md §3 / §9 risk #1 to reflect that the registration path is "agent card URL + MCP `initialize` extension," **not** a `marketplace.yaml` upload, and update the hand-rolled-A2A-on-Workers caveat in `S-orchestrator`'s scope.

## Sources consulted

- PO docs (provided by user via paste): "External Agents", "BYO Agents", "FHIR Context With A2A", "FHIR Context With MCP" sections of `docs.promptopinion.ai`.
- Local clone: `../po-adk-typescript/README.md` — "Connecting to Prompt Opinion" section.
- Local clone: `../po-adk-typescript/shared/appFactory.ts` — `createA2aApp()` and the AgentCard literal at lines 257-278.
- Local clone: `../po-adk-typescript/package.json` — confirms `@a2a-js/sdk ^0.3.10` + `express ^4.21.0` are the reference deps (incompatible with Workers; informs the hand-roll caveat).

## Open questions (non-blocking)

1. **PO Community Marketplace publishing** — separate from "add to your workspace." The pasted docs cover only workspace-level registration. Whether there is a community-publish step (the hackathon's "Marketplace publish" non-scoring gate in `TODO.md`) is unverified. Hypothesis: the gate is satisfied by a publicly reachable agent-card URL + MCP URL that judges can paste in. **Recommend confirming via po-community-mcp examples or PO Discord before D6.**
2. **`po` CLI** — not probed (not installed locally). If `po marketplace validate` exists, it may still want a config file. Low priority — unblocks nothing.
3. **A2A `skills` field** — required when A2A is enabled and at least one skill must be declared. Content of those skill objects is not yet specced in our notes; will be authored as part of `S-orchestrator`. Reference impls in `po-adk-typescript/{healthcare,general,orchestrator}_agent/server.ts` are the gold standard.
