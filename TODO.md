# TODO.md — Featherless (Native Visit Workflow)

**Spec:** `PLAN.md` (this folder), `../HERO_PATIENT.md`, `../CITATIONS.md`, `../DECISIONS.md`.
**Submission:** Mon 2026-05-11, 18:00 Europe/Rome.
**Today:** Sun 2026-05-10 (D5).
**Repo:** https://github.com/TerminallyLazy/featherless · **Authors (in order):** Chadwick, Alessandro Frau.
**Operating rule:** if a task isn't on this list and isn't blocking submission, it goes to `BACKLOG.md`. No exceptions until after submit.

---

## 🤝 Delegation protocol (read this first if you are a subagent)

Every block below is a **scope**, owned by one subagent. PLAN.md §11 has the full contract. The short version:

1. **Read your scope row in PLAN §11.** Do not start work until you have read your `Writable`, `Read-only context`, and `Acceptance` columns.
2. **Create `agents/<scope>/TODO.md`** at start. Copy the relevant lines from this file verbatim under `## Mirrored tasks`. Update statuses there *as you work*, not at the end. This file survives any context compaction.
3. **Touch only files in your `Writable` list.** Anything else → judge rejects the scope.
4. **Log decisions in your mirror TODO.** Any non-obvious choice (a schema field name, a retry count, a fallback path) goes under `## Decisions log` with one-line rationale. Future-you will thank present-you.
5. **Surface contract questions, don't guess.** If `../HERO_PATIENT.md` §7 contradicts PLAN §4, raise it in `## Open contract questions` and tag it `block` or `non-block`. The judge or the human resolves; you do not invent.
6. **Output contract:** at end, your final message is (a) files created/modified, (b) one paragraph of decisions made, (c) any open questions. No "I have successfully completed…" prose.

The **judge subagent** merges, runs `pnpm typecheck && pnpm lint && pnpm test`, and rejects anything that drifted from the contract. Acceptance gates are mechanical, not editorial.

**Mirror-TODO file path convention:** `agents/<scope>/TODO.md` — committed to the repo, visible to human judges as a multi-agent provenance artifact. (`agents/` is a feature, not noise. Tripathi sees it.)

---

## 🚦 Stage One — non-scoring gates (must all be green by D6 lunch)

These are pass/fail. If any one is red at submit time, we don't get judged.

- [ ] **PO workspace registration** — featherless MCP URL added under `Configuration → MCP Servers`; orchestrator agent-card URL added under `Agents → External Agents`; both visible in launchpad and invokable. (Replaces "Marketplace publish" — see DECISION.md.)
- [ ] **Platform integration** — orchestrator consultable *from inside* a PO BYO Agent via "Consult with another agent" (not just curl-able at the edge URL)
- [ ] **Protocol adherence** — MCP server (JSON-RPC over Streamable HTTP, `initialize` declares `ai.promptopinion/fhir-context` extension) + A2A agent (agent card + `message/send`, declares the `https://app.promptopinion.ai/schemas/a2a/v1/fhir-context` extension)
- [ ] **SHARP context** — `X-FHIR-Server-URL` / `X-FHIR-Access-Token` / `X-Patient-ID` flow proven in logs end-to-end (orchestrator A2A metadata → featherless headers → FHIR); **zero token storage** — verified by inspecting Worker source
- [ ] **Synthetic data only** — local HAPI Docker + hand-crafted Mrs. García bundle; no PHI

---

## 🗓️ D5 — Sun May 10 (today)

**Theme:** Land the Featherless visit workflow. Ship locally. README skeleton.

### Block 1 · Morning (4h) — substrate + first tool

**Scopes:** ~~`S-po-manifest-spike`~~ (DONE) · `S-hero-bundle` · `S-tool1-visit-context-packer`

