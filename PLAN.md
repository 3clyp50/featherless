# PLAN.md — Featherless (Native Visit Workflow)

**Project:** **Featherless** — TypeScript Cloudflare-Workers MCP/A2A substrate for SHARP-on-FHIR. The hackathon submission ships the substrate plus a native Featherless visit workflow as the flagship demo (3 MCP tools + 1 A2A orchestrator).
**Repo:** https://github.com/TerminallyLazy/featherless
**Authors (in submission order):** Chadwick (first), Alessandro Frau (second).
**Hackathon:** Agents Assemble — The Healthcare AI Endgame.
**Internal deadline:** Mon **2026-05-11, 18:00 Europe/Rome** (Devpost cutoff Tue 03:00 UTC; we land 5+ hours early).
**Authoritative specs (do not re-derive):** `../HERO_PATIENT.md`, `../CITATIONS.md`, `../DECISIONS.md`, `../AGENT3-SHARP.md`, `../AGENT4-SHARP.md`.
**Operating rule (unchanged):** every task must score on at least one of {AI Factor, Potential Impact, Feasibility}. If it doesn't, cut it.

---

## 1. The decision

We ship **Option B**: the visit workflow is rebuilt natively in TypeScript on top of the `featherless` substrate. The old Python prototype is archived; nothing from it gets deployed. Everything in `../HERO_PATIENT.md`, `../CITATIONS.md`, `../DECISIONS.md` is **migrated, not re-decided** — those documents are the spec, not the implementation.

This is a stretch on the timeline. The plan in §6 is the only way it lands.

## 2. Why Option B, not A or C

| Option | What | Why we ruled it out |
|---|---|---|
| A · Bridge | Old Python prototype calls featherless as backend | Two stacks to demo, two deploys to publish, weakens "TypeScript edge" story |
| **B · Native TS rebuild** | **3 Featherless tools + orchestrator natively on featherless** | **Single coherent stack, every judge sentence intact, edge-deployed becomes a *feature* in the video** |
| C · Reframe to substrate only | Drop the visit workflow, ship substrate | Throws away Mrs. Garcia, Spanish, grade-6 — kills Hickey + Mathur + Zheng sentences and the visceral hook |

## 3. Architecture

> **Update 2026-05-10 (post-spike):** PO does not consume a `marketplace.yaml`. The featherless Worker is registered via `Configuration → MCP Servers` (PO sends `initialize`, reads the `ai.promptopinion/fhir-context` extension). The orchestrator Worker is registered via `Agents → External Agents` (PO fetches the agent card at `/.well-known/agent-card.json`). See [`agents/S-po-manifest-spike/DECISION.md`](agents/S-po-manifest-spike/DECISION.md).

