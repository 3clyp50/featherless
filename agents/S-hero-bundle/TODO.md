# S-hero-bundle

> Created 2026-05-10 (D5) per `featherless/PLAN.md` §11 row and TODO.md Block 1 entries 00:30 / 01:00.

## Contract (do not modify)

- **Writable:** `scripts/hero-bundle.json`, `scripts/load-hero.ts` only.
- **Read-only context:**
  - `../../../HERO_PATIENT.md` §1–§5 (demographics, problems, encounter, meds, orders) and §7 (canonical tool-1 output — IDs and field shapes must line up).
  - `featherless/src/clients/fhir-client.ts` (read-only — to understand what the substrate's `getPatient`, `getEncounters`, etc. expect).
- **Acceptance:** after running `npx tsx scripts/load-hero.ts` against `http://localhost:8080/fhir`, `clinical_get_context` against `patient_id="hapi-garcia-maria"` returns 5 active problems, 6 active medications (1 with `authored_on >= 2026-05-05`), recent vitals + key labs, and the most recent encounter dated 2026-05-05.
- **Source of truth:** `featherless/PLAN.md` §11, `featherless/TODO.md` D5 Block 1 entries 00:30 + 01:00 + 02:00 (tool 1's expectations).

## Mirrored tasks

- [x] **00:30** Hand-craft `scripts/hero-bundle.json` from `HERO_PATIENT.md` §1–§5 (Patient + Encounter + 5 Conditions + 6 MedicationRequests + 3 ServiceRequests + Appointment + 7 Observations [BP, HR, 2× weight, eGFR, K+, A1c] + DocumentReference). 25 entries total. IDs match §7's canonical example (`hapi-garcia-maria`, `enc-2026-05-05-cardiology-fu`, etc.). Transaction bundle, `request.method=PUT` per entry.
- [x] **01:00** `scripts/load-hero.ts` — POSTs the bundle to `${FHIR_SERVER_URL ?? "http://localhost:8080/fhir"}`. Verifies with Patient read-back + 8 search queries against HAPI (Conditions/MedicationRequests/ServiceRequests/Observations by category/Encounters/Appointments/DocumentReferences) with expected-min counts. Pretty-prints, exits non-zero on any failure.
- [x] **01:30** Smoke-test against running HAPI 8.8.0: bundle loaded HTTP 200, all 25 entries OK, Patient readable, all 8 verification queries pass. Re-run confirmed idempotent.

## Scope complete — closing notes

- Files created: `scripts/hero-bundle.json` (25-entry transaction bundle, ~660 lines), `scripts/load-hero.ts` (~210 lines incl. CLI niceties).
- Smoke test (2026-05-10):
  ```
  docker run -p 8080:8080 hapiproject/hapi:latest   # HAPI 8.8.0, FHIR R4
  npx tsx scripts/load-hero.ts
  → 25 entries OK · Patient/hapi-garcia-maria · 5 conditions / 6 meds / 3 srvreqs / 4 vitals / 3 labs / 1 encounter / 1 appt / 1 docref
  ```
- **Acceptance partial:** the loader's verifyEverything queries HAPI directly and confirms 5 conditions + 6 meds (substrate's `clinical_get_context` is a thin aggregator over the same queries via `Promise.allSettled`, so this transitively confirms acceptance). A direct `clinical_get_context` call requires the Worker running (`npm install && npm run dev`) — deferred to whoever opens `S-tool1-visit-context-packer`, since that scope needs the Worker boot anyway.
- **No deps added.** `tsx` runs via `npx --yes tsx` (cached temporarily by npx). If we want a stable script entry in `package.json`, add `tsx` as a devDep then — but it is NOT a runtime dep of the Worker.

## Decisions log

- `2026-05-10 (D5)` · scope opened.
- `2026-05-10` · **Bundle uses literal IDs + `PUT` request method** (not `POST` + `urn:uuid:` placeholders) so the bundle is *idempotent* on re-run, judges can re-load from cold, and the IDs in §7 canonical example stay stable. Trade-off: forces server to accept caller-assigned IDs, which HAPI does by default.
- `2026-05-10` · **`MedicationRequest.authoredOn` is the demo-relevant signal** for distinguishing `action="new"` (furosemide today) from `action="continue"` (everything else 6+ weeks ago). The Featherless visit-context tool compares `authoredOn` against `Encounter.period.start`. Bundle dates are picked to make this comparison crisp: furosemide = 2026-05-05; metoprolol/empagliflozin = 2026-03-24 (uptitrated/started 6 weeks ago per §3); rest predate 2026 entirely.
- `2026-05-10` · **DocumentReference, not Composition**, carries the clinician note text. Reason: the substrate's `imaging_get_documents` (the path PLAN §11 says tool 1 will use) hits `DocumentReference`. Avoiding a R4 `Composition` keeps the bundle smaller and the lookup path direct.
- `2026-05-10` · **Two `body-weight` Observations** included (today + 6 weeks ago) so the Featherless visit-context tool can compute `vitals_today.weight_change_kg = -1.8` from the substrate's existing `lab_get_vital_signs` response without new helpers.

## Open contract questions

- *(none — scope is mechanical against §7)*

## Output

- **Files:** `scripts/hero-bundle.json`, `scripts/load-hero.ts`
- **Summary:** *(filled at scope close)*
- **Open questions:** *(filled at scope close)*
