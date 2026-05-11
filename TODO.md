# TODO.md — Featherless (Native Visit Workflow)

**Spec:** `PLAN.md`, `HERO_PATIENT.md`, `CITATIONS.md`, `DECISIONS.md`.
**Submission:** Mon 2026-05-11, 18:00 Europe/Rome.
**Current phase:** Mon 2026-05-11 (D6).
**Repo:** https://github.com/TerminallyLazy/featherless · **Authors (in order):** Chadwick, Alessandro Frau.
**Operating rule:** if a task isn't on this list and isn't blocking submission, it goes to `BACKLOG.md`. No exceptions until after submit.

---

## 🤝 Delegation protocol (read this first if you are a subagent)

Every block below is a **scope**, owned by one subagent. PLAN.md §11 has the full contract. The short version:

1. **Read your scope row in PLAN §11.** Do not start work until you have read your `Writable`, `Read-only context`, and `Acceptance` columns.
2. **Create `agents/<scope>/TODO.md`** at start. Copy the relevant lines from this file verbatim under `## Mirrored tasks`. Update statuses there *as you work*, not at the end. This file survives any context compaction.
3. **Touch only files in your `Writable` list.** Anything else → judge rejects the scope.
4. **Log decisions in your mirror TODO.** Any non-obvious choice (a schema field name, a retry count, a fallback path) goes under `## Decisions log` with one-line rationale. Future-you will thank present-you.
5. **Surface contract questions, don't guess.** If `HERO_PATIENT.md` §7 contradicts PLAN §4, raise it in `## Open contract questions` and tag it `block` or `non-block`. The judge or the human resolves; you do not invent.
6. **Output contract:** at end, your final message is (a) files created/modified, (b) one paragraph of decisions made, (c) any open questions. No "I have successfully completed…" prose.

The **judge subagent** merges, runs `pnpm typecheck && pnpm lint && pnpm test`, and rejects anything that drifted from the contract. Acceptance gates are mechanical, not editorial.

**Mirror-TODO file path convention:** `agents/<scope>/TODO.md` — committed to the repo, visible to human judges as a multi-agent provenance artifact. (`agents/` is a feature, not noise. Tripathi sees it.)

---

## 🚦 Stage One — non-scoring gates (must all be green by submission)

These are pass/fail. If any one is red at submit time, we don't get judged.

- [x] **PO Marketplace publication** — BYO Agent, External A2A Agent, and MCP server are published in the Prompt Opinion Marketplace. Copy the final URL choice into Devpost. See [`docs/publish-readiness.md`](docs/publish-readiness.md).
  - MCP Marketplace URL: `https://app.promptopinion.ai/marketplace/mcp/019e12cd-76bd-708f-b230-e48da20ad8bc`
  - External A2A Agent Marketplace URL: `https://app.promptopinion.ai/marketplace/agent/019e12e2-d251-7de3-bf49-16376ff51e73`
  - BYO Agent is published; paste its Marketplace URL here too if it is the Devpost primary link.
- [x] **Platform integration** — Featherless is consultable from inside a Prompt Opinion BYO Agent via `Consult with another agent`; use the external `Featherless` A2A entry, not the similarly named workspace wrapper.
- [x] **Protocol adherence** — MCP Worker is deployed at `https://featherless-mcp.inf3ctious007.workers.dev/mcp` with Streamable HTTP JSON-RPC and `ai.promptopinion/fhir-context`; A2A orchestrator is deployed at `https://featherless-orchestrator.inf3ctious007.workers.dev/.well-known/agent-card.json` with AgentCard + `message/send` and `https://app.promptopinion.ai/schemas/a2a/v1/fhir-context`.
- [x] **SHARP context** — Prompt Opinion FHIR metadata flows through the A2A orchestrator into MCP SHARP headers (`X-FHIR-Server-URL`, `X-FHIR-Access-Token`, `X-Patient-ID`); source inspection confirms per-request forwarding and no token storage. Capture final redacted screenshots before submission.
- [x] **Synthetic data only** — local HAPI hero bundle and Prompt Opinion synthetic patient testing only; no PHI.

