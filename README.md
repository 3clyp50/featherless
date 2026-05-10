<p align="center">
  <img width="320" height="400" alt="featherless" src="https://github.com/user-attachments/assets/4cff0f18-e1fd-40d5-9b2a-f9afa45ced89" />
</p>

# Featherless

Featherless turns the current FHIR visit into a plain-language patient packet and a care-team closure bundle through three reusable MCP tools and one A2A orchestrator on Cloudflare Workers.

**Authors:** Chadwick, Alessandro Frau
**Hackathon:** Agents Assemble: The Healthcare AI Endgame Challenge
**Protocol path:** MCP server + A2A-enabled external agent
**Data posture:** synthetic FHIR only, no PHI, no token storage
**LLM boundary:** Cloudflare Workers AI only

## 1. Why It Matters

Patients often leave visits with instructions they cannot act on. The evidence base is painfully clear: patients can forget 40-80% of information from clinical encounters [CIT-003], patient education materials should meet understandability and actionability thresholds [CIT-002], and clear communication guidance emphasizes concrete actions over jargon [CIT-001, CIT-005].

Featherless attacks that last mile: the moment after the clinician has made a plan, but before the patient and care team have something usable.

## 2. What It Does

For the current patient context, Featherless:

1. reads the visit graph from FHIR,
2. packs a typed visit context,
3. generates a Spanish grade-6 patient packet through Workers AI,
4. validates citation and chart grounding,
5. emits FHIR R4 closure resources for care-team follow-up,
6. returns an auditable A2A trace.

## 3. Hackathon Fit

| Requirement | Featherless answer |
|---|---|
| Marketplace verified | Register MCP URL and AgentCard URL in Prompt Opinion. |
| Protocol adherence | MCP server plus A2A external agent. |
| Platform integration | Prompt Opinion invokes the orchestrator through `message/send`; orchestrator calls Featherless MCP tools. |
| Safety compliance | Synthetic María García HAPI bundle only; no PHI. |
| AI Factor | Workers AI rewrites structured clinical context into patient-facing education under grounding constraints. |
| Potential Impact | Targets post-visit confusion, missed follow-ups, and avoidable portal-message burden. |
| Feasibility | Uses SHARP headers, FHIR R4 resources, dry-run write-back, and clinician review. |

## 4. Architecture

```text
Prompt Opinion workspace
  | A2A message/send with FHIR metadata
  v
Featherless orchestrator Worker
  | translates metadata to SHARP headers
  v
Featherless MCP Worker
  | clinical_pack_visit_context
  | clinical_generate_patient_packet
  | clinical_prepare_care_team_closure
  v
FHIR R4 server (local HAPI synthetic bundle)
```

Two deployables make the boundaries visible: one MCP server for reusable clinical tools, one A2A orchestrator for the full workflow.

## 5. MCP Tools

| Tool | File | Purpose |
|---|---|---|
| `clinical_pack_visit_context` | `src/tools/clinical-visit-context.ts` | Reads patient, encounter, problems, medications, orders, vitals, labs, and visit summary into a typed payload. |
| `clinical_generate_patient_packet` | `src/tools/clinical-patient-packet.ts` | Uses Workers AI to generate patient-facing packet markdown; reports FK and INFLESZ readability; validates grounding. |
| `clinical_prepare_care_team_closure` | `src/tools/clinical-care-team-closure.ts` | Emits `Task` resources only for explicit follow-up orders, plus one draft `CommunicationRequest` proposal and one `DocumentReference`; validates through FHIR `$validate`. |

## 6. A2A Orchestrator

The orchestrator lives in `orchestrator/src/index.ts`.

- `GET /.well-known/agent-card.json` returns a Prompt Opinion-compatible AgentCard.
- `POST /` accepts JSON-RPC `message/send`.
- FHIR context arrives in message metadata under a `fhir-context` key.
- The orchestrator forwards context as `X-FHIR-Server-URL`, `X-FHIR-Access-Token`, and `X-Patient-ID`.
- The response is an A2A message whose text contains `{ result, trace, errors }`.

The Worker does not import Express, `@a2a-js/sdk`, Hono, or an external router. The surface is small and hand-rolled for Workers.

## 7. SHARP And Token Safety

Featherless is stateless at the request boundary:

- Prompt Opinion supplies FHIR context per request.
- The MCP Worker reads SHARP headers inside an `AsyncLocalStorage` scope.
- The orchestrator never logs, stores, or returns FHIR access tokens.
- Tests assert token forwarding to MCP and token absence from A2A responses.

## 8. Workers AI And Grounding

Patient-packet generation is bounded:

- provider: `workers_ai`
- model configured by `LLM_MODEL`
- no external LLM API keys
- prompt receives structured visit context, not raw token context
- output is parsed through Zod
- citation IDs are allow-listed
- dose strings must match the structured medication changes

If grounding fails, the tool retries once and then fails loudly.

## 9. Hero Patient

The demo patient is María García, a synthetic 67-year-old cardiology follow-up patient. The key change is furosemide `20 mg PO PRN`, paired with self-monitoring instructions and follow-up orders. See `HERO_PATIENT.md`.

The patient packet is generated in Spanish; English remains the control path.

## 10. FHIR Write-Back Posture

By default, Featherless emits and validates resources without writing them. Write-back requires both:

1. caller argument `write_back: true`,
2. Worker env `WRITE_BACK=1`.

The patient-send resource is a `CommunicationRequest` with `status: "draft"` and `intent: "proposal"`, preserving clinician review.

## 11. Five Ts

| T | Featherless artifact |
|---|---|
| Talk | A2A conversation in Prompt Opinion. |
| Template | Patient packet structure and citation footer. |
| Table | Medication-change table with new medication surfaced. |
| Transaction | FHIR `DocumentReference`, `CommunicationRequest`, and `Task` resources. |
| Task | Follow-up lab, echo, and nurse-call work items. |

## 12. Run Locally

```bash
npm install
npm run typecheck
npm test
```

Load the synthetic bundle:

```bash
docker run -p 8080:8080 hapiproject/hapi:latest
npx tsx scripts/load-hero.ts
```

Run Workers locally:

```bash
npm run dev
npm run dev:orchestrator
```

## 13. Prompt Opinion Registration

See `docs/po-registration.md` for the registration flow and `docs/publish-readiness.md` for the final Marketplace/Devpost checklist.

Submission URLs:

- MCP: `<featherless-worker-url>/mcp`
- A2A AgentCard: `<orchestrator-worker-url>/.well-known/agent-card.json`

The deployed orchestrator uses a Cloudflare service binding named `FEATHERLESS_MCP` to call the deployed MCP Worker service `featherless-mcp`. If a different deployment shape cannot use that binding, set `FEATHERLESS_MCP_URL` to the deployed HTTPS MCP endpoint; public loopback targets are rejected.

No `marketplace.yaml` is used for the current Prompt Opinion onboarding path.

## 14. Verification

Latest local gate:

- `npm run typecheck`
- scoped Biome check for touched code/docs
- `npm test` -> 40/40 tests
- product-name scrub for legacy namespaces
- CodeRabbit review on code checkpoints

Known remaining submission tasks:

- Authenticate Cloudflare and deploy both Workers.
- Use a synthetic FHIR server reachable from deployed Workers and Prompt Opinion.
- Register both URLs in Prompt Opinion and publish the configured project to the Marketplace.
- Capture SHARP proof screenshots.
- Record the under-3-minute demo video.
- Submit final Devpost with the Marketplace URL and public video link before Monday, 2026-05-11 18:00 Europe/Rome.

## License

MIT. See `LICENSE`.
