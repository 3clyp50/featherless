# Prompt Opinion Registration

This guide is for judges and teammates registering Featherless in a fresh Prompt Opinion workspace.

## URLs Needed

| Surface | URL |
|---|---|
| Featherless MCP server | `https://featherless-mcp.inf3ctious007.workers.dev/mcp` |
| Featherless A2A orchestrator AgentCard | `https://featherless-orchestrator.inf3ctious007.workers.dev/.well-known/agent-card.json` |

Use deployed HTTPS URLs for final judging. Localhost URLs are useful only for development.

## Deployment Preflight

From this folder:

```bash
npx wrangler whoami
npx wrangler deploy --dry-run
npx wrangler deploy --config wrangler-orchestrator.jsonc --dry-run
```

On 2026-05-10, `wrangler whoami` succeeded for `Inf3ctious007@gmail.com's Account` (`2a6a96ae8f3d1a965febebb24df965f4`). The MCP Worker and orchestrator Worker both have public deployed URLs listed above.

The deployable path is now:

- MCP Worker: `wrangler.jsonc` binds Workers AI and disables optional memory by default with `MEM0_DISABLED=1`; no D1/Vectorize resource is required for the hackathon workflow.
- A2A orchestrator: `wrangler-orchestrator.jsonc` binds the deployed MCP Worker service `featherless-mcp` as `FEATHERLESS_MCP`. This avoids a public `localhost` target and keeps Worker-to-Worker calls inside Cloudflare.
- Fallback only: if the orchestrator is deployed somewhere that cannot use the service binding, configure `FEATHERLESS_MCP_URL=https://featherless-mcp.inf3ctious007.workers.dev/mcp`. A loopback URL is rejected for public requests.

Deploy commands:

```bash
npm run deploy
npm run deploy:orchestrator
```

## 1. Register The MCP Server

1. Open Prompt Opinion.
2. Go to `Configuration` -> `MCP Servers`.
3. Add the server with:
   - Friendly name: `Featherless`
   - Endpoint: `https://featherless-mcp.inf3ctious007.workers.dev/mcp`
   - Transport type: `Streamable HTTP`
   - Authentication type: `No Authentication (Open)`
4. Do not enter a Cloudflare API key. Cloudflare credentials are only for deploying Workers; Prompt Opinion patient access is authorized through the FHIR-context extension and sent as SHARP headers on tool calls.
5. Continue through the handshake.
6. Confirm the server name is `featherless`.
7. Confirm the FHIR context extension appears: `ai.promptopinion/fhir-context`.
8. Enable the Prompt Opinion FHIR context extension.
9. Keep `Selective Permissions` selected.
10. Accept the requested patient scopes for synthetic demo data:
   - `patient/Patient.rs`
   - `patient/AllergyIntolerance.rs`
   - `patient/Appointment.rs`
   - `patient/Condition.rs`
   - `patient/Coverage.rs`
   - `patient/DiagnosticReport.rs`
   - `patient/DocumentReference.rs`
   - `patient/Encounter.rs`
   - `patient/Immunization.rs`
   - `patient/MedicationRequest.rs`
   - `patient/MedicationStatement.rs`
   - `patient/Observation.rs`
   - `patient/Procedure.rs`
   - `patient/ServiceRequest.rs`
11. Save the MCP server configuration.

Expected result: Prompt Opinion can list MCP tools including:

- `clinical_pack_visit_context`
- `clinical_generate_patient_packet`
- `clinical_prepare_care_team_closure`

## 2. Register The A2A Orchestrator

1. Go to `Agents` -> `External Agents`.
2. Add the AgentCard URL: `https://featherless-orchestrator.inf3ctious007.workers.dev/.well-known/agent-card.json`.
3. Confirm the agent name is `featherless`.
4. Confirm `preferredTransport` is `JSONRPC`.
5. Confirm the FHIR context extension appears: `https://app.promptopinion.ai/schemas/a2a/v1/fhir-context`.

The AgentCard itself is public. If an API key is configured for `POST /`, Prompt Opinion must send `X-API-Key`; the public AgentCard remains readable.

## 3. Invoke Featherless

1. Launch a Prompt Opinion workspace with the synthetic Maria Garcia FHIR context.
2. Ask an agent to consult with another agent.
3. Select `featherless`.
4. Send: `Generate the visit packet for the current patient.`

Expected response:

- Spanish patient packet markdown.
- Readability metrics with `provider: workers_ai`.
- Grounding result.
- Closure resources: one `Task` per explicit follow-up order, one draft `CommunicationRequest` proposal, one `DocumentReference`. Visits without orders should not produce invented follow-up tasks.
- Trace with the three MCP hops and non-zero timings.

Important: local HAPI at `127.0.0.1:8080` is for tests only. The deployed Workers must receive a FHIR context whose `fhirUrl` is reachable from Cloudflare. Use Prompt Opinion's workspace FHIR server if it can host the synthetic patient, or load the hero bundle into an HTTPS-reachable synthetic HAPI instance:

```bash
FHIR_SERVER_URL=https://<synthetic-fhir-host>/fhir npx tsx scripts/load-hero.ts
```

## 4. Publish To Marketplace

After both URLs are registered and the consult flow works inside Prompt Opinion, publish the configured project to the Prompt Opinion Marketplace and copy the Marketplace URL for Devpost.

Public Prompt Opinion docs verified the MCP, External Agent, and FHIR-context registration flows, while the hackathon rules verify that Marketplace publication is mandatory. The public docs did not expose a step-by-step Marketplace publishing UI. If the publish control is not visible after workspace registration, contact Prompt Opinion support or Discord immediately with:

- MCP URL: `<featherless-worker-url>/mcp`
- AgentCard URL: `https://featherless-orchestrator.inf3ctious007.workers.dev/.well-known/agent-card.json`
- proof that the project is invokable from a BYO Agent through `Consult with another agent`

## 5. SHARP Proof Screenshots

Save final screenshots here:

| File | What It Should Show |
|---|---|
| `docs/sharp-proof/01-network-tab.png` | A real `tools/call` carrying SHARP headers. Redact token value. |
| `docs/sharp-proof/02-po-listing.png` | Prompt Opinion listing showing the Featherless MCP server and external agent. |
| `docs/sharp-proof/03-trace.png` | Orchestrator trace showing the three-tool workflow. |

## Troubleshooting

| Symptom | Likely Cause | Fix |
|---|---|---|
| `fhir_context_required` | Prompt Opinion did not send FHIR metadata or SHARP headers. | Re-open the registration flow and accept the FHIR context extension. |
| `llm_config_required` | Featherless Worker does not have the Workers AI binding. | Verify `ai.binding = "AI"` and `LLM_MODEL` in `wrangler.jsonc`. |
| `mcp_timeout:<tool>` | Orchestrator could not reach the MCP Worker in time. | First verify the `FEATHERLESS_MCP -> featherless-mcp` service binding. Use `FEATHERLESS_MCP_URL` only if service binding is impossible; increase `MCP_CALL_TIMEOUT_MS` only if the service is healthy. |
| Empty closure write results | Default dry-run mode is active. | This is expected unless caller sets `write_back: true` and `WRITE_BACK=1`. |
