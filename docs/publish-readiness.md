# Prompt Opinion Publish Readiness

Status as of 2026-05-10: Featherless is code-ready for the Prompt Opinion path, but it is not submission-complete until the deployed project is published to the Prompt Opinion Marketplace, invokable inside Prompt Opinion, and the Devpost form includes the Marketplace URL plus the public demo video URL.

## Official Requirements Checked

- Hackathon rules: the official deadline is 2026-05-11 23:00 EDT, while Featherless keeps the stricter internal target of 2026-05-11 18:00 Europe/Rome. The submission must include a feature description, a Prompt Opinion Marketplace URL, and a public YouTube/Vimeo/Youku video under three minutes that shows Featherless functioning inside Prompt Opinion.
- Stage One pass/fail: the project must be Marketplace verified, implement MCP or A2A, be discoverable/invokable directly in Prompt Opinion, and use only synthetic or de-identified data.
- Prompt Opinion MCP path: add the MCP endpoint under `Configuration -> MCP Servers`; the MCP initialize response must declare `ai.promptopinion/fhir-context`; Prompt Opinion sends `X-FHIR-Server-URL`, `X-FHIR-Access-Token`, and `X-Patient-ID` on tool calls.
- Prompt Opinion external-agent path: add the AgentCard URL under `Agents -> External Agents`; the URL normally ends in `/.well-known/agent-card.json`; the agent is invoked from a BYO Agent through `Consult with another agent`.
- Prompt Opinion A2A FHIR context: the AgentCard declares `https://app.promptopinion.ai/schemas/a2a/v1/fhir-context`; runtime messages carry `fhirUrl`, `fhirToken`, and `patientId` in message metadata.

Sources: [Devpost rules](https://agents-assemble.devpost.com/rules), [Prompt Opinion MCP FHIR context](https://docs.promptopinion.ai/fhir-context/mcp-fhir-context), [Prompt Opinion External Agents](https://docs.promptopinion.ai/agents/external-agents), [Prompt Opinion A2A FHIR context](https://docs.promptopinion.ai/fhir-context/a2a-fhir-context), [Prompt Opinion FHIR overview](https://docs.promptopinion.ai/fhir-context/overview).

## Submission Fixes Already Landed

- The orchestrator no longer has a production localhost MCP default. It now uses the Cloudflare service binding `FEATHERLESS_MCP` by default, or an explicitly configured HTTPS `FEATHERLESS_MCP_URL`.
- The orchestrator fails fast if a public request tries to use a loopback MCP URL or if no MCP target is configured.
- The default MCP Worker deploy no longer carries placeholder D1/Vectorize bindings. Optional memory is disabled by default with `MEM0_DISABLED=1`, so Cloudflare deploy is not blocked by `REPLACE_WITH_D1_ID`.
- The visit-context packer reuses raw resources fetched by `aggregateClinicalContext()` instead of refetching Patient, MedicationRequest, Condition, vitals, and labs.
- Care-team closure date math now tolerates missing or invalid encounter dates and still emits valid date-shaped FHIR fields.
- Patient-packet generation remains Workers AI only. No external LLM provider keys are required or configured.

## Optional Memory Re-Enable Checklist

The hackathon workflow ships with `MEM0_DISABLED=1`, so `MemoryClient.fromEnv()` never requires Cloudflare Vectorize or D1. If an operator later changes `MEM0_DISABLED` to `0`, restore all memory bindings before deploy:

- `ai.binding = "AI"` in `wrangler.jsonc`
- `vectorize` binding named `MEMORY_INDEX`, usually pointing at index `featherless-memory`
- `d1_databases` binding named `MEMORY_META` with a real `database_id`, not `REPLACE_WITH_D1_ID`
- remote migration run through `npm run db:migrate:remote`

Without `MEMORY_INDEX` and `MEMORY_META`, `MemoryClient.fromEnv()` intentionally returns `null` and the memory tools do not register.

## Missing Before Marketplace Publish

1. Authenticate Cloudflare locally:

   ```bash
   npx wrangler login
   npx wrangler whoami
   ```

2. Deploy the MCP Worker first:

   ```bash
   npm run deploy
   ```

   Expected public endpoint: `<featherless-worker-url>/mcp`.

3. Deploy the orchestrator Worker second:

   ```bash
   npm run deploy:orchestrator
   ```

   Expected public AgentCard: `<orchestrator-worker-url>/.well-known/agent-card.json`.

4. Confirm the deployed orchestrator can reach the deployed MCP Worker. The preferred path is the Cloudflare service binding in `wrangler-orchestrator.jsonc`. If using a different Cloudflare account or deployment shape, set `FEATHERLESS_MCP_URL` to the deployed HTTPS MCP URL; never use `localhost` or `127.0.0.1` for judging.

5. Use a synthetic FHIR server reachable from Cloudflare Workers and Prompt Opinion. Local HAPI at `127.0.0.1:8080` is valid for tests only. For judging, either use Prompt Opinion's workspace FHIR context if it supports loading the synthetic patient, or expose a no-PHI HAPI instance over HTTPS and load the hero bundle:

   ```bash
   FHIR_SERVER_URL=https://<synthetic-fhir-host>/fhir npx tsx scripts/load-hero.ts
   ```

6. Register the deployed MCP endpoint in Prompt Opinion and accept the FHIR extension/scopes.

7. Register the deployed AgentCard in Prompt Opinion and enable the FHIR context extension.

8. Create or open a BYO Agent, make sure it can use the Featherless MCP server, then invoke the external Featherless agent through `Consult with another agent`.

9. Publish the configured project to the Prompt Opinion Marketplace and copy the resulting Marketplace URL. Public docs verified the requirement, but did not expose a step-by-step Marketplace publishing UI. If the publish control is not visible after workspace registration, ask Prompt Opinion support/Discord immediately and provide the two deployed URLs plus proof that the project is invokable in a workspace. Time-box support waiting to 15 minutes; if there is no response, continue recording with workspace registration proof, add a README limitations note that Marketplace publication is pending platform support, and copy the Marketplace URL if it becomes available later.

10. Capture proof screenshots:

    - `docs/sharp-proof/01-network-tab.png` - deployed MCP tool call with SHARP headers and redacted token.
    - `docs/sharp-proof/02-po-listing.png` - Prompt Opinion workspace listing for MCP server and external agent.
    - `docs/sharp-proof/03-trace.png` - Featherless trace from the Prompt Opinion invocation.

11. Record the final video under three minutes, publicly visible on YouTube/Vimeo/Youku, with no copyrighted music or unauthorized third-party marks.

12. Submit Devpost with:

    - text description of Featherless features and functionality,
    - GitHub PR/repo URL,
    - Prompt Opinion Marketplace URL,
    - public demo video URL,
    - testing instructions pointing to `docs/po-registration.md`.

## Final Local Gate Before Recording

Run this once after any final changes:

```bash
npm run typecheck
npm run lint
npm test
npx wrangler deploy --dry-run
npx wrangler deploy --config wrangler-orchestrator.jsonc --dry-run
```

Also run the legacy product-name scrub and external-model scan from the maintainer checklist. The expected legacy-name output is empty, and the production patient-packet path must remain `workers_ai`.
