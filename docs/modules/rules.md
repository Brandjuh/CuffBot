# Rules — Module Manual

> Part of **CuffBot**, the police-themed Discord bot. This manual is the single source of truth for what the module does and how to operate it. If the code and this manual disagree, that is a bug — fix one of them and log it.

**Status:** stable
**Last updated:** Session 97 · 2026-07-25

## Purpose

The precinct rulebook (M18, owner request: *"makkelijke manier om regels te maken, de bot maakt een mooi overzichtelijke post van"*). Admins write rules one line at a time; the bot keeps **one tidy published post** current by editing it in place. The rules therefore live at a single stable link that never fragments across the channel, no matter how many times they are edited.

Authoring is deliberately plain — one line of text per rule — because the request was for an *easy* way to write rules. The polish lives in how the bot renders them, not in what an admin has to type.

## Commands

Reading the rules is public; changing them is **Manage Server**.

| Command | What it does | Key options | Who may use it | Example |
|---|---|---|---|---|
| `!rules` | Status: how many rules, which channel, whether published | none | Everyone | `!rules` |
| `!rules show` | Read the rules right here | none | Everyone | `!rules show` |
| `!rules add` | Add a rule to the end | `<text…>` | Manage Server | `!rules add No spam in general` |
| `!rules edit` | Rewrite one rule, keeping its number | `<number> <text…>` | Manage Server | `!rules edit 2 Be kind to each other` |
| `!rules remove` | Remove a rule; the ones below move up | `<number>` | Manage Server | `!rules remove 3` |
| `!rules move` | Move a rule to another position | `<from> <to>` | Manage Server | `!rules move 5 1` |
| `!rules clear` | Erase every rule | `confirm` | Manage Server | `!rules clear confirm` |
| `!rules channel` | Set the channel the rulebook is published to | `<channel>` | Manage Server | `!rules channel #precinct-rules` |
| `!rules title` | Heading of the published post | `<text…>` | Manage Server | `!rules title 📜 House Rules` |
| `!rules intro` | Text above the first rule (empty clears) | `[text…]` | Manage Server | `!rules intro Read before posting.` |
| `!rules outro` | Text below the last rule (empty clears) | `[text…]` | Manage Server | `!rules outro Questions? Ask a mod.` |
| `!rules publish` | Force the post back in line with storage | none | Manage Server | `!rules publish` |
| `!rules preview` | See what would be published, without publishing | none | Manage Server | `!rules preview` |
| `!rules export` | The rules as plain numbered text, ready to copy | none | Manage Server | `!rules export` |

Aliases: the group answers to `!rule`; `show` also takes `list`/`read`, `remove` takes `delete`, `publish` takes `refresh`/`repost`, `intro`/`outro` take `header`/`footer`.

### Numbering

**Rule numbers are positional, not stored.** Rule 2 is whatever sits second. That is what a rules list means — 1..N with no gaps — and it makes `remove` and `move` renumber for free.

The consequence worth knowing: **removing rule 2 shifts every rule below it up one.** The reply says so explicitly ("Rules 2–7 moved up one") rather than leaving an admin to discover it in the published post.

### !rules add / edit

- **Args:** `add <text…>`; `edit <number> <text…>` — the text is the rest of the line, so no quoting is needed.
- **What happens:** the rule is trimmed, stored, and the published post is **updated in the same move**. There is no separate "save" step; the reply states both what changed and what happened to the post.
- **Failure modes:** empty text, over 500 characters, a rulebook already at the 100-rule cap, or a number outside 1..N — each refused with the specific reason and the real range, and the stored list is left untouched.

### !rules channel

- **Args:** `<channel>` — must be a text or announcement channel (the `postable` arg flag, S70/S55).
- **What happens:** stores the channel and publishes immediately. **Moving the rulebook deletes the copies in the old channel**, so the precinct is never left with two rulebooks disagreeing with each other.

### !rules clear

Irreversible, so it demands the literal word: `!rules clear confirm`. Without it, nothing is erased and the reply shows the exact command to run.

## Events

None — the rulebook only changes when an admin changes it, so there is nothing to listen for.

## Configuration

No env vars and no `config.json` keys. Per-guild settings live in the store under `rulesConfig` and are **sparse** (S35): only what an admin explicitly set is written, so improving a default later reaches a guild that never overrode it.

| Key | Default | Effect |
|---|---|---|
| `channelId` | `null` | Where the rulebook is published. Until set, editing rules works but nothing is posted (the reply says so). |
| `title` | `📜 Precinct Rules` | Heading on the first page. |
| `header` | `''` | Intro text above the first rule. |
| `footer` | `''` | Outro text below the last rule. |
| `color` | `0x2b6cb0` | Embed colour. |

## Permissions & safety

