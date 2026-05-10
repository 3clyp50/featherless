# S-po-manifest-spike

> Pre-seeded; this is the first scope to run on D5 and it gates PLAN §3.

## Contract (do not modify)

- **Writable:** `agents/S-po-manifest-spike/DECISION.md` only — no code, no marketplace.yaml edits, no PLAN.md edits.
- **Read-only context:**
  - legacy `marketplace.yaml` hypothesis manifest from the archived prototype
  - `prompt-opinion/po-community-mcp` reference repo (clone to `/tmp/`)
  - `prompt-opinion/po-adk-typescript` reference repo (clone to `/tmp/`)
  - https://docs.promptopinion.ai/
  - One published Marketplace bundle with public source (e.g. PolyPharmGuard on GitHub)
- **Acceptance:** `DECISION.md` answers three questions, in this order:
  1. Does PO accept `kind: Agent` with an external HTTP endpoint (Cloudflare Workers URL)?
  2. If yes, what is the exact manifest shape — keys, required fields, agent-endpoint declaration?
  3. Which path should `PLAN.md` §3 take: two-Worker A2A (preferred) or single-Worker `/orchestrate` fallback?
- **Source of truth:** `../../PLAN.md` §11, `../../TODO.md` D5 Block 1 entry **00:00**, the verification recipe in the user's D5 brief.
- **Time-box:** 60 minutes. At 60 min, write DECISION.md with whatever you have. Ambiguity → recommend the conservative single-Worker fallback.

## Mirrored tasks

- [ ] **00:00** Re-read the legacy `marketplace.yaml` hypothesis manifest and the inline "Re-validate against PO docs on D4 before final publish" comment. Capture the *hypothesis* shape it proposes.
- [ ] **00:05** Clone `prompt-opinion/po-community-mcp` to `/tmp/`. Run `find /tmp/po-community-mcp -name 'marketplace.yaml' -o -name 'po.yaml' -o -name '*.manifest.yaml'`. Read every example.
- [ ] **00:20** Clone `prompt-opinion/po-adk-typescript` to `/tmp/`. Search for `defineAgent`, `Agent`, `manifest`, `publish`, `endpoint`. Answer: must agents live in this SDK, or can they be external?
- [ ] **00:30** Read https://docs.promptopinion.ai/ — Marketplace, Agent, Publishing, External endpoint sections.
- [ ] **00:40** `po --version`. If installed: `po marketplace --help`, `po marketplace validate marketplace.yaml`, `po schemas dump` if available. If not installed: skip; do not `npm i -g`.
- [ ] **00:45** Find one already-published bundle on GitHub (PolyPharmGuard is named in `../../../AGENT4-SHARP.md`). Read its `marketplace.yaml`. Known-good is the gold standard.
- [ ] **00:55** Only if 1–6 left it ambiguous: post a single 3-line question in PO Discord. Move on regardless.
- [ ] **01:00** Write `DECISION.md`. Three questions, three answers (or three "unresolved → take fallback").

## Decisions log

- `2026-05-10 00:00` · scope opened · time-boxed 60 min per user brief; ambiguity defaults to conservative single-Worker fallback.

## Open contract questions

- *(none yet — this scope's job is to close them)*

## Output

- **Files:** `agents/S-po-manifest-spike/DECISION.md`
- **Summary:** *(fill at end)*
- **Open questions:** *(fill at end; should be empty if the spike succeeded)*
