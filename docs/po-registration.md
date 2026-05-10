# Prompt Opinion Registration

This guide is for judges and teammates registering Featherless in a fresh Prompt Opinion workspace.

## URLs Needed

| Surface | URL |
|---|---|
| Featherless MCP server | `<featherless-worker-url>/mcp` |
| Featherless A2A orchestrator AgentCard | `<orchestrator-worker-url>/.well-known/agent-card.json` |

Use deployed HTTPS URLs for final judging. Localhost URLs are useful only for development.

## 1. Register The MCP Server

1. Open Prompt Opinion.
2. Go to `Configuration` -> `MCP Servers`.
3. Add the Featherless MCP URL: `<featherless-worker-url>/mcp`.
4. Continue through the handshake.
5. Confirm the server name is `featherless`.
6. Confirm the FHIR context extension appears: `ai.promptopinion/fhir-context`.
7. Accept the requested patient scopes for synthetic demo data.

Expected result: Prompt Opinion can list MCP tools including:

- `clinical_pack_visit_context`
- `clinical_generate_patient_packet`
- `clinical_prepare_care_team_closure`

## 2. Register The A2A Orchestrator

1. Go to `Agents` -> `External Agents`.
2. Add the AgentCard URL: `<orchestrator-worker-url>/.well-known/agent-card.json`.
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
- Five closure resources: three `Task`, one draft `CommunicationRequest` proposal, one `DocumentReference`.
- Trace with the three MCP hops and non-zero timings.

## 4. SHARP Proof Screenshots

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
| `mcp_timeout:<tool>` | Orchestrator could not reach the MCP Worker in time. | Check `FEATHERLESS_MCP_URL` and increase `MCP_CALL_TIMEOUT_MS` only if the service is healthy. |
| Empty closure write results | Default dry-run mode is active. | This is expected unless caller sets `write_back: true` and `WRITE_BACK=1`. |