- [x] ~~**00:00** [`S-po-manifest-spike`] PO manifest verification.~~ **RESOLVED 2026-05-10** — PO accepts external A2A agents via agent-card URL, MCP servers via `initialize` extension. No `marketplace.yaml`. Two-Worker A2A confirmed. See [`agents/S-po-manifest-spike/DECISION.md`](agents/S-po-manifest-spike/DECISION.md).
- [x] ~~**00:30** [`S-hero-bundle`] Hand-craft `scripts/hero-bundle.json`~~ **DONE** — 25-entry transaction bundle (1 Patient, 5 Conditions, 6 MedicationRequests, 1 Encounter, 3 ServiceRequests, 1 Appointment, 7 Observations, 1 DocumentReference). IDs match §7. `request.method=PUT` per entry → idempotent.
- [x] ~~**01:00** [`S-hero-bundle`] `scripts/load-hero.ts`~~ **DONE** — tsx-runnable loader. Smoke-tested 2026-05-10 against HAPI 8.8.0: HTTP 200, 25/25 entries OK, Patient + 8 verification queries green. `clinical_get_context` smoke deferred to `S-tool1-visit-context-packer` (which boots the Worker anyway). See [`agents/S-hero-bundle/TODO.md`](agents/S-hero-bundle/TODO.md) for full closing notes.
- [x] ~~**02:00** [`S-tool1-visit-context-packer`] Build **`src/tools/clinical-visit-context.ts`**~~ **DONE** — native Featherless `clinical_pack_visit_context` tool registered from `src/tools/clinical-visit-context.ts`; schema in `src/tools/schemas/visit-context.ts`; product-specific legacy namespace scrubbed from code/docs.
- [x] ~~**03:00** [`S-tool1-visit-context-packer`] Vitest unit test against the loaded hero bundle.~~ **DONE** — `test/tools/clinical-visit-context.test.ts` proves the §7 envelope, furosemide `action="new"`, 5 active problems, 4 orders, local HAPI headers, and missing-header error envelope.
- [ ] **03:45** [judge] Merge S-hero-bundle + S-tool1 into main; run typecheck + lint + tests; tag `d5-tool1-green`.

### Block 2 · Afternoon (4h) — tools 2 + 3

**Scopes:** `S-tool2-patient-packet` · `S-tool3-care-team-closure` (can run in parallel — different writable surfaces, no shared state)

- [ ] **04:00** [human only] verify the Cloudflare Workers AI binding and `LLM_MODEL` in `wrangler.jsonc`. No external LLM provider secret is used.
- [x] ~~**04:15** [`S-tool2-patient-packet`] Build **`src/tools/clinical-patient-packet.ts`**~~ **DONE** — `clinical_generate_patient_packet` uses Workers AI via the Worker `AI` binding, returns packet markdown + structured content, and avoids external LLM provider keys.
- [x] ~~**05:30** [`S-tool2-patient-packet`] Reading-level metrics inline~~ **DONE** — `src/tools/readability.ts` reports Flesch-Kincaid and INFLESZ; unit tests cover English and Spanish targets.
- [x] ~~**06:00** [`S-tool2-patient-packet`] Citation-grounding validator~~ **DONE** — validator checks allowed citations, unsupported quoted phrases, and unknown dose strings; tests cover passing packet generation and tampered rejection.
- [ ] **06:30** [`S-tool3-care-team-closure`] Build **`src/tools/clinical-care-team-closure.ts`** — emits 3 `Task` + 1 `CommunicationRequest` + 1 `DocumentReference` from visit context. R4-validate via the FHIR `$validate` operation against local HAPI. `WRITE_BACK=1` env flag PUTs them; default off. Registered tool: `clinical_prepare_care_team_closure`.
- [ ] **07:30** [`S-tool3-care-team-closure`] Vitest unit tests for tool 3. Validate JSON shape, statuses, `intent`, and `for.reference` chaining to the patient.
- [ ] **07:45** [judge] Merge S-tool2 + S-tool3; run typecheck + lint + tests; tag `d5-tools-green`.

### Block 3 · Evening (4h) — orchestrator + e2e + PO publish + README

**Scopes:** `S-orchestrator` · `S-po-publish-and-readme`

