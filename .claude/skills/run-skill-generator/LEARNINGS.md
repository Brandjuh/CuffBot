# Learnings — candidate lessons

Lessons land here first, messy and speculative. Promote a lesson into `SKILL.md` or a reference only after it proves out in at least two sessions — that keeps the skill lean while nothing gets lost. Each entry: date, session, observation, proposed rule, status (`candidate` / `promoted → where` / `rejected — why`).

## Active candidates

- **2026-07-23 · S0 · Environment:** npm registry is reachable through the proxy (`npm view discord.js version` → 14.27.0); Node is v22.22.2; Python 3.11 available; no `gh` CLI — GitHub goes through MCP tools. Proposed rule: record environment facts in `STATE.md` and re-verify only when something fails. Status: candidate (facts also recorded in STATE.md → Environment facts).
- **2026-07-23 · S1 · Owner requirements arrive mid-session via chat.** The single-guild requirement and bot name came in conversation, not via state files. Proposed rule: when the owner states a product decision in chat, promote it immediately into the repo (config, STATE.md "product decision" bullet, session log Decisions) so the next session does not depend on chat history. Status: **promoted → SKILL.md Step 6** (confirmed three times: S1 single-guild, S2 Raspberry Pi target, S3 self-merge mandate).
- **2026-07-23 · S1 · Commit-hash references in the session log.** A log entry that ships inside the same commit cannot cite its own hash. Proposed rule: reference "this session's commit(s), see git log" for the shipping commit; cite hashes only for earlier commits. Status: candidate (template wording still says "with commit hashes").
- **2026-07-23 · S4/S5 · Owner-operated projects need a doctor command early.** "Verify, never assume" applies to the owner's machine too; after the first "I am 100% sure", a measuring tool beats better instructions. Status: candidate.
- **2026-07-23 · S6 · Never gate runtime behavior on a Node feature newer than `engines` promises.** `--env-file` (Node ≥ 20.6) vs `engines >= 18` broke the Pi. Feature-detect or avoid; prefer in-code equivalents. Status: candidate. *(Recorded late — S6's log claimed this entry but it was not written until S7; see S7 Corrections.)*
- **2026-07-23 · S6 · Failure summaries must quote the underlying error.** The owner pastes the summary line, not the scroll-back; a summary that only theorizes causes misdirects everyone. Status: candidate. *(Recorded late, as above.)*
- **2026-07-23 · S7 · Rendered assets need eyes, not just assertions.** The citation ticket's tests all passed, but only actually viewing the PNG could confirm the font/layout read correctly. Proposed rule: for anything visual, render a sample and look at it before shipping. Status: candidate.
- **2026-07-23 · S7 · Unattended mechanisms get a simulated dress rehearsal.** The self-updater was proven in a clone-pair simulation (good update applied; broken update rolled back by the test gate; exit codes checked) before it ever runs on the Pi. Proposed rule: anything that will run unattended must have its failure path executed once, not just written. Status: candidate.
- **2026-07-23 · S12 · Adopt the server's existing structures; don't impose a model.** The academy was first designed around a fixed Cadet→Chief police ladder; the owner then revealed the server already has leveler-bot ranks under a `[LEVELER]` header. Rebuilt it to detect the ladder from the server's own roles (live, config-driven) instead of hardcoding ranks. Proposed rule: before modeling a domain (ranks, channels, categories), check whether the live server already encodes it and adopt that — especially since this env cannot see the live guild, so make it runtime-detected + owner-verifiable, never hardcoded. Status: candidate (second data point after S1 single-guild — both are "the owner's reality overrides the generic design").

## Promoted

*(none yet)*

## Rejected

*(none yet)*
