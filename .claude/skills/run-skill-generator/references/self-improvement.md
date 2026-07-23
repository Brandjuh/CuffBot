# Self-Improvement Protocol

**When to read this:** at Step 7 (Improve) of every session, and immediately whenever this skill misleads you mid-session — a wrong instruction gets fixed on the spot, not queued.

This protocol is why the skill is called *self-improving*: the skill is a living document that each session leaves sharper than it found it. The gains compound — a lesson captured once saves every future session from re-learning it. Skipping this step quietly caps how good the system can ever get.

## The retrospective — answer all six, honestly

1. **Where did I lose time?** Searching for something, re-reading, going down a wrong path, redoing work.
2. **What did I assume that turned out false?** And what single check would have caught it instantly?
3. **What did `STATE.md` or `SESSION_LOG.md` fail to tell me** that the previous session could have written down?
4. **Which instruction in this skill was ambiguous, wrong, or missing** when I needed it?
5. **What did I do that future sessions will repeat?** Repetition is a signal: a script, template, or reference section would pay for itself.
6. **What surprised me** about discord.js, Discord, or the environment? Surprises belong in `references/discord-reference.md` or `STATE.md → Environment facts`.

## Turning answers into edits

For each finding, choose the *smallest general fix* — in this order of preference:

| Finding is… | Action |
|---|---|
| A proven, general problem with a clear fix | Edit `SKILL.md` or the relevant reference **now** |
| Plausible but seen only once | Add a dated candidate to `LEARNINGS.md` |
| Already in `LEARNINGS.md` and confirmed again | Promote it into the skill; mark it `promoted` in LEARNINGS |
| Specific to today only (one-off) | Session log entry only — do not pollute the skill |
| Repetitive *work* (not knowledge) | Prefer a script/template over more prose rules |

The two-stage pipeline (LEARNINGS → skill) is deliberate: `LEARNINGS.md` may be messy and speculative; the skill itself must stay lean, general, and trustworthy. Promote on the second confirmation, not the first hunch.

## Guardrails for editing the skill

- **Never weaken the iron rules or delete loop steps.** They encode the owner's brief (English artifacts, verify-don't-assume, manuals required, seamless sessions). Strengthen or clarify only; a genuine protocol change needs the owner's explicit OK, recorded in the session log.
- **Explain why, don't stack MUSTs.** If you are adding ALL-CAPS or rigid numbered constraints, reframe: what understanding would make the rule unnecessary?
- **Generalize.** A fix that only helps today's exact situation does not belong in the skill (see table above).
- **Keep `SKILL.md` under ~300 lines.** Overflow goes into references with a clear pointer. A skill too long to read is a skill that silently stops being followed.
- **Cite evidence.** Every changelog entry names the session and the concrete observation that motivated the change. Future sessions must be able to ask "is this rule still earning its place?" and find the answer.
- **Don't grow what you can automate.** A check that a script can enforce (lint, test, grep) should become part of `npm test` or a script, not a prose rule.

## Versioning

Record every change in `CHANGELOG.md` (same directory):

- **Patch** (0.1.0 → 0.1.1): clarification, typo-level fix, reference detail.
- **Minor** (0.1.x → 0.2.0): new section, new reference, new capability, promoted lesson.
- **Major** (0.x → 1.0): protocol change — owner approval required.

Entry format:

```
## 0.2.0 — 2026-08-01 (Session 3)
- Added storage conventions to architecture.md.
- Evidence: S3 rebuilt the store API from scratch because conventions were undocumented (retro Q5).
```

## Keeping the evals honest

`evals/evals.json` holds prompts that test whether this skill actually helps (bootstrap work, and continuing from state that contains deliberate drift). After a significant skill change, or when the project enters a new kind of work (first stateful module, first deployment), add or update an eval prompt. When asked to evaluate the skill, run the prompts with and without the skill in separate worktrees/copies and compare against the assertions — never test in the real repo.