---

## 🗓️ D5 — Sun May 10 (completed build day)

**Theme:** Land the Featherless visit workflow. Ship locally. README skeleton.

### Block 1 · Morning (4h) — substrate + first tool

**Scopes:** ~~`S-po-manifest-spike`~~ (DONE) · `S-hero-bundle` · `S-tool1-visit-context-packer`

- [x] ~~**00:00** [`S-po-manifest-spike`] PO manifest verification.~~ **RESOLVED 2026-05-10** — PO accepts external A2A agents via agent-card URL, MCP servers via `initialize` extension. No `marketplace.yaml`. Two-Worker A2A confirmed. See [`agents/S-po-manifest-spike/DECISION.md`](agents/S-po-manifest-spike/DECISION.md).
- [x] ~~**00:30** [`S-hero-bundle`] Hand-craft `scripts/hero-bundle.json`~~ **DONE** — 25-entry transaction bundle (1 Patient, 5 Conditions, 6 MedicationRequests, 1 Encounter, 3 ServiceRequests, 1 Appointment, 7 Observations, 1 DocumentReference). IDs match §7. `request.method=PUT` per entry → idempotent.
- [x] ~~**01:00** [`S-hero-bundle`] `scripts/load-hero.ts`~~ **DONE** — tsx-runnable loader. Smoke-tested 2026-05-10 against HAPI 8.8.0: HTTP 200, 25/25 entries OK, Patient + 8 verification queries green. `clinical_get_context` smoke deferred to `S-tool1-visit-context-packer` (which boots the Worker anyway). See [`agents/S-hero-bundle/TODO.md`](agents/S-hero-bundle/TODO.md) for full closing notes.
- [x] ~~**02:00** [`S-tool1-visit-context-packer`] Build **`src/tools/clinical-visit-context.ts`**~~ **DONE** — native Featherless `clinical_pack_visit_context` tool registered from `src/tools/clinical-visit-context.ts`; schema in `src/tools/schemas/visit-context.ts`; product-specific legacy namespace scrubbed from code/docs.
- [x] ~~**03:00** [`S-tool1-visit-context-packer`] Vitest unit test against the loaded hero bundle.~~ **DONE** — `test/tools/clinical-visit-context.test.ts` proves the §7 envelope, furosemide `action="new"`, 5 active problems, 4 orders, local HAPI headers, and missing-header error envelope.
- [x] ~~**03:45** [judge] Merge S-hero-bundle + S-tool1 into main; run typecheck + lint + tests; tag `d5-tool1-green`.~~ **DONE** — folded into the final D5/D6 gate; latest full suite reported 56/56 after encounter fallback fix.

### Block 2 · Afternoon (4h) — tools 2 + 3

**Scopes:** `S-tool2-patient-packet` · `S-tool3-care-team-closure` (can run in parallel — different writable surfaces, no shared state)

