# S-tool1-visit-context-packer

> Created 2026-05-10 (D5) per `featherless/PLAN.md` §11 row and TODO.md Block 1 entries 02:00 / 03:00.

## Contract (do not modify)

- **Writable:**
  - `src/tools/clinical-visit-context.ts` (new)
  - `src/tools/schemas/visit-context.ts` (new)
  - `test/tools/clinical-visit-context.test.ts` (new)
  - `src/server.ts` — add `registerClinicalVisitContextTools(server)` beside the other native tool registrars.
  - **Contract amendment:** `src/tools/clinical-context.ts` — refactor to expose a pure `aggregateClinicalContext()` function that the existing `clinical_get_context` tool registration *and* the new visit-context packer both call. Confirmed with user 2026-05-10. Logged below.
- **Read-only context:**
  - `src/clients/fhir-client.ts` — convenience accessors (`getEncounters`, `getMedicationRequests`, `getDocumentReferences` at line 257, etc.)
  - `src/fhir-utils.ts` — summary helpers (`medicationRequestSummary` at 286, `encounterSummary` at 338, `documentReferenceSummary` at 369). Note: `documentReferenceSummary` strips `attachment.data`; tool 1 must read raw `DocumentReference` to base64-decode the note.
  - `src/tools/_helpers.ts` — `checkFhirContext`, `resolvePatientId`, `fhirContextError` (return-don't-throw envelope).
  - `src/mcp/zod-to-json-schema.ts` — supported zod subset (object, string, number, boolean, enum, array, optional, default, nullable, literal, union, record).
  - `../../../HERO_PATIENT.md` §7 — canonical output for Mrs. García.
  - `featherless/scripts/hero-bundle.json` — loaded into local HAPI; furosemide `authoredOn=2026-05-05` is the "new med" signal.
- **Acceptance** (PLAN.md §11 row): unit test against the loaded hero bundle returns JSON shaped like §7; `medication_changes[0].action === "new"` for furosemide; `active_problems.length === 5`; `orders.length === 4`. `tools/list` JSON-RPC includes `clinical_pack_visit_context`.
- **Source of truth:** `../../PLAN.md` §11, `../../TODO.md` D5 Block 1 entries 02:00 + 03:00, `../../../HERO_PATIENT.md` §7.

## Mirrored tasks

> Copied verbatim from `featherless/TODO.md` lines 51-53.

- [x] **02:00** Build **`src/tools/clinical-visit-context.ts`** — wraps Featherless tools internally (calls the shared clinical context aggregator and raw FHIR accessors for note/order details) and returns the typed payload from `../HERO_PATIENT.md` §7. Schema: `src/tools/schemas/visit-context.ts` (zod).
- [x] **03:00** Vitest unit test against the loaded hero bundle. Output must include `medication_changes[*].action="new"` for furosemide.
- [ ] **03:45** [judge] Merge S-hero-bundle + S-tool1 into main; run typecheck + lint + tests; tag `d5-tool1-green`. *(out of scope here — judge handles.)*

## Decisions log

- `2026-05-10 (D5)` · scope opened; mirror TODO created.
- `2026-05-10` · **Contract amendment**: `src/tools/clinical-context.ts` added to writable surface. Reason: existing `clinical_get_context` is fully inlined inside a `server.tool()` handler; refactoring it to expose a pure `aggregateClinicalContext(opts)` function (and have the registration call it) lets the visit-context packer compose the same aggregation in-process with no HTTP round-trip and no duplicated `Promise.allSettled` block. User confirmed option (a) over inlining (option b). Behavior of `clinical_get_context` MUST remain unchanged; this is a pure code-motion refactor.
- `2026-05-10` · **Tool naming**: `clinical_pack_visit_context`. Earlier proposed product-specific namespace rejected. Resolved: tool 1 belongs under the existing `clinical_*` prefix because it is a visit-scoped variant of `clinical_get_context`; future tools should also use existing Featherless prefixes where they naturally fit.
- `2026-05-10` · **Code namespace cleanup**: removed the product-specific source/test folders and moved the implementation under native Featherless tool paths: `src/tools/clinical-visit-context.ts`, `src/tools/schemas/visit-context.ts`, and `test/tools/clinical-visit-context.test.ts`.
- `2026-05-10` · **Composition source**: §7 expects `clinician_summary` text; bundle stores it base64-embedded in `DocumentReference.content[0].attachment.data`. Tool 1 fetches raw `DocumentReference` (not the summary helper, which strips `data`) and decodes via `atob`. Documented in PLAN/handoff already (D8).
- `2026-05-10` · **`action="new"` cutoff**: `MedicationRequest.authoredOn >= Encounter.period.start` (date-level compare; both treated as `YYYY-MM-DD` after slicing). Furosemide `authoredOn=2026-05-05` matches today's encounter; uptitrated meds (`2026-03-24`) and older are `"continue"`.
- `2026-05-10` · **medication_changes ordering**: `"new"` entries first, then `"continue"`, each by `authored_on` descending, so the test's `medication_changes[0]` predictably gets the new med.
- `2026-05-10` · **§7 enrichment fields** (`nyha`, `last_a1c`, `egfr` on problems; `caregiver_present` on the envelope): zod schema marks them `.optional()`. Tool fills them on a best-effort basis (regex on Condition.text for NYHA; latest A1c lab → diabetes problem; latest eGFR lab → CKD problem). If the pattern doesn't match, the field is omitted. Test asserts only counts + `[0].action`, not these enrichment fields.
- `2026-05-10` · **Test pool reaches HAPI**: vitest uses `SELF.fetch("/mcp", …)` with explicit `X-FHIR-Server-URL: http://localhost:8080/fhir` + `X-FHIR-Access-Token: anonymous` + `X-Patient-ID: hapi-garcia-maria` headers (production-shaped, no need to flip `FEATHERLESS_DEV_MODE` in the test config). If local HAPI is down, test calls `console.warn` and returns early — same pattern as the existing e2e test's "Smith on HAPI" check.
- `2026-05-10` · **Product namespace cleanup**: all product-specific legacy naming was removed from code, tests, planning docs, and stale handoff artifacts. Tool 1 remains a native `clinical_*` Featherless tool; future visit-workflow tools should use existing Featherless prefixes rather than product-specific prefixes.
- `2026-05-10` · **E2E stabilization**: `test/e2e.test.ts` now checks `fhir_get_capability_statement` against local synthetic HAPI (`127.0.0.1:8080`) instead of the public HAPI sandbox, avoiding a 30s upstream timeout while keeping the dashboard smoke against public HAPI.

## Open contract questions

- *(none currently — refactor, native Featherless naming, and source/test paths resolved.)*

## Output

- **Files:** `src/tools/clinical-visit-context.ts`, `src/tools/schemas/visit-context.ts`, `test/tools/clinical-visit-context.test.ts`, `src/tools/clinical-context.ts`, `src/server.ts`, `test/e2e.test.ts`, `PLAN.md`, `TODO.md`, `agents/S-tool1-visit-context-packer/TODO.md`, `agents/S-hero-bundle/TODO.md`, `agents/S-po-manifest-spike/DECISION.md`, `agents/S-po-manifest-spike/TODO.md`.
- **Summary:** Tool 1 is implemented as `clinical_pack_visit_context` in the native Featherless tool layout. It composes `aggregateClinicalContext()` with raw Patient, MedicationRequest, ServiceRequest, Appointment, DocumentReference, vitals, and lab fetches; derives medication `new` vs `continue` from `MedicationRequest.authoredOn >= Encounter.period.start`; decodes clinician note text from `DocumentReference`; and returns the HERO §7-shaped visit context with snake_case fields.
- **Verification:** `npm run typecheck && npx biome check src/tools/clinical-visit-context.ts src/tools/schemas/visit-context.ts test/tools/clinical-visit-context.test.ts src/tools/clinical-context.ts src/server.ts test/e2e.test.ts scripts/load-hero.ts && npm test` passed on 2026-05-10: 25/25 tests green.
- **Open questions:** none for Tool 1.