- [ ] **08:00** [`S-orchestrator`] Scaffold `orchestrator/` — separate `wrangler-orchestrator.jsonc`, separate `src/orchestrator/index.ts` on Hono. Two routes: `GET /.well-known/agent-card.json` (static AgentCard JSON, shape per `../po-adk-typescript/shared/appFactory.ts:257-278`, `preferredTransport: "JSONRPC"`, declares `https://app.promptopinion.ai/schemas/a2a/v1/fhir-context` extension) and `POST /` (A2A JSON-RPC dispatcher; method `message/send` minimum). Inside `message/send`: parse text from `params.message.parts`, extract FHIR context from `params.message.metadata["…/fhir-context"]`, call featherless `/mcp` three times (`clinical_pack_visit_context` → `clinical_generate_patient_packet` → `clinical_prepare_care_team_closure`) translating metadata → `X-FHIR-Server-URL` / `X-FHIR-Access-Token` / `X-Patient-ID`, return `{ result, trace: [{tool, started_at, ms, ok}], errors }` as the A2A reply message text. **Do not import `@a2a-js/sdk` or `express`** — neither runs on Workers.
- [ ] **09:00** [`S-orchestrator`] SHARP header forwarding test: orchestrator must translate A2A `metadata.fhir-context` to `X-FHIR-*` headers on outgoing MCP calls verbatim; never log token; vitest asserts both. Plus an agent-card test: `GET /.well-known/agent-card.json` returns valid JSON with all required fields per spike DECISION.md §Q2.
- [ ] **09:30** [judge] **e2e test:** `pnpm e2e` against local HAPI + hero patient. Asserts (a) Spanish output, (b) FK + INFLESZ reported, (c) 3+1+1 FHIR resources validate, (d) full trace returned with non-zero timings on every hop. **This is the gate that says "the system works."**
- [ ] **10:00** [`S-po-publish-and-readme`] Migrate `../HERO_PATIENT.md`, `../CITATIONS.md`, `../DECISIONS.md`, `../BACKLOG.md`, `../LICENSE` into this folder. Update paths in PLAN.md.
- [ ] **10:15** [`S-po-publish-and-readme`] Write `docs/po-registration.md` — judge-facing step-by-step: (1) paste `<featherless-url>/mcp` into `Configuration → MCP Servers`, click Continue, accept the `ai.promptopinion/fhir-context` extension and the requested SMART scopes; (2) paste `<orchestrator-url>/.well-known/agent-card.json` into `Agents → External Agents`, accept FHIR-context extension; (3) launch a BYO Agent → "Consult with another agent" → select `featherless`; (4) ask "generate the visit packet for the current patient." Include screenshots placeholder slots for `docs/sharp-proof/`.
- [ ] **10:30** [`S-po-publish-and-readme`] README skeleton at 80% — 14-section AGENT4 §5.2 structure, hero quote, hackathon table, 3 sourced stats from `../CITATIONS.md`, tool table, orchestrator paragraph, hero patient, AI Factor 4-bullet section, ASCII architecture diagram (copy from PLAN.md §3), $0-cost tech stack, 5Ts matrix, standards block, timeline, MIT license. **Authors: Chadwick (first), Alessandro Frau (second).** No `marketplace.yaml`.
- [ ] **11:30** **Submit Devpost as draft tonight** — placeholder video link OK, everything else final-shape.
- [ ] **11:45** `git tag d5-eod-green`. Sleep.

### D5 EOD gate (must be true before sleep)

- ✅ Three Featherless visit-workflow tools work independently against the loaded hero patient
- ✅ Orchestrator runs end-to-end with full trace
- ✅ Both URLs (featherless `/mcp`, orchestrator `/.well-known/agent-card.json`) register cleanly in a fresh PO workspace
- ✅ Devpost draft submitted
- ✅ README at 80%

If any of these is red → record an *insurance* rough-cut video tonight even if hideous. Same rule as the original D3 plan.

---

## 🗓️ D6 — Mon May 11 (submission day)

**Theme:** Record. Polish. Submit by 18:00. No new code after 14:00.

### Block 1 · Morning (4h) — record

- [ ] **00:00** Deploy both Workers to Cloudflare. Verify SHARP headers in network tab against the *deployed* URL (not local). Screenshot to `docs/sharp-proof/01-network-tab.png`.
- [ ] **00:30** Register both URLs in a fresh PO workspace per `docs/po-registration.md`. Screenshot the workspace listing (MCP servers + External Agents pages) to `docs/sharp-proof/02-po-listing.png`.
- [ ] **01:00** Run end-to-end through PO workspace once. Screenshot the orchestrator trace pane to `docs/sharp-proof/03-trace.png`. **This is the only run where it matters that it works in PO; if PO integration breaks here, fall back to local-Worker demo and document it in README under "Limitations."**
- [ ] **01:30** Record final 2:45–2:55 video to AGENT4 §5.4 beat list. Two takes max. Pick the better one.
  - 0:00–0:15 patient hook (Mrs. García leaving the cardiologist)
  - 0:15–0:35 three statistics on screen, sourced from CITATIONS
  - 0:35–1:30 PO platform run — agent handshake, A2A trace pane, tools fire
  - 1:30–2:15 the artifact: Spanish, grade-6, furosemide PRN flagged, FK + INFLESZ scores visible, FHIR Tasks, citations
  - 2:15–2:35 standards proof: SHARP headers in network tab · PO workspace listing (MCP servers + External Agents) · multi-agent trace
  - 2:35–2:50 close card: authors (Chadwick, Alessandro Frau) + GitHub URL + PO registration URLs
