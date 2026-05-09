# featherless

TypeScript [SHARP-on-MCP](https://www.sharponmcp.com/overview.html)-compliant FHIR R4 MCP server with MCP-UI clinical dashboards. Runs on Cloudflare Workers.

Sibling project to [`sharp-fhir-mcp`](https://github.com/TerminallyLazy/sharp-fhir-mcp) (Python, FastMCP 2.x). Same SHARP semantics, same tool set, same MCP-UI Chart.js visualizations — re-implemented in TypeScript for the edge.

## What's included

**Core**
- SHARP HTTP transport via Cloudflare `agents` SDK (`McpAgent`, Durable Object–backed sessions)
- Header-based context (`X-FHIR-Server-URL`, `X-FHIR-Access-Token`, `X-Patient-ID`) with SMART JWT claim fallback
- Strict and permissive context modes
- `experimental.fhir_context_required` capability injected into `initialize`

**Tools (parity with `sharp-fhir-mcp`)**
- `tools/fhir.ts` — generic FHIR R4 search/read
- `tools/clinical.ts` — Patient / Encounter / Appointment / Allergy / Medication / Problem
- `tools/lab-imaging.ts` — Observation / DiagnosticReport / DocumentReference
- `tools/clinical-context.ts` — aggregated visit context with derived alerts
- `tools/memory.ts` — clinical memory backed by Cloudflare Vectorize + Workers AI + D1
- `tools/visualization.ts` — MCP-UI Chart.js dashboards (`visualize_lab_trend`, `visualize_vitals`, `visualize_patient_dashboard`)

## Getting started

```bash
pnpm install
# create the Vectorize index (once)
pnpm wrangler vectorize create featherless-memory --dimensions=768 --metric=cosine
# create the D1 database (once), put the id into wrangler.jsonc
pnpm wrangler d1 create featherless-memory-meta
pnpm db:migrate:remote
# develop
pnpm dev
```

## SHARP context

Forward these headers on every `tools/call`:

| Header                | Purpose                                  |
| --------------------- | ---------------------------------------- |
| `X-FHIR-Server-URL`   | FHIR R4 base URL                         |
| `X-FHIR-Access-Token` | OAuth2/SMART access token (Bearer optional) |
| `X-Patient-ID`        | Optional; falls back to JWT `patient` claim |

## License

MIT.