- **Bot permissions needed:** View Channel, Send Messages, Embed Links and **Manage Messages** in the rules channel — the last one so it can delete its own surplus pages when the rulebook shrinks or moves.
- **Member permissions:** reading (`!rules`, `!rules show`) is open to everyone; every mutating subcommand requires **Manage Server**, enforced by the group framework before `run()` is entered.
- **The published post never pings.** Every payload carries `allowedMentions: { parse: [] }`, so a rule containing `@everyone` or a role mention renders as text and notifies nobody — which matters because rule text is admin-supplied and gets re-posted on every edit.
- `!rules clear` is the only irreversible action and requires an explicit `confirm`.
- `!rules export` fences its output in a code block: an export is for copying, so markdown and mentions inside a rule must show exactly as typed.

## How it works

- **`lib/rules.js` (pure, no discord.js):** list editing (`addRule`, `editRule`, `removeRule`, `moveRule`, `clearRules`) and `paginateRules`. Every mutation returns `{ ok, rules, message }` instead of throwing, so the command layer is a straight "apply, then say what happened". `normalizeRules` tolerates whatever is in storage, including the pre-normalisation `{ text }` object shape.
- **Pagination** breaks **only between rules**, so a rule is never cut in half. The budget is 3800 characters against Discord's 4096 description cap, leaving room for the intro/outro. The title goes on page one only and a page footer (`Page 2 of 3`) appears once there is more than one, so a multi-page rulebook reads as one document rather than N documents with the same name. A single rule longer than a page is emitted whole rather than silently truncated.
- **`service.js`** owns storage (`rules`, `rulesConfig`, `rulesMessage`) and `publishRules(guild)`. The publish loop follows the **selfroles pattern (S59/S64)**, which solved the identical problem: track the message ids, edit each in place, post what is missing, delete what became surplus, and clean up after a channel move. A per-guild promise lock keeps two commands landing together from racing into duplicate posts.
- **Recovery:** if someone deletes the bot's post by hand, the next publish notices the fetch failure and posts a fresh one rather than losing the rules — the rules themselves live in the store, the message is only a rendering of them.
- `publishRules` returns `'unconfigured' | 'missing-channel' | 'edited' | 'posted'`, and every command turns that into one consistent sentence. **`'edited'` is the normal case** and the whole point of the feature.

## Files

| Path | Role |
|---|---|
| `src/modules/rules/index.js` | Manifest |
| `src/modules/rules/lib/rules.js` | Pure list editing + pagination |
| `src/modules/rules/service.js` | Storage, payload building, the publish loop |
| `src/modules/rules/commands/rules.js` | The `!rules` group |
| `test/rules.test.js` | Coverage |

## Testing

- **Automated:** `npm test` — `test/rules.test.js` (21 tests): positional numbering, refusals that leave the list untouched, the renumber notice, out-of-range messages naming the real range, moves, storage normalisation; pagination splitting only between rules and staying inside the 4096 cap with every rule present exactly once, intro on page one and outro on the last only, an over-long single rule emitted whole; and the publish loop — posts once then **edits** (asserting the channel still holds exactly one message), grows and shrinks page count with surplus deletion, replaces a hand-deleted post, cleans up the old channel on a move, and refuses politely when no channel is set. Plus the command surface: add stores + republishes in one move, clear demands the word, `show` is ungated and renders exactly what gets published, and every mutating subcommand carries the Manage Server flag. No token or network needed.
- **Manual (live server) checklist:**
  1. `!rules channel #your-rules-channel` → the (empty) rulebook appears there.
  2. `!rules add No spam` then `!rules add Be kind` → **the same message updates**; the channel still holds exactly one post.
  3. `!rules title 📜 House Rules`, `!rules intro Read before posting.` → the post's heading and intro change in place.
  4. `!rules move 2 1` → the order swaps and the numbers follow.
  5. `!rules remove 1` → the reply says which rules moved up, and the post agrees.
  6. Delete the bot's post by hand, then `!rules publish` → it comes back with everything intact.
  7. `!rules channel #somewhere-else` → the post moves and the old copy is gone.
  8. As a member **without** Manage Server: `!rules show` works, `!rules add x` is refused naming Manage Server.

## Troubleshooting

| Symptom | Likely cause | Fix |
|---|---|---|
| Edits reply "Not published anywhere yet" | No rules channel set | `!rules channel #channel` |
| "The configured rules channel is gone or unreadable" | Channel deleted, or the bot lost View/Send there | Re-set it, or restore the bot's permissions in that channel |
| The rulebook shrank but old pages remain | The bot lacks **Manage Messages** in that channel | Grant it, then `!rules publish` |
| Two rulebooks in two channels | A channel move happened while the bot could not delete the old copies | Delete the stale ones by hand; the tracked pair is whatever `!rules` reports |
| A rule shows raw `**` or a broken mention | Rule text is stored and rendered verbatim | Rewrite it with `!rules edit <n> …`; use `!rules export` to see exactly what is stored |

## Changelog

| Session | Change |
|---|---|
| S97 | Created (M18, owner request): the `!rules` group (show/add/edit/remove/move/clear/channel/title/intro/outro/publish/preview/export), positional numbering, pagination that breaks only between rules, and a published post the bot **edits in place** — reusing the selfroles publish pattern (S59/S64) including surplus-page deletion and old-channel cleanup. 21 tests. |