- [x] ~~**04:00** [human only] verify the Cloudflare Workers AI binding and `LLM_MODEL` in `wrangler.jsonc`. No external LLM provider secret is used.~~ **DONE** — production patient-packet generation uses Cloudflare Workers AI with `LLM_MODEL=@cf/openai/gpt-oss-120b`; no external provider key is required.
- [x] ~~**04:15** [`S-tool2-patient-packet`] Build **`src/tools/clinical-patient-packet.ts`**~~ **DONE** — `clinical_generate_patient_packet` uses Workers AI via the Worker `AI` binding, returns packet markdown + structured content, and avoids external LLM provider keys.
- [x] ~~**05:30** [`S-tool2-patient-packet`] Reading-level metrics inline~~ **DONE** — `src/tools/readability.ts` reports Flesch-Kincaid and INFLESZ; unit tests cover English and Spanish targets.
- [x] ~~**06:00** [`S-tool2-patient-packet`] Citation-grounding validator~~ **DONE** — validator checks allowed citations, unsupported quoted phrases, and unknown dose strings; tests cover passing packet generation and tampered rejection.
- [x] ~~**06:30** [`S-tool3-care-team-closure`] Build **`src/tools/clinical-care-team-closure.ts`**~~ **DONE** — emits 3 `Task` + 1 `CommunicationRequest` + 1 `DocumentReference` from visit context; R4-validates via FHIR `$validate`; `WRITE_BACK=1` is required for caller-requested PUT write-back and defaults off. Registered tool: `clinical_prepare_care_team_closure`.
- [x] ~~**07:30** [`S-tool3-care-team-closure`] Vitest unit tests for tool 3~~ **DONE** — validates JSON shape, statuses, `intent`, `for.reference` chaining, local HAPI validation, and missing-SHARP-header handling.
- [x] ~~**07:45** [judge] Merge S-tool2 + S-tool3; run typecheck + lint + tests; tag `d5-tools-green`~~ **DONE** — three native Featherless visit-workflow tools are registered, locally green, and validated against the hero HAPI path.

### Block 3 · Evening (4h) — orchestrator + e2e + PO publish + README

**Scopes:** `S-orchestrator` · `S-po-publish-and-readme`

- [x] ~~**08:00** [`S-orchestrator`] Scaffold `orchestrator/`~~ **DONE** — separate `wrangler-orchestrator.jsonc`, native Worker `orchestrator/src/index.ts`, public AgentCard route, and JSON-RPC `message/send` dispatcher. No `@a2a-js/sdk`, Express, Hono, or extra router dependency.
- [x] ~~**09:00** [`S-orchestrator`] SHARP header forwarding test~~ **DONE** — Vitest asserts A2A FHIR metadata becomes `X-FHIR-Server-URL`, `X-FHIR-Access-Token`, and `X-Patient-ID` on outgoing MCP calls; response payloads never return the token; AgentCard fields match the local Prompt Opinion SDK reference.
- [x] ~~**09:30** [judge] orchestrator trace test~~ **DONE** — mocked MCP e2e-style test proves the three-tool sequence (`clinical_pack_visit_context` → `clinical_generate_patient_packet` → `clinical_prepare_care_team_closure`) and non-zero trace timings. Substrate HAPI path remains covered by `npm test`; deployed PO registration remains in the D6 gate.
- [x] ~~**10:00** [`S-po-publish-and-readme`] Migrate docs into this folder~~ **DONE** — `HERO_PATIENT.md`, `CITATIONS.md`, `DECISIONS.md`, `BACKLOG.md`, and `LICENSE` now live in `featherless/` and reflect the current TypeScript / Workers AI architecture.
- [x] ~~**10:15** [`S-po-publish-and-readme`] Write `docs/po-registration.md`~~ **DONE** — judge-facing steps cover the MCP URL, A2A AgentCard URL, FHIR context extension, expected tools, screenshots, and troubleshooting.
- [x] ~~**10:30** [`S-po-publish-and-readme`] README skeleton at 80%~~ **DONE** — README has the hackathon table, sourced stats, tools table, orchestrator section, hero patient, AI Factor, architecture, 5Ts, standards, timeline, MIT license, and authors. No `marketplace.yaml`.
- [x] ~~**10:45** [`S-po-publish-and-readme`] Prompt Opinion publish-readiness findings~~ **DONE** — `docs/publish-readiness.md` records official Stage One/video/Marketplace requirements, fixed deploy blockers, remaining human/platform gates, and exact Devpost inputs.
- [x] **11:30** **Submit Devpost as draft tonight** — intentionally skipped; D6 closeout now owns Devpost finalization with Marketplace URL + real video.
- [x] **11:45** `git tag d5-eod-green` — intentionally skipped as non-blocking provenance; do not spend submission time on this unless the final package is already done.

### D5 EOD recap

