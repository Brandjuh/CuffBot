# CuffBot — Project Instructions

CuffBot is a police-themed Discord bot. All artifacts — code, comments, docs, manuals, commit messages, state files — are written in **English**. Chat may follow the user's language (the owner often writes Dutch).

**Before doing ANY work in this repository, invoke the `run-skill-generator` skill** (via the Skill tool). It is the project's build system: it loads the session protocol, the verified project state, and lessons from previous sessions. This applies to building, fixing, documenting, reviewing, and to vague requests like "continue" / "ga verder" — the skill's Orient and Verify steps establish where the project actually stands before anything else happens.

Quick pointers (the skill explains how each is used):

- `STATE.md` — current snapshot + resume point. **Claims, not truth**: run its Verification block before building on it.
- `SESSION_LOG.md` — append-only session journal; never rewrite old entries.
- `ROADMAP.md` — milestone plan with acceptance criteria.
- `docs/modules/` — one manual per bot module (mandatory, template-based).
- `.claude/skills/run-skill-generator/` — the skill itself. It is self-improving: every session ends by updating it (or explicitly recording why not) and keeping its `CHANGELOG.md` current.
