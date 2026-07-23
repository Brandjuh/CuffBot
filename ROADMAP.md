# CuffBot — Roadmap

Milestones sized so one focused session can finish one (build + tests + manual + state). Sessions pick the first unchecked milestone unless `STATE.md`'s resume point or the owner says otherwise. Acceptance criteria are the contract — a milestone is done when every box checks, not when the code "looks done". Update this file when scope changes, and record why in `SESSION_LOG.md`.

Theme reference: `.claude/skills/run-skill-generator/references/architecture.md → Police theme vocabulary`.

- [x] **M0 — Build system** *(Session 0)*
  The `run-skill-generator` skill, state files, roadmap, manual template, docs index.

- [ ] **M1 — Bot core: on the air** 📻
  `package.json` (ESM; scripts `start` / `test` / `deploy-commands`), `src/index.js`, `src/core/{config,logger,loader}.js`, `src/deploy-commands.js`, module `core` with `/radio-check` (latency check), `.env.example`, loader smoke test.
  *Accept when:* `npm test` passes; `node --check` clean on all files; boot fails fast with a clear message when `.env` is missing; `docs/modules/core.md` complete per template; README quickstart section written.

- [ ] **M2 — Enforcement: arm of the law** 🚨
  Module `enforcement`: `/cite` (warn), `/detain` (timeout with duration option), `/release` (lift timeout / unban), `/arrest` (ban, with message-deletion window option). Hierarchy + permission checks per `discord-reference.md`; audit-log reasons always set; duration parsing in `lib/` with tests.
  *Accept when:* all four commands registered and syntax-clean; lib tests pass (incl. duration edge cases: `10m`, `2h`, `7d`, invalid); every failure mode replies specifically; `docs/modules/enforcement.md` complete incl. owner's live-test checklist.

- [ ] **M3 — Records: the rap sheet** 📋
  `src/core/store.js` (atomic JSON per guild, gitignored `data/`), module `records`: infractions written by enforcement actions, `/rapsheet` (view a member's history, ephemeral), retention/clear command for admins.
  *Accept when:* store has tests (concurrent-ish writes, missing file, corrupt file recovery); enforcement writes records; `/rapsheet` paginates or truncates gracefully; manual complete.

- [ ] **M4 — Dispatch: the evidence locker** 🗄️
  Module `dispatch`: configurable log channel (evidence locker) receiving enforcement/records events; `/dispatch` announcement command for the force.
  *Accept when:* log channel configurable per guild via command + stored in records store; missing-channel and missing-permission cases handled; manual complete.

- [ ] **M5 — Academy: ranks** 🎖️
  Module `academy`: rank ladder (Cadet → Chief) mapped to guild roles via config, `/promote`, `/demote`, `/ranks`. Role-hierarchy safety per `discord-reference.md`.
  *Accept when:* ladder logic lives in `lib/` with tests; misconfigured/missing roles reported clearly; manual complete.

- [ ] **M6 — Patrol: automod** 👮
  Module `patrol`: message screening (banned terms, invite links, basic spam heuristic) with actions routed through enforcement/records; `/patrol` to view/toggle rules. Needs `MessageContent` privileged intent — document the portal steps in the manual.
  *Accept when:* screening logic in `lib/` with tests; per-guild toggle stored; false-positive story documented; manual complete.

- [ ] **M7 — Public Affairs: community** 🍩
  Module `public-affairs`: `/badge` (member card: join date, rank, record count), `/wanted` (playful poster embed), `/donut` (fun), `/911` (report to the force → evidence locker).
  *Accept when:* commands work without privileged intents where possible; `/911` respects anonymity choice; manual complete.

- [ ] **M8 — Deployment & operations** 🚀
  Hosting guide (systemd or container), global command deployment, `data/` backup note, token rotation runbook, troubleshooting FAQ.
  *Accept when:* a competent non-expert can take the repo to a live bot using `docs/` alone; global vs guild deploy documented; ops runbook reviewed against `discord-reference.md → Token hygiene`.
