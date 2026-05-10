# `agents/` — multi-agent provenance

This directory exists for two reasons:

1. **Compaction survival.** Each subagent maintains its own scoped TODO + decisions log on disk so that if its conversation context is compacted, a re-spawned subagent reloads cold from the file and resumes without losing the fine details. Memory in the model is volatile; this directory is durable.

2. **Visible A2A.** A judge inspecting the repo can read `agents/<scope>/TODO.md` for every scope and see the work decomposition, the decisions made, and any open contract questions. Tripathi's "true multi-agent flow, visible tool boundaries" is also true in the *repo*, not only at runtime.

## Layout

```text
agents/
├── README.md                       (this file)
├── _TEMPLATE/
│   └── TODO.md                     (clone this when starting a new scope)
├── S-po-manifest-spike/
│   ├── TODO.md
│   └── DECISION.md                 (output of the spike)
├── S-hero-bundle/
│   └── TODO.md
├── S-tool1-visit-context-packer/
│   └── TODO.md
├── S-tool2-patient-packet/
│   └── TODO.md
├── S-tool3-care-team-closure/
│   └── TODO.md
├── S-orchestrator/
│   └── TODO.md
├── S-marketplace-and-readme/
│   └── TODO.md
└── S-judge-merge/
    └── TODO.md                     (merge log; one entry per accepted scope)
```

## Subagent procedure (terse)

1. `cp -r agents/_TEMPLATE agents/<your-scope>` (or your harness equivalent).
2. Open the row for your scope in `../PLAN.md` §11. Copy the `Writable`, `Read-only context`, and `Acceptance` cells into your `TODO.md` `## Contract` section, **verbatim**.
3. Copy every line in `../TODO.md` tagged with your scope into `## Mirrored tasks`, **verbatim**.
4. Work. Update statuses in your `TODO.md` *as you go*, not at the end. Log non-obvious decisions under `## Decisions log` with one-line rationale.
5. Touch only files in your `Writable` list. The judge subagent rejects scopes that drift.
6. Final message: `(a)` files created/modified, `(b)` one paragraph of decisions, `(c)` open contract questions tagged `block` / `non-block`. No "successfully completed" prose.

## Judge procedure (terse)

For each scope output:

1. `git diff <scope-branch>` — confirm only files in the scope's `Writable` list changed.
2. `npm run typecheck && npm run lint && npm test` — must be green.
3. Open `agents/<scope>/TODO.md` — confirm checkmarks match reality.
4. If all three pass: merge, append to `agents/S-judge-merge/TODO.md`.
5. If any fail: send back to the scope subagent with a one-line reason. The judge does not write feature code.

After the last scope merges: `npm run test:integration` against local HAPI + hero patient. Failure escalates to the human, not back to a subagent.