- [x] Three Featherless visit-workflow tools work independently against the loaded hero patient
- [x] Orchestrator contract test runs end-to-end with full trace
- [x] Both URLs (featherless `/mcp`, orchestrator `/.well-known/agent-card.json`) register cleanly in Prompt Opinion — Cloudflare auth/deploy blocker resolved; MCP server, external A2A agent, and BYO consult path are registered.
- [x] Devpost draft submitted — intentionally skipped; final Devpost is now a D6 closeout task.
- [x] README at 80%

Historic insurance rule: if this had stayed red on D5 night, record a rough-cut video. On D6, do not spend time on a rough cut unless the Marketplace path hard-blocks.

---

## 🗓️ D6 — Mon May 11 (submission day)

**Theme:** Record. Polish. Submit by 18:00. No new code after 14:00.

### Current D6 status snapshot

- [x] Cloudflare account authenticated: `Inf3ctious007@gmail.com's Account` (`2a6a96ae8f3d1a965febebb24df965f4`).
- [x] MCP Worker deployed and public: `https://featherless-mcp.inf3ctious007.workers.dev/mcp`.
- [x] Orchestrator Worker deployed and public: `https://featherless-orchestrator.inf3ctious007.workers.dev/.well-known/agent-card.json`.
- [x] Orchestrator uses Cloudflare service binding `FEATHERLESS_MCP -> featherless-mcp` instead of a public URL or loopback default.
- [x] Prompt Opinion MCP server registered and published with `No Authentication (Open)`, Streamable HTTP, FHIR context extension, and selective patient scopes: `https://app.promptopinion.ai/marketplace/mcp/019e12cd-76bd-708f-b230-e48da20ad8bc`.
- [x] Prompt Opinion external A2A agent registered and published from the AgentCard URL; FHIR context extension visible: `https://app.promptopinion.ai/marketplace/agent/019e12e2-d251-7de3-bf49-16376ff51e73`.
- [x] Prompt Opinion BYO agent published and configured enough to consult the external `Featherless` agent.
- [x] Live Prompt Opinion synthetic-patient invocation is green enough to move from engineering to submission.
- [x] Agent Zero MCP-UI bonus path is green with rich synthetic patient `featherless-showcase-carter-elena` on public HAPI; live MCP dashboard proof returns 3 allergies, 12 medications, 9 problems, 40 labs, 10 encounters, and 3 alerts. See [`docs/demo-video-track.md`](docs/demo-video-track.md).
- [x] Encounter-noise regression fixed in code and deployed: explicit older encounter IDs and fallback encounters are honored.
- [x] Production patient packet model is Workers AI `@cf/openai/gpt-oss-120b`; patient-facing output is clamped to grade 6.
- [x] Latest local test suite reported 56/56 passing after commit `52c95cf`.
- [x] Final clean Prompt Opinion proof run after the latest deploy, with Show Tool Calls ON and a fresh chat.
- [ ] Proof screenshots saved under `docs/sharp-proof/`.
- [x] Prompt Opinion Marketplace listings published and Marketplace URLs copied for MCP + External A2A Agent; BYO Agent also published.
- [ ] Demo video recorded, uploaded public/unlisted, and tested cold.
- [ ] Devpost submitted with Marketplace URL, video URL, repo URL, and synthetic/no-PHI posture.

### Block 1 · Morning (4h) — deploy, publish, record