```
                     ┌──────────────────────────────────────────┐
                     │          Prompt Opinion Workspace         │
                     └────┬───────────────────────────┬─────────┘
              consult external A2A agent      add MCP server
                          │                           │
                          │ paste agent-card URL      │ paste MCP URL → PO sends `initialize`
                          ▼                           │
   ┌──────────────────────────────────────┐           │
   │  Featherless Orchestrator (Hono)       │          │
   │  GET  /.well-known/agent-card.json    │          │
   │  POST /  (A2A JSON-RPC, message/send) │          │
   │                                       │          │
   │  hand-rolled A2A surface              │          │
   │  (Express-based @a2a-js/sdk does not  │          │
   │  run on Workers — see §9 risk #1')    │          │
   │                                       │          │
   │  trace = [                            │          │
   │    clinical_pack_visit_context → ms   │          │
   │    clinical_generate_patient_packet → ms          │
   │    clinical_prepare_care_team_closure → ms ]      │
   └─────────────┬─────────────────────────┘          │
                 │ MCP-over-HTTP (JSON-RPC)           │
                 │ forwards SHARP headers verbatim    │
                 │ (translates A2A `metadata.fhir-context`
                 │  → `X-FHIR-*` headers per PO docs)
                 ▼                                    ▼
   ┌─────────────────────────────────────────────────────────────┐
   │               featherless MCP server (this repo)             │
   │               Cloudflare Worker · /mcp                       │
   │                                                              │
   │  src/tools/    (substrate — already exists)                  │
   │   ├─ fhir.ts             generic R4 search/read              │
   │   ├─ clinical.ts         Patient/Encounter/Allergy/Med/Cond  │
   │   ├─ lab-imaging.ts      Observation/DiagnosticReport/DocRef │
   │   ├─ clinical-context.ts aggregated context + alerts         │
   │   ├─ memory.ts           Vectorize + Workers AI + D1         │
   │   └─ visualization.ts    MCP-UI Chart.js dashboards          │
   │                                                              │
   │  src/tools/    (native Featherless tool modules)             │
   │   ├─ clinical-visit-context.ts                               │
   │   ├─ clinical-patient-packet.ts                              │
   │   └─ clinical-care-team-closure.ts                           │
   └─────────────────────────────────────────────────────────────┘
                 │
                 │ SHARP headers per request, zero token storage
                 ▼
   ┌─────────────────────────────────────────────────────────────┐
   │            Local HAPI Docker  ·  Mrs. María Garcia           │
   │            http://localhost:8080/fhir                        │
   └─────────────────────────────────────────────────────────────┘
```

**Why this shape:**

- **Two visible deployables** (substrate + orchestrator) → Tripathi's "true multi-agent flow, visible tool boundaries, explicit A2A orchestration."
- **Three published MCP tools** under the native `src/tools/` layout → Proctor's "each capability is a reusable MCP superpower" *and* the `featherless/clinical-context` tools remain composable for other orgs.
- **Orchestrator forwards SHARP headers verbatim, persists nothing** → Mandel's "never stores credentials."
- **Local HAPI, hand-crafted hero bundle** → no real-PHI risk, no public-sandbox flakiness on demo day.

## 4. The four PO registrations

| Registration | Type | PO surface to add it on | Source | Description (clinician language) |
|---|---|---|---|---|
| `clinical_pack_visit_context` | MCP tool (on featherless) | `Configuration → MCP Servers` (single registration covers all three tools) | `src/tools/clinical-visit-context.ts` | Reads encounter, note, active orders, med changes, recent labs through SHARP-on-MCP; returns a typed visit-context payload for downstream patient-education or coding agents. |
| `clinical_generate_patient_packet` | MCP tool (on featherless) | same MCP registration | `src/tools/clinical-patient-packet.ts` | Generates a plain-language, multilingual, reading-level-adjusted visit packet from a typed visit-context. Grounds only in the structured chart and an explicit citation allow-list. Reports Flesch-Kincaid (English) and INFLESZ (Spanish). |
| `clinical_prepare_care_team_closure` | MCP tool (on featherless) | same MCP registration | `src/tools/clinical-care-team-closure.ts` | Emits standards-correct FHIR R4 closure resources: `Task` for follow-up scheduling, `CommunicationRequest` (status `proposed`) for patient send, `DocumentReference` for the patient packet itself. |
| `featherless` | External A2A Agent | `Agents → External Agents` (paste agent-card URL) | `orchestrator/` (separate Worker) | Composition layer that runs the three MCP tools in sequence with an explicit A2A trace. Declares the FHIR-context A2A extension; receives `{ fhirUrl, fhirToken, patientId }` from PO via message metadata. |

## 5. Tech choices (locked)

