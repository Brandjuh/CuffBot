# Learnings — candidate lessons

Lessons land here first, messy and speculative. Promote a lesson into `SKILL.md` or a reference only after it proves out in at least two sessions — that keeps the skill lean while nothing gets lost. Each entry: date, session, observation, proposed rule, status (`candidate` / `promoted → where` / `rejected — why`).

## Active candidates

- **2026-07-23 · S0 · Environment:** npm registry is reachable through the proxy (`npm view discord.js version` → 14.27.0); Node is v22.22.2; Python 3.11 available; no `gh` CLI — GitHub goes through MCP tools. Proposed rule: record environment facts in `STATE.md` and re-verify only when something fails. Status: candidate (facts also recorded in STATE.md → Environment facts).
- **2026-07-23 · S1 · Owner requirements arrive mid-session via chat.** The single-guild requirement and bot name came in conversation, not via state files. Proposed rule: when the owner states a product decision in chat, promote it immediately into the repo (config, STATE.md "product decision" bullet, session log Decisions) so the next session does not depend on chat history. Status: **promoted → SKILL.md Step 6** (confirmed three times: S1 single-guild, S2 Raspberry Pi target, S3 self-merge mandate).
- **2026-07-23 · S1 · Commit-hash references in the session log.** A log entry that ships inside the same commit cannot cite its own hash. Proposed rule: reference "this session's commit(s), see git log" for the shipping commit; cite hashes only for earlier commits. Status: candidate (template wording still says "with commit hashes").

## Promoted

*(none yet)*

## Rejected

*(none yet)*