- [x] **00:00** Authenticate Cloudflare (`npx wrangler login` or API token) and confirm `npx wrangler whoami` against `Inf3ctious007@gmail.com's Account` (`2a6a96ae8f3d1a965febebb24df965f4`).
- [x] **00:15** Deploy the MCP Worker (`npm run deploy`). Confirm `https://featherless-mcp.inf3ctious007.workers.dev/mcp` is public and Workers AI is bound.
- [x] **00:30** Deploy the orchestrator Worker (`npm run deploy:orchestrator`). Confirm `https://featherless-orchestrator.inf3ctious007.workers.dev/.well-known/agent-card.json` is public and the `FEATHERLESS_MCP -> featherless-mcp` service binding reaches the MCP Worker.
- [x] **00:40** Configure Prompt Opinion MCP server: endpoint `https://featherless-mcp.inf3ctious007.workers.dev/mcp`, `Streamable HTTP`, `No Authentication (Open)`, Prompt Opinion FHIR extension enabled, `Selective Permissions`.
  - Active scopes: `patient/Patient.rs`, `patient/AllergyIntolerance.rs`, `patient/Appointment.rs`, `patient/Condition.rs`, `patient/Coverage.rs`, `patient/DiagnosticReport.rs`, `patient/DocumentReference.rs`, `patient/Encounter.rs`, `patient/Immunization.rs`, `patient/MedicationRequest.rs`, `patient/MedicationStatement.rs`, `patient/Observation.rs`, `patient/Procedure.rs`, `patient/ServiceRequest.rs`.
- [x] **00:45** Make a synthetic FHIR context reachable from deployed Workers — Prompt Opinion synthetic-patient context is the active demo path; local HAPI remains test-only.
- [x] **01:00** Register the A2A external agent in PO per `docs/po-registration.md`. AgentCard URL is `https://featherless-orchestrator.inf3ctious007.workers.dev/.well-known/agent-card.json`; FHIR context extension is visible. Still capture the workspace listing screenshot to `docs/sharp-proof/02-po-listing.png`.
- [ ] **01:20** Run one final clean end-to-end Prompt Opinion proof after the latest deploy. Start a fresh chat, turn Show Tool Calls ON, select FHIR Context -> A2A -> external `Featherless`, and prompt: `Create a Featherless after-visit packet for this patient, with citations and safety/readability details.`
  - Must show no `no_encounter_found` noise for valid explicit/fallback encounter behavior.
  - Must show grade-6-or-below readability policy and citation-grounded packet output.
  - Screenshot redacted SHARP/FHIR context evidence to `docs/sharp-proof/01-network-tab.png`.
  - Screenshot MCP/A2A trace/tool calls to `docs/sharp-proof/03-trace.png`.
- [x] **01:40** Publish the configured project surfaces to the Prompt Opinion Marketplace and copy the Marketplace URLs.
  - MCP Marketplace URL: `https://app.promptopinion.ai/marketplace/mcp/019e12cd-76bd-708f-b230-e48da20ad8bc`
  - External A2A Agent Marketplace URL: `https://app.promptopinion.ai/marketplace/agent/019e12e2-d251-7de3-bf49-16376ff51e73`
  - BYO Agent is also published; add its Marketplace URL here if it becomes the primary Devpost URL.
- [ ] **02:00** Record final 2:45–2:55 video to the hackathon beat list. Two takes max. Pick the better one.
  - 0:00–0:15 patient hook (Mrs. García leaving the cardiologist)
  - 0:15–0:35 three statistics on screen, sourced from CITATIONS
  - 0:35–1:30 PO platform run — agent handshake, A2A trace pane, tools fire
  - 1:30–2:15 the artifact: Spanish, grade-6, furosemide PRN flagged, FK + INFLESZ scores visible, FHIR Tasks, citations
  - 2:15–2:35 standards proof: SHARP headers in network tab · PO workspace listing (MCP servers + External Agents) · multi-agent trace
  - 2:35–2:50 close card: authors (Chadwick, Alessandro Frau) + GitHub URL + PO registration URLs
- [ ] **03:00** Upload to YouTube *unlisted*. Test the link in an incognito window.
- [ ] **03:30** Record judge walkthrough Loom, 5–7 min: SHARP middleware, A2A trace, tool surfaces, citation pack, productization.

### Proof artifacts to capture