| Question | Choice | Why |
|---|---|---|
| LLM for patient packet | **Cloudflare Workers AI** through the existing `AI` binding, with `LLM_MODEL` selecting the model | Keeps patient context inside the Cloudflare Worker boundary, avoids third-party LLM API keys, and strengthens the healthcare safety story. |
| FHIR write-back posture | **Emit resources as JSON; do NOT POST by default**; `WRITE_BACK=1` env flag enables PUT to HAPI | HAPI public sandbox is read-only/flaky; local HAPI Docker is fine but risky to demo over network. The point is the *resources are correct*, not that they ship. |
| Reading-level metrics | Implement Flesch-Kincaid (English) + INFLESZ / Szigriszt-Pazos (Spanish) inline (~60 LOC total) | No reliable npm dep on Workers; hand-roll is shorter than picking and patching one. |
| Hero patient | **Hand-crafted FHIR bundle for María Garcia**, posted to local HAPI Docker once | Synthea is overkill; hand-crafting matches `../HERO_PATIENT.md` §1–§5 verbatim. |
| Citation grounding | System prompt includes the citation allow-list; post-generation validator rejects any direct quote not present in the allow-list or the chart | Defends Mathur's sentence: every claim traces to chart or `CITATIONS.md`. |
| Orchestrator deploy | **Same repo, separate `orchestrator/` directory, separate `wrangler-orchestrator.jsonc`, separate Worker** | Real two-deployable A2A flow without a second repo. |
| Tests | vitest unit (each Featherless visit-workflow tool) + one e2e against local HAPI + hero patient | Stops at "the demo is reproducible," not "100% coverage." |

## 6. The six judge sentences — re-mapped to TS architecture

Migrated verbatim where possible from `../DECISIONS.md` D-002. Any change is annotated.

