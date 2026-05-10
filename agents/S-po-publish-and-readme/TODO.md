# S-po-publish-and-readme

> Created 2026-05-10 (D5) per `featherless/PLAN.md` §11 row and TODO.md Block 3 entries 10:00 / 10:15 / 10:30.

## Contract (do not modify)

- **Writable:**
  - `README.md`
  - `LICENSE`
  - `HERO_PATIENT.md`
  - `CITATIONS.md`
  - `DECISIONS.md`
  - `BACKLOG.md`
  - `docs/po-registration.md`
  - `docs/sharp-proof/README.md`
  - `PLAN.md`, `TODO.md` — path/status updates only.
- **Read-only context:**
  - `agents/S-po-manifest-spike/DECISION.md`
  - `orchestrator/src/index.ts`
  - `src/server.ts`
  - Parent-folder historical docs — already migrated into this package.
- **Acceptance:** docs live inside `featherless/`, README has the hackathon-critical sections, `docs/po-registration.md` gives judge-facing MCP + A2A registration steps, LICENSE is MIT, authors are Chadwick first and Alessandro Frau second, and no legacy product namespace remains.
- **Source of truth:** `../../PLAN.md` §4 / §8 / §11, `../../TODO.md` Block 3 entries 10:00 / 10:15 / 10:30.

## Mirrored tasks

- [x] ~~**10:00** Migrate docs into this folder~~ **DONE** — `HERO_PATIENT.md`, `CITATIONS.md`, `DECISIONS.md`, `BACKLOG.md`, and `LICENSE` now reflect the current Featherless TypeScript / Workers AI architecture.
- [x] ~~**10:15** Write `docs/po-registration.md`~~ **DONE** — includes judge-facing steps for the Featherless MCP URL, orchestrator AgentCard URL, FHIR context extension, expected tool list, screenshot slots, and troubleshooting.
- [x] ~~**10:30** README skeleton at 80%~~ **DONE** — includes hackathon table, sourced stats, tools table, orchestrator section, hero patient, AI Factor, architecture, cost stack, 5Ts, standards, timeline, MIT license, and authors.

## Decisions log

- `2026-05-10` · **Featherless-only surface**: migrated docs must use Featherless naming throughout and avoid the archived project namespace.
- `2026-05-10` · **No marketplace manifest**: registration docs follow the PO spike result — MCP URL plus A2A AgentCard URL, no `marketplace.yaml`.

## Open contract questions

- Marketplace publication itself still requires deployed public URLs and a Prompt Opinion workspace action.

## Output

- **Files:** `README.md`, `LICENSE`, `HERO_PATIENT.md`, `CITATIONS.md`, `DECISIONS.md`, `BACKLOG.md`, `docs/po-registration.md`, `docs/sharp-proof/README.md`, `PLAN.md`, `TODO.md`.
- **Summary:** Migrated the submission docs into `featherless/`, removed legacy product naming, updated architecture and decisions to the current TypeScript / Workers AI / A2A shape, and added Prompt Opinion registration instructions.
- **Open questions:** deployed Prompt Opinion registration and Marketplace publication remain human/platform actions after public Worker URLs exist.
