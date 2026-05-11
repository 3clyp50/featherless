<p align="center">
  <img width="320" height="400" alt="featherless" src="https://github.com/user-attachments/assets/4cff0f18-e1fd-40d5-9b2a-f9afa45ced89" />
</p>

# Featherless

After-visit clarity from live FHIR context.

Featherless is a Prompt Opinion Marketplace healthcare agent that turns a synthetic FHIR visit into a plain-language patient packet, draft care-team closure resources, and an auditable MCP/A2A trace. It is built as one reusable MCP server plus one External A2A orchestrator on Cloudflare Workers.

## Current Status

| Surface | Status |
|---|---|
| Prompt Opinion BYO Agent | Published and used as the chat entry point |
| External A2A Agent | Published: <https://app.promptopinion.ai/marketplace/agent/019e12e2-d251-7de3-bf49-16376ff51e73> |
| MCP Server | Published: <https://app.promptopinion.ai/marketplace/mcp/019e12cd-76bd-708f-b230-e48da20ad8bc> |
| Primary Marketplace listing | <https://app.promptopinion.ai/marketplace/agent/019e13c6-7704-75aa-be80-8ef528a3cb7f> |
| Live MCP endpoint | <https://featherless-mcp.inf3ctious007.workers.dev/mcp> |
| Live A2A AgentCard | <https://featherless-orchestrator.inf3ctious007.workers.dev/.well-known/agent-card.json> |

| Detail | Value |
|---|---|
| Authors | Chadwick Jones, Alessandro Frau |
| Hackathon | Agents Assemble: The Healthcare AI Endgame Challenge |
| Data posture | Synthetic FHIR only, no PHI, no token storage |

## What It Does

For the current patient in Prompt Opinion, Featherless:

1. reads the FHIR visit context,
2. packs the relevant encounter, problems, medications, orders, vitals, and labs,
3. generates a grade-6 patient packet through Workers AI,
4. validates readability and grounding,
5. prepares draft FHIR R4 closure resources for care-team review,
6. returns traceable MCP/A2A evidence.

The patient-facing packet is intended to answer a simple question: "What do I do next, and when should I ask for help?"

## Demo Flow

```text
Prompt Opinion BYO Agent
  | consults external Featherless A2A agent with FHIR context
  v
Featherless Orchestrator Worker
  | forwards request-scoped FHIR metadata as SHARP-style headers
  v
Featherless MCP Worker
  | clinical_pack_visit_context
  | clinical_generate_patient_packet
  | clinical_prepare_care_team_closure
  v
Prompt Opinion chat response + tool trace
```

The orchestrator uses a Cloudflare service binding named `FEATHERLESS_MCP` to call the deployed MCP Worker. FHIR access tokens are passed per request and are not stored, logged, or returned.

## Why It Matters

Patients often leave visits with instructions they cannot fully remember or act on. The project is grounded in plain-language and patient-education guidance: patients can forget 40-80% of clinical information from encounters [CIT-003], patient education should be understandable and actionable [CIT-002], and clear communication should prioritize concrete actions over jargon [CIT-001, CIT-005].

Featherless focuses on the handoff moment after a clinician has made a plan, but before the patient and care team have something clear enough to use.

## MCP Tools

| Tool | Purpose |
|---|---|
| `clinical_pack_visit_context` | Reads patient, encounter, problems, medications, orders, vitals, labs, and visit summary into a typed payload. |
| `clinical_generate_patient_packet` | Uses Workers AI to generate patient-facing packet markdown; reports Flesch-Kincaid and INFLESZ readability; validates grounding. |
| `clinical_prepare_care_team_closure` | Emits draft FHIR `Task`, `CommunicationRequest`, and `DocumentReference` resources for care-team review. |

Tool source lives under [`src/tools`](src/tools). The A2A orchestrator lives in [`orchestrator/src/index.ts`](orchestrator/src/index.ts).

## Safety Model

| Concern | Featherless posture |
|---|---|
| PHI | Synthetic/de-identified data only. No real PHI is used in the demo. |
| FHIR token handling | Tokens are request-scoped and never persisted. |
| Patient messaging | Nothing is auto-sent. The send artifact is a draft `CommunicationRequest`. |
| Write-back | Disabled by default; requires caller `write_back: true` and `WRITE_BACK=1`. |
| LLM provider | Cloudflare Workers AI only; no external LLM API key. |
| Grounding | Citation-or-cut: unsupported clinical claims are omitted or fail validation. |

## MCP-UI Bonus

The MCP server also exposes visualization tools that return MCP-UI `ui://` resources. The dashboard HTML loads Chart.js inside the rendered iframe; the Worker emits HTML and does not execute chart code.

Prompt Opinion currently exposes the MCP-UI payload as raw tool output rather than rendering the iframe. For the purpose of this demo, the same live MCP resource is rendered in Agent Zero, which we used to build part of the Featherless stack, as an iframe dashboard.

Showcase patient for that clip:

```text
Patient: Elena Carter
FHIR id: featherless-showcase-carter-elena
FHIR server: https://hapi.fhir.org/baseR4
```

Reload the showcase data if public HAPI resets:

```bash
npm run load:showcase
```

## Demo Data

Featherless uses two synthetic data paths:

- **Prompt Opinion synthetic patients** for the main Marketplace/A2A/MCP proof.
- **Hand-crafted synthetic HAPI data** for local repeatability and the MCP-UI showcase.

The original hero patient is Mrs. María García, a synthetic cardiology follow-up patient with a new PRN furosemide instruction, labs due soon, an echo to schedule, and care-team follow-up tasks. See [`HERO_PATIENT.md`](HERO_PATIENT.md).

## Run Locally

Install and verify:

```bash
npm install
npm run typecheck
npm test
```

Load the local synthetic hero bundle:

```bash
docker run -p 8080:8080 hapiproject/hapi:latest
npx tsx scripts/load-hero.ts
```

Run the Workers locally:

```bash
npm run dev
npm run dev:orchestrator
```

## Prompt Opinion Registration

For a fresh workspace, register:

```text
MCP endpoint:
https://featherless-mcp.inf3ctious007.workers.dev/mcp

A2A AgentCard:
https://featherless-orchestrator.inf3ctious007.workers.dev/.well-known/agent-card.json
```

Then enable Prompt Opinion FHIR context and consult the external `featherless` agent from the BYO agent. Full steps are in [`docs/po-registration.md`](docs/po-registration.md).

## Verification

Recorded final engineering gate:

- Cloudflare MCP Worker deployed.
- Cloudflare A2A orchestrator deployed.
- Prompt Opinion MCP, External A2A Agent, and BYO Agent published.
- Latest recorded local test suite: 56/56 passing after the encounter fallback fix.
- Agent Zero MCP-UI proof rendered the live `ui://` dashboard for the rich showcase patient.

Submission helpers:
- [`docs/publish-readiness.md`](docs/publish-readiness.md) - Marketplace and submission checklist.
- [`CITATIONS.md`](CITATIONS.md) - closed-world evidence list.
- [`DECISIONS.md`](DECISIONS.md) - key architecture decisions.

## License

MIT. See [`LICENSE`](LICENSE).
