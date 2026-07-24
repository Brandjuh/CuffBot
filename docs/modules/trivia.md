# Module: trivia ❓

> Police trivia — `/trivia` posts a buttoned question in the channel; the first correct answer wins a point on the precinct leaderboard. Question sets are plain JSON files, so adding more trivia later is a file drop, not a code change.

## At a glance

| | |
|---|---|
| **Purpose** | Owner request (M11): a police trivia game with scoring, extensible question banks |
| **Commands** | `/trivia [set]`, `/trivia-scores`, `/trivia-sets` — all also as `!command` |
| **Events** | `InteractionCreate` — handles the answer buttons (customId prefix `trivia:`) |
| **Data** | `triviaScores` (points per user) in the guild store; **active rounds live in RAM** (a restart forfeits the open round, scores are safe) |
| **Question sets** | `src/modules/trivia/data/*.json` — ships with `police-codes` and `world-police` (10 questions each) |
| **Intents** | None beyond the base set (buttons need no Message Content) |

## Commands

### /trivia [set]

- **Options:** `set` (optional; choices are generated from the installed data files — default: random set).
- **What happens:** starts **one question round in this channel** (one active round per channel; a second `/trivia` is refused until it resolves). The question is posted publicly with A/B/C/D buttons. First correct press wins a point; everyone gets **one guess**; after **20 s** with no winner the answer is revealed. Back-to-back rounds avoid repeating the previous question of that set.
- **Round resolution:** the question message is edited into a reveal — winner + correct answer + a "did you know" fact when the set provides one.
- **Failure modes:** unknown set id → ephemeral pointer at `/trivia-sets`; round already running → ephemeral refusal.

### /trivia-scores

Public leaderboard (top 10, medals for the podium). Never pings.

### /trivia-sets

Lists installed sets: title, id, question count.

## Buttons

Answer buttons carry `trivia:<roundId>:<choiceIndex>`. The module's own `InteractionCreate` handler filters on the prefix, so it coexists with any future component-using module. Presses on a finished or pre-restart round get a polite ephemeral "that round is over". Wrong answer → ephemeral "one guess per round"; the guess is burned. The winner gets an ephemeral confirmation with their new total (public glory comes from the reveal edit).

## Adding a question set

Drop a JSON file in `src/modules/trivia/data/`:

```json
{
  "set": "my-set-id",
  "title": "Shown in /trivia-sets and the picker",
  "questions": [
    { "q": "Question text (markdown ok)?", "choices": ["A", "B", "C", "D"], "answer": 0, "fact": "optional reveal note" }
  ]
}
```

Rules (validated at load; invalid files are skipped with a journal warning, never a crash): `set` is kebab-case, 2–5 choices per question, `answer` is a valid index. After adding a file, run `node src/deploy-commands.js` (or wait for a self-update) so the set appears in the `/trivia` picker.

## Testing

- `test/trivia.test.js` (12 tests): set validation (incl. every **shipped** set), no-immediate-repeat picking, the one-guess/first-wins/locked-after-win state machine, question/reveal render models, leaderboard sorting, per-channel round state, score accumulation, the full command+button flow with fake interactions (start → wrong → win → late), stale-round presses, and that foreign buttons are ignored.
- **Manual (live server) checklist:**
  1. `/trivia` → question with 4 buttons appears.
  2. Answer wrong on an alt account → ephemeral "one guess"; press again → "already used".
  3. Answer correctly → ephemeral confirmation, message edits into the reveal naming you.
  4. `/trivia-scores` → you're on the board.
  5. Start a round, let 20 s pass → reveal shows "case gone cold" + the answer.
  6. `/trivia` twice in one channel → second is refused; in another channel it works.
  7. `!trivia` (text) → same flow.

## Troubleshooting

| Symptom | Likely cause | Fix |
|---|---|---|
| Buttons do nothing | Bot restarted mid-round (rounds live in RAM) | Press → "round is over"; start a new `/trivia` |
| A set is missing from the picker | JSON invalid (journal shows "Trivia: skipping …") or commands not redeployed | Fix the JSON per the rules above; `node src/deploy-commands.js` |
| Round never reveals | The 20 s timer only runs while the process lives | Restart forfeits the round — start a new one |
| Scores reset | They shouldn't — scores are in the store, not RAM | Check `data/<guild>.json → triviaScores`; see backup runbook |

## Changelog

| Session | Change |
|---|---|
| S20 | Created: buttoned rounds (first-correct-wins, one guess, 20 s reveal), persistent scores, two shipped sets, data-driven set loading. |