- [ ] `docs/sharp-proof/01-network-tab.png` — redacted Prompt Opinion FHIR context / SHARP header proof for deployed tool calls.
- [ ] `docs/sharp-proof/02-po-listing.png` — Prompt Opinion MCP server + External Agents registration/listing.
- [ ] `docs/sharp-proof/03-trace.png` — final Prompt Opinion tool-call/A2A trace with three MCP hops.
- [ ] `docs/sharp-proof/04-final-packet.png` — final Spanish/plain-language packet with readability and citations visible.
- [ ] `docs/sharp-proof/05-marketplace.png` — published Marketplace listings for BYO Agent, External A2A Agent, and MCP server.
- [ ] `docs/sharp-proof/06-agent-zero-mcp-ui.png` — optional bonus screenshot of Agent Zero rendering the MCP-UI iframe for `featherless-showcase-carter-elena`.

### Block 2 · Lunch (1h) — outsider tests

- [ ] **04:00** **Cold-watch test:** one non-team person watches the 3-min video with no context. If they can't say what it does by 0:30, re-edit the hook only.
- [ ] **04:30** **Judge-walk test:** different non-team person opens Devpost → README → `docs/po-registration.md` → registers both URLs in their own PO workspace → invokes the agent. Time it.

### Block 3 · Afternoon (3h) — finalize + submit

- [ ] **05:00** Fix exactly **one** thing from each test. Resist the urge to fix more.
- [ ] **05:30** README at 100%. Both video links embedded. License + citations + decisions + backlog all in place at repo root.
- [ ] **06:00** Update Devpost with real video link. Re-read submission once. Check video plays from cold link.
- [ ] **06:30** **Submit final.** Do not wait until 2026-05-12 02:55 UTC. Submit by 2026-05-11 18:00 Europe/Rome.
- [ ] **07:00** Post-submit: tweet, share to PO community, send to the named hackathon contacts.

### D6 EOD gate

- [ ] Submitted, confirmed in Devpost
- [ ] Video plays from cold link in incognito
- [x] Both URLs invokable in a judge's own PO workspace per `docs/po-registration.md`
- [x] Proof artifacts captured or intentionally excluded from git with rationale

---

## 🛡️ Standing rules (apply to every minute of D5 + D6)

- [x] **Three Featherless visit-workflow tools max.** New ideas → `BACKLOG.md`.
- [x] **Citation-or-cut.** Any clinical claim, anywhere, must trace to `CITATIONS.md`. No grounding → cut.
- [x] **No token storage, ever.** Both Workers log per-request; persist nothing. Verify by reading the source before deploy.
- [x] **Synthetic data only.** Local HAPI + hand-crafted bundle. If HAPI is exposed for judging, it must contain only the synthetic bundle and must be temporary or access-controlled.
- [x] **Human-in-the-loop on send.** `CommunicationRequest.status = "draft"` with `intent = "proposal"`, never `"active"`.
- [x] **Build like deadline is D6 14:00.** The 4 hours after that are submission, not building.
- [x] **No new dependencies after D5 EOD.** Period.

---

## 🚨 Fallback ladder (if D5 slips)

Only one of these can be true. Pick the lowest-risk path that's still green at the time of decision.

- **If by D5 18:00 local** the orchestrator isn't routing SHARP headers correctly → collapse to single-Worker `/orchestrate` route in featherless. Update PLAN §3 + S3 sentence. Lose ~10% of Tripathi's claim, gain 4h.
- **If by D5 22:00 local** Workers AI output is flaky → switch to template-first Spanish packet generation with Workers AI only for final wording polish; English becomes the control path. Document any limitation in BACKLOG.
- **If by D5 EOD** any of {patient packet generates, hero bundle loads, both URLs register in PO} is red → ship the *substrate* + a single demo tool + a manual demo script. Reframe as "Featherless v0.1 — substrate shipped, visit workflow partial, orchestrator in BACKLOG." This is the worst-case but still a real submission.
- **Never** attempt a fourth tool, a second hero patient, or a v2 architecture after D5 12:00. Ship what works.

---

## 💡 Pinned reminder

> The delta is the README, the PO workspace listing (judge can paste two URLs and it works), and the video.
> **Spend D6 morning on those, not on code.**
