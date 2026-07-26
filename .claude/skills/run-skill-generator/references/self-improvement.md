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

## Before declaring a milestone or the base "done": adversarially audit

**If the milestone entry names an inventory, diff the inventory before writing COMPLETE.** The cheapest audit available, and the one M26.3 skipped. Its own roadmap entry listed the source's eight views — `MainMenuView`, `CrimeListView`/`CrimeView`/`CrimeButton`, `BailView`, `JailOptionsView`, `TargetSelectionView`, `BlackmarketView`, `CrimeAttemptView` — and S122/S124 built seven. `MainMenuView` was `[p]city`, a command the owner had typed since S90; S133 found it eleven sessions later because the owner reported the game as missing its panel. Nobody had to read the source to catch this: the list was in the same paragraph as the word COMPLETE. **A written inventory is a test you already wrote — run it.** Walk it item by item against the code and say in the log which items you matched, or the list becomes decoration that makes an incomplete milestone read as finished. Ported work is where this bites, because the inventory is the port's definition of done.

Your own unit tests share your own blind spots — they pass precisely because they encode the behavior you *intended*, including your mistakes. Before calling a milestone (or the whole base) finished, run an **independent adversarial review** across dimensions (correctness, security, cross-module seams, consistency, docs-vs-reality, test gaps), and **verify each finding against the code** before acting on it. Evidence this earns its place: the S15 audit caught a HIGH-severity parser bug (a "documented limitation" that silently truncated a moderator's multi-word reason and filed the corrupted text into the permanent rap sheet) that ~150 author-written tests had sailed past — because the same author wrote the parser, its tests, and the comment excusing the behavior. A "documented limitation" that silently corrupts persistent data is a bug, not a limitation. Treat a green suite as necessary, not sufficient.

## Keeping the evals honest

`evals/evals.json` holds prompts that test whether this skill actually helps (bootstrap work, and continuing from state that contains deliberate drift). After a significant skill change, or when the project enters a new kind of work (first stateful module, first deployment), add or update an eval prompt. When asked to evaluate the skill, run the prompts with and without the skill in separate worktrees/copies and compare against the assertions — never test in the real repo.

## When a session finds nothing wrong

Finding nothing is a legitimate outcome, and it has its own obligations.

**Record the sweep, or it gets re-run.** S115's game audit stayed open for seventeen sessions because its verdict claimed more than its method measured; S132 closed it with five checkable classes and no divergence. That result is only worth the session if the *next* session can find it — so it goes in the audit document and in `STATE.md`, with a note about what would justify re-opening it (an owner report of specific misbehaviour is new evidence; a general worry is not).

**Do not ship a guard you do not trust in order to have a commit.** S132's first attempt at a leaderboard↔stats check misread the module's exports and would have produced false failures until a later session deleted it. A fragile test is worse than no test: it costs every future session attention and teaches them to distrust the suite. This is scaffolding-as-product (0.5.38) in test form.

**Do not promote an unscoped milestone to fill the gap.** "Continue autonomously" removes the need to ask permission; it does not authorise inventing a specification. If an item's gate is a fact about the live server that the container cannot observe, that gate is still shut — say so plainly and hand back the question.