- [ ] **03:00** Upload to YouTube *unlisted*. Test the link in an incognito window.
- [ ] **03:30** Record judge walkthrough Loom, 5–7 min: SHARP middleware, A2A trace, tool surfaces, citation pack, productization.

### Block 2 · Lunch (1h) — outsider tests

- [ ] **04:00** **Cold-watch test:** one non-team person watches the 3-min video with no context. If they can't say what it does by 0:30, re-edit the hook only.
- [ ] **04:30** **Judge-walk test:** different non-team person opens Devpost → README → `docs/po-registration.md` → registers both URLs in their own PO workspace → invokes the agent. Time it.

### Block 3 · Afternoon (3h) — finalize + submit

- [ ] **05:00** Fix exactly **one** thing from each test. Resist the urge to fix more.
- [ ] **05:30** README at 100%. Both video links embedded. License + citations + decisions + backlog all in place at repo root.
- [ ] **06:00** Update Devpost with real video link. Re-read submission once. Check video plays from cold link.
- [ ] **06:30** **Submit final.** Do not submit at 02:55 UTC tomorrow. Submit by 18:00 Europe/Rome today.
- [ ] **07:00** Post-submit: tweet, share to PO community, send to AGENT4-named contacts.

### D6 EOD gate

- ✅ Submitted, confirmed in Devpost
- ✅ Video plays from cold link in incognito
- ✅ Both URLs invokable in a judge's own PO workspace per `docs/po-registration.md`
- ✅ All 3 sharp-proof screenshots committed

---

## 🛡️ Standing rules (apply to every minute of D5 + D6)

- [ ] **Three Featherless visit-workflow tools max.** New ideas → `BACKLOG.md`.
- [ ] **Citation-or-cut.** Any clinical claim, anywhere, must trace to `CITATIONS.md`. No grounding → cut.
- [ ] **No token storage, ever.** Both Workers log per-request; persist nothing. Verify by reading the source before deploy.
- [ ] **Synthetic data only.** Local HAPI + hand-crafted bundle. No HAPI public sandbox in the demo path.
- [ ] **Human-in-the-loop on send.** `CommunicationRequest.status = "proposed"`, never `"active"`.
- [ ] **Build like deadline is D6 14:00.** The 4 hours after that are submission, not building.
- [ ] **No new dependencies after D5 EOD.** Period.

---

## 🚨 Fallback ladder (if D5 slips)

Only one of these can be true. Pick the lowest-risk path that's still green at the time of decision.

- **If by D5 18:00 local** the orchestrator isn't routing SHARP headers correctly → collapse to single-Worker `/orchestrate` route in featherless. Update PLAN §3 + S3 sentence. Lose ~10% of Tripathi's claim, gain 4h.
- **If by D5 22:00 local** Workers AI output is flaky → switch to template-first Spanish packet generation with Workers AI only for final wording polish; English becomes the control path. Document any limitation in BACKLOG.
- **If by D5 EOD** any of {patient packet generates, hero bundle loads, both URLs register in PO} is red → ship the *substrate* + a single demo tool + a manual demo script. Reframe as "Featherless v0.1 — substrate shipped, visit workflow partial, orchestrator in BACKLOG." This is the worst-case but still a real submission.
- **Never** attempt a fourth tool, a second hero patient, or a v2 architecture after D5 12:00. Ship what works.

---

## 💡 Pinned reminder

> Honorable mention: **$1,000**. Grand prize: **$7,500**.
> The delta is the README, the PO workspace listing (judge can paste two URLs and it works), and the video.
> **Spend D6 morning on those, not on code.**
