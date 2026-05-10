# S-tool3-care-team-closure

> Created 2026-05-10 (D5) per `featherless/PLAN.md` §11 row and TODO.md Block 2 entries 06:30 / 07:30.

## Contract (do not modify)

- **Writable:**
  - `src/tools/clinical-care-team-closure.ts` (new)
  - `src/tools/schemas/care-team-closure.ts` (new)
  - `test/tools/clinical-care-team-closure.test.ts` (new)
  - `src/server.ts` — add `registerClinicalCareTeamClosureTools(server, env)` beside native clinical tool registrars.
  - `src/env.ts`, `wrangler.jsonc`, `wrangler.test.jsonc` — write-back flag only.
- **Read-only context:**
  - `src/clients/fhir-client.ts` — generic `post()` for `$validate`; direct PUT should be done locally without modifying the shared client.
  - `src/tools/_helpers.ts`, `src/context.ts` — SHARP context + FHIR client construction.
  - `../HERO_PATIENT.md` §7 — visit context source of truth.
- **Acceptance:** unit test: 3 Task + 1 CommunicationRequest + 1 DocumentReference; all R4-validate via local HAPI `$validate`; `CommunicationRequest.status="draft"` with `intent="proposal"` for human-reviewed send.
- **Source of truth:** `../../PLAN.md` §11, `../../TODO.md` D5 Block 2 entries 06:30 / 07:30, `../../../HERO_PATIENT.md` §7.

## Mirrored tasks

- [x] ~~**06:30** Build **`src/tools/clinical-care-team-closure.ts`**~~ **DONE** — emits 3 `Task` + 1 `CommunicationRequest` + 1 `DocumentReference` from visit context; R4-validates via FHIR `$validate`; `WRITE_BACK=1` is required for caller-requested PUT write-back and defaults off. Registered tool: `clinical_prepare_care_team_closure`.
- [x] ~~**07:30** Vitest unit tests for tool 3~~ **DONE** — covers JSON shape, Task status/intent, CommunicationRequest draft/proposal posture, patient reference chaining, local HAPI validation, and missing-SHARP-header failure.

## Decisions log

- `2026-05-10` · **Native naming**: Tool 3 registers as `clinical_prepare_care_team_closure` and lives in `src/tools/clinical-care-team-closure.ts`.
- `2026-05-10` · **Dry-run first**: the tool always builds and validates resources; write-back only happens when the caller requests it and `WRITE_BACK=1` is set.
- `2026-05-10` · **R4-valid send proposal**: local HAPI rejected the earlier plan's `CommunicationRequest.status="proposed"` because R4 status codes do not include `proposed`; Featherless uses `status="draft"` plus `intent="proposal"` to preserve the human-review safety posture while passing R4 validation.

## Open contract questions

- *(none currently.)*

## Output

- **Files:** `src/tools/clinical-care-team-closure.ts`, `src/tools/schemas/care-team-closure.ts`, `test/tools/clinical-care-team-closure.test.ts`, `src/server.ts`, `src/env.ts`, `wrangler.jsonc`, `wrangler.test.jsonc`, `PLAN.md`, `TODO.md`.
- **Summary:** Tool 3 builds closure resources for the visit packet workflow: three requested `Task` resources, one draft `CommunicationRequest` with `intent="proposal"` for human-reviewed send, and one markdown `DocumentReference`. The tool validates every resource against the configured FHIR server and only writes when both the caller asks for `write_back` and `WRITE_BACK=1` is set.
- **Open questions:** none.
