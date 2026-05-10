# S-tool2-patient-packet

> Created 2026-05-10 (D5) per `featherless/PLAN.md` §11 row and TODO.md Block 2 entries 04:15 / 05:30 / 06:00.

## Contract (do not modify)

- **Writable:**
  - `src/tools/clinical-patient-packet.ts` (new)
  - `src/tools/schemas/patient-packet.ts` (new)
  - `src/tools/readability.ts` (new)
  - `src/tools/grounding-validator.ts` (new)
  - `test/tools/clinical-patient-packet.test.ts` (new)
  - `test/tools/readability.test.ts` (new)
  - `src/server.ts` — add `registerClinicalPatientPacketTools(server)` beside the other native tool registrars.
- **Read-only context:**
  - `src/tools/clinical-visit-context.ts` and `src/tools/schemas/visit-context.ts` — canonical Tool 1 output.
  - `../CITATIONS.md` — citation allow-list (`CIT-001` through `CIT-010`).
  - `../HERO_PATIENT.md` §7, §8, §9 — visit context, target patient packet, and hard safety questions.
  - `src/tools/_helpers.ts`, `src/context.ts`, `src/env.ts` — Worker context and secret-handling patterns.
- **Acceptance:** unit test: Spanish output, FK + INFLESZ reported, grounding-validator passes for canonical case and rejects a tampered phrase.
- **Source of truth:** `../../PLAN.md` §11, `../../TODO.md` D5 Block 2 entries 04:15 / 05:30 / 06:00, `../../../HERO_PATIENT.md` §7-§9, `../../../CITATIONS.md`.

## Mirrored tasks

> Copied from `featherless/TODO.md` lines 59-62 after native Featherless namespace cleanup.

- [ ] **04:00** [human only] verify the Cloudflare Workers AI binding and `LLM_MODEL` in `wrangler.jsonc`. No external LLM provider secret is used.
- [x] **04:15** Build **`src/tools/clinical-patient-packet.ts`** — input: visit context + `preferred_language` + `reading_level_target`; calls Workers AI through the existing Worker `AI` binding; output schema in `src/tools/schemas/patient-packet.ts`. System prompt embeds `../CITATIONS.md` allow-list (CIT-001 through CIT-010). Registered tool: `clinical_generate_patient_packet`.
- [x] **05:30** Reading-level metrics inline: Flesch-Kincaid (English) + Szigriszt-Pazos / INFLESZ (Spanish), ~30 LOC each in `src/tools/readability.ts`. Unit-test against known sentences.
- [x] **06:00** Citation-grounding validator: any direct quote >=6 words must appear in chart or allow-list source text. Reject -> regenerate once -> fail loudly. Unit-tested with one passing and one tampered output.

## Decisions log

- `2026-05-10` · **Native naming**: Tool 2 will register as `clinical_generate_patient_packet` and live in `src/tools/clinical-patient-packet.ts`; no product-specific namespace or source directory.
- `2026-05-10` · **Workers AI only**: Tool 2 uses Cloudflare Workers AI via the existing `AI` binding and `LLM_MODEL`. No external LLM provider APIs, no provider API keys, and no patient-context egress to a third-party LLM service.
- `2026-05-10` · **No new dependencies**: Workers AI is called through the native binding; readability and grounding validation are local TypeScript helpers.
- `2026-05-10` · **Test seam**: unit tests may inject a fake LLM client into the pure generator, but the production tool path remains Workers AI-only.
- `2026-05-10` · **Deterministic test posture**: public HAPI calls in `test/fhir-client.test.ts` were moved to local synthetic HAPI to avoid public-sandbox rate limits during the submission gate.

## Open contract questions

- *(none currently — native Featherless naming resolved by user direction.)*

## Output

- **Files:** `src/tools/clinical-patient-packet.ts`, `src/tools/schemas/patient-packet.ts`, `src/tools/readability.ts`, `src/tools/grounding-validator.ts`, `test/tools/clinical-patient-packet.test.ts`, `test/tools/readability.test.ts`, `test/tools/fixtures.ts`, `src/env.ts`, `src/server.ts`, `wrangler.jsonc`, `wrangler.test.jsonc`, `test/fhir-client.test.ts`, `PLAN.md`, `TODO.md`.
- **Summary:** Tool 2 is implemented as `clinical_generate_patient_packet`, registered from the native Featherless tools layout. It uses Workers AI only through the Worker `AI` binding, renders a structured Spanish patient packet from Tool 1 visit context, reports Flesch-Kincaid + INFLESZ metrics, validates citation/dose grounding, and returns a safe config envelope when `AI` is not bound.
- **Verification:** `npm run typecheck && npx biome check ... && npm test` passed on 2026-05-10: 31/31 tests green. CodeRabbit prompt-only review was run once for this diff; both findings were fixed.
- **Open questions:** 04:00 human-only deployment check remains: verify the deployed Cloudflare Worker has the `AI` binding and desired `LLM_MODEL`.