- **S1 · Mandel (standards):** "Featherless never stores credentials. SHARP context flows from the Prompt Opinion host through the orchestrator straight into our MCP server, the FHIR graph is read with standards-correct intents, and the workflow writes back as ordinary FHIR `DocumentReference`, `CommunicationRequest`, and `Task` resources." *[Featherless's strict-mode + JWT-fallback context layer makes this stronger than the Python version.]*
- **S2 · Hickey (workflow):** "Launched from the clinician workspace, reviewed before send, returns a patient-ready packet plus actionable team tasks." *[Unchanged.]*
- **S3 · Tripathi (engineering):** "True multi-agent flow — the orchestrator and the MCP server are separately deployable Cloudflare Workers; tool boundaries are visible in the trace pane; full timings on every hop." *[Strengthened: separate Worker is a stronger A2A claim than in-process.]*
- **S4 · Mathur (clinical safety):** "Every patient-facing claim is grounded in the chart or in the citation pack. The packet generator receives a typed `medication_changes` array and references doses by index, never by re-generation. No autonomous diagnosis, no prescribing." *[Unchanged.]*
- **S5 · Proctor (composability):** "Each Featherless capability is a reusable MCP superpower. Other orgs can pluck `clinical_pack_visit_context` for a coding workflow, `clinical_generate_patient_packet` for ED discharge, or `clinical_prepare_care_team_closure` for transitions-of-care — independent of the orchestrator. The featherless substrate underneath them ships separately for any FHIR + SHARP project." *[Strengthened: substrate is now a literal published artifact.]*
- **S6 · Zheng (market):** "Buyer is the health system; wedge is post-visit confusion + leakage; KPIs are failed follow-ups, readmission risk, avoidable portal-message burden." *[Unchanged.]*

## 7. What we cut (write to BACKLOG.md, never the build)

- ✗ Cross-session clinical memory (featherless `memory.ts` ships, but the orchestrator does not call it on D5).
- ✗ Synthea-generated hero patient — hand-crafted bundle is faster.
- ✗ Live FHIR write-back to a real EHR — `WRITE_BACK=1` flag exists but defaults off.
- ✗ Multilingual matrix — ship Spanish + English only. Add to BACKLOG.
- ✗ Cold-machine clone test (TODO D4 EOD gate) — replace with one-command local Docker spin-up.
- ✗ Second hero patient — D5 plan only had it "if there's slack." There won't be.
- ✗ po-adk-typescript-hosted agent — orchestrator is a Cloudflare Worker, registered in PO's "External Agents" surface via its `/.well-known/agent-card.json` URL. The reference SDK uses Express + `@a2a-js/sdk` (Node-only); we hand-roll the protocol on Hono instead. **Spike-resolved 2026-05-10**: see [`agents/S-po-manifest-spike/DECISION.md`](agents/S-po-manifest-spike/DECISION.md). No `marketplace.yaml` is in the registration path.

## 8. Definition of done (the only checklist that matters at submit)

- [ ] `pnpm typecheck && pnpm lint && pnpm test` all green.
- [ ] `pnpm e2e` runs end-to-end on Mrs. García in local HAPI Docker, producing: (a) typed visit context, (b) Spanish grade-6 patient packet with FK + INFLESZ scores reported, (c) 3 `Task` + 1 `CommunicationRequest` + 1 `DocumentReference` validating against R4 schemas.
- [ ] Both Workers deployed: featherless + orchestrator. Health checks return ok from public URLs.
- [ ] **PO workspace registration proven**: in a fresh PO workspace, featherless URL added under `Configuration → MCP Servers` (PO reads the `ai.promptopinion/fhir-context` extension from `initialize`); orchestrator agent-card URL added under `Agents → External Agents`. Both visible in launchpad, both invokable via "Consult with another agent".
- [ ] `docs/sharp-proof/` contains 3 screenshots: SHARP headers in browser dev-tools network tab on a real `tools/call`; the orchestrator trace pane; the PO workspace listing showing both registrations.
- [ ] README at 100% per AGENT4 §5.2 (14 sections).
- [ ] `HERO_PATIENT.md`, `CITATIONS.md`, `DECISIONS.md`, `BACKLOG.md`, `LICENSE` (MIT) at repo root.
- [ ] Final video uploaded to YouTube unlisted, 2:45–2:55, hits AGENT4 §5.4 beat list.
- [ ] Judge walkthrough Loom, 5–7 min, public link tested cold.
- [ ] Devpost final-submitted before 18:00 Europe/Rome with both video links.

## 9. Risks (named, mitigated)

1. ~~**PO Agent registration shape unknown for an external Worker.**~~ **Resolved 2026-05-10** — PO accepts external A2A agents via agent-card URL, MCP servers via URL + `initialize` extension. No PO-proprietary manifest. See [`agents/S-po-manifest-spike/DECISION.md`](agents/S-po-manifest-spike/DECISION.md).

   **1' (replacement risk) · A2A protocol surface must be hand-rolled on Workers.** The reference `po-adk-typescript` SDK uses Express + `@a2a-js/sdk`, neither of which runs on Cloudflare Workers. *Mitigation:* implement the minimum A2A surface directly on Hono — `GET /.well-known/agent-card.json` (static JSON) and `POST /` with a JSON-RPC dispatcher for one method (`message/send`). Estimated ~150 LOC. If spec compliance fails the PO add-agent flow, fall back to deploying the reference SDK on Cloud Run as a third deployable and proxy from the Worker (loses the all-edge claim; preserves the A2A claim).
2. **LLM execution boundary.** *Mitigation:* patient packet generation uses Workers AI through the Worker `AI` binding, not third-party LLM API calls. No external LLM key is stored, logged, or returned.
3. **Local HAPI Docker on demo day.** *Mitigation:* record video against a *known-good* local instance with the bundle pre-loaded; bundle ships in `scripts/hero-bundle.json` so any judge can reload deterministically.
4. **Citation grounding hallucination.** *Mitigation:* post-generation validator that rejects any phrase ≥6 words not appearing in either the chart or `CITATIONS.md`. Reject → regenerate once → fail loudly.
5. **Reading-level miss (FK > 7 or INFLESZ < 65).** *Mitigation:* generator regenerates with stricter system-prompt constraints up to 2 retries, then fails loudly. The metric is reported in the output regardless.
6. **D5 video slippage.** *Mitigation:* if the orchestrator isn't done by D5 19:00 local, record video against a hand-stitched run (each tool called manually with curl, output assembled in the editor). Last-resort but ships.

## 10. The one slide explanation

> *"Featherless turns a finalized clinical visit into a Spanish, grade-6, citation-grounded patient packet and a closed-loop FHIR Task list — through three reusable MCP superpowers and a two-Worker A2A flow on Cloudflare's edge. SHARP headers in. Standards-correct FHIR out. Zero credential storage. Clinician approves before send."*

If a judge can't repeat that sentence after watching the video, the video is wrong, not the product.

## 11. Execution model — bounded subagents + judge

The work in §6 / TODO.md is decomposed into **scopes**. Each scope is delegated to one subagent. A separate **judge subagent** merges. No human-in-the-loop on the merge except for explicit reviewer notes.

### Why this shape

- The TS contract in §4–§5 is the *only* source of truth across scopes. Subagents drift if they aren't told what they cannot touch. The judge enforces that.
- Hackathon timeline does not allow a "rewrite this for me" round-trip. First-pass quality matters; the brief is the lever.
- Conversation context will compact. Anything that matters must be on disk.

### Scope boundaries (read-only vs. writable)

For every subagent brief:

- **Writable scope:** an explicit list of files the subagent may create or modify. Nothing else.
- **Read-only context:** the substrate files, the spec docs, the relevant PLAN sections. Never edited.
- **TS contract:** the zod schemas, function signatures, registration calls, and acceptance criteria the subagent must conform to.
- **Mirror TODO:** the subagent maintains `agents/<scope>/TODO.md` mirroring the relevant lines from `featherless/TODO.md`. Updates as it works. **This is mandatory** — survives compaction, exposes drift, gives the judge a checkable artifact.
- **Output contract:** what the subagent returns at the end (file list, decisions made, open contract questions). No prose victory laps.

### The scopes (one subagent per row)

| Scope | Writable | Read-only context | Acceptance |
|---|---|---|---|
| ~~`S-po-manifest-spike`~~ **RESOLVED 2026-05-10** | `agents/S-po-manifest-spike/DECISION.md` (written) | — | **Outcome:** PO accepts external A2A agents (agent-card URL) + MCP servers (URL + `initialize` extension). No `marketplace.yaml`. Two-Worker A2A confirmed; orchestrator must hand-roll A2A surface on Hono. |
| `S-hero-bundle` | `scripts/hero-bundle.json`, `scripts/load-hero.ts` | `../HERO_PATIENT.md` §1–§5, §7 | `clinical_get_context` against loaded bundle returns Mrs. García's 5 problems + 6 meds (1 new) |
| `S-tool1-visit-context-packer` | `src/tools/clinical-visit-context.ts`, `src/tools/schemas/visit-context.ts`, `test/tools/clinical-visit-context.test.ts` | `src/tools/clinical-context.ts`, `src/clients/fhir-client.ts`, `../HERO_PATIENT.md` §7 (canonical output) | unit test: output JSON matches the §7 canonical example for hero patient; `medication_changes[*].action="new"` for furosemide |
| `S-tool2-patient-packet` | `src/tools/clinical-patient-packet.ts`, `src/tools/schemas/patient-packet.ts`, `src/tools/readability.ts`, `src/tools/grounding-validator.ts`, `test/tools/clinical-patient-packet.test.ts`, `test/tools/readability.test.ts` | tool 1 output schema, `../CITATIONS.md` allow-list, `../HERO_PATIENT.md` §7 + §8 + §9 | unit test: Spanish output, FK + INFLESZ reported, grounding-validator passes for canonical case and rejects a tampered phrase |
| `S-tool3-care-team-closure` | `src/tools/clinical-care-team-closure.ts`, `src/tools/schemas/care-team-closure.ts`, `test/tools/clinical-care-team-closure.test.ts` | `src/clients/fhir-client.ts` (read-only), R4 spec for Task / CommunicationRequest / DocumentReference, `../HERO_PATIENT.md` §7 | unit test: 3 Task + 1 CommunicationRequest + 1 DocumentReference; all R4-validate via local HAPI `$validate`; `CommunicationRequest.status="proposed"` |
| `S-orchestrator` | `orchestrator/`, `wrangler-orchestrator.jsonc` | `src/index.ts` (header propagation pattern), `src/context.ts`, `../po-adk-typescript/shared/appFactory.ts` (reference AgentCard shape, lines 257-278; do not import — Workers can't run Express) | unit tests: (a) `GET /.well-known/agent-card.json` returns valid AgentCard with `preferredTransport: "JSONRPC"` + FHIR-context extension; (b) `POST /` JSON-RPC `message/send` accepts an A2A message, extracts `metadata["…/fhir-context"]`, translates → `X-FHIR-*` headers on outgoing MCP calls verbatim, never logged; (c) full trace returned with non-zero `ms` per hop. **Hand-roll on Hono — do not depend on `@a2a-js/sdk` or Express.** |
| `S-po-publish-and-readme` *(was `S-marketplace-and-readme`)* | `README.md`, `LICENSE`, `docs/po-registration.md` (new — step-by-step paste-the-URL guide for judges) | every other scope's output, `../AGENT4-SHARP.md` §5.2, `agents/S-po-manifest-spike/DECISION.md` | featherless URL + orchestrator agent-card URL both register cleanly in a fresh PO workspace; README has all 14 sections; LICENSE is MIT; **authors listed in this order: Chadwick (first), Alessandro Frau (second)**. No `marketplace.yaml` — that artifact was a pre-spike hypothesis that does not match PO's actual onboarding. |
| `S-judge-merge` | merge commits only | every scope's PR + every scope's mirror TODO + this PLAN | every scope's tests pass after merge; no scope edited a file outside its declared writable list; mirror TODOs match the global TODO at merge time |

### Judge subagent contract

The judge:

1. Receives a list of scope outputs (file lists + summaries).
2. Verifies, scope-by-scope: `git diff` touches only files in that scope's writable list. Anything else → reject the scope, send back with one-line reason.
3. Runs `pnpm typecheck && pnpm lint && pnpm test`. Any failure → reject the offending scope.
4. For each scope, opens `agents/<scope>/TODO.md` and confirms its checkmark state matches the actual code state. Mismatch → reject.
5. Runs `pnpm e2e` after the last merge. Failure → escalate to the human (you).
6. Outputs: one merged tree + one short reviewer note per scope (accepted / rejected-with-reason / accepted-with-fixups).

The judge **does not write feature code**. It enforces the contract. If a fix is needed, it sends the scope back to its subagent.

### Mirror-TODO format

Each `agents/<scope>/TODO.md` follows this shape:

```markdown
# <scope>

## Contract (do not modify)
- Writable: <list>
- Read-only: <list>
- Acceptance: <criteria>
- Source of truth: PLAN.md §11, featherless/TODO.md (relevant block)

## Mirrored tasks
- [ ] <copied verbatim from featherless/TODO.md>
- [ ] ...

## Decisions log
- <timestamp> · <decision> · <one-line rationale>

## Open contract questions
- <question> — block / non-block

## Output
- <files created/modified at the end>
```

Updates to featherless/TODO.md are the single source of truth. If the global TODO changes, every active scope re-syncs its mirror at the next save.

### What this buys us

- **Drift detection:** judge can mechanically diff scope diffs against writable lists.
- **Compaction survival:** mirror TODOs are on disk, not in any model's context. A re-spawned subagent reloads cold from its TODO + contract.
- **Provenance for judges (the human ones):** Tripathi's "true multi-agent flow" claim is also visible in the *repo itself* — `agents/` is an artifact of how this was built, not just deployed.
- **Authors stays two, in order:** `S-po-publish-and-readme` requires Chadwick (first) and Alessandro Frau (second) named in README, LICENSE, and Devpost. Non-negotiable.
