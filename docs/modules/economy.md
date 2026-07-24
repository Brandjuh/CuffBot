# Module: economy 💰

> The donut economy — everyone starts with 10,000 donuts, activity pays, birthdays pay big, and crooks sprint through busy channels waiting for someone to shout STOP POLICE.

## At a glance

| | |
|---|---|
| **Purpose** | Owner request (S38): an economy with donuts — earn by being active, win/lose via games; first game: the crook hunt |
| **Commands** | `/donuts`, `/donut-board`, `/steal` (everyone), `/economy-config` (admin) — also as `!` commands |
| **Events** | One `MessageCreate` watcher (earnings + hunt spawn/catch); expiry via timer |
| **Data** | `economyUsers` (balance, lastEarnAt per member), `economyConfig` (sparse overrides) |
| **Intents** | Earnings work event-only; **the hunt needs the Message Content intent** (it must hear "STOP POLICE") — without it hunts don't spawn at all |

## The rules

- **Everyone starts with 10,000 donuts** (owner decision S38). Accounts materialize in the store on first write — checking a balance never creates a record.
- **Activity pay:** 5 🍩 per message, at most once per 60 s (anti-spam cooldown, same shape as message XP).
- **Birthday gift (S38):** on their birthday a member receives **50,000 🍩**, announced inside the birthday message itself (seam from the birthdays module; if the economy is disabled the gift and the line are skipped).
- **Balances never go below 0** — the crook can only steal what someone actually has.

## The crook hunt 🦹

1. When a channel is **active** (≥4 messages from ≥2 humans within 3 minutes), every further message rolls a 3% chance to spawn a crook — at most one hunt per channel per 10 minutes, one open hunt per channel.
2. The crook **lingers 5–20 seconds** (random).
3. First member to shout **STOP POLICE** in time (leading the message; case/punctuation don't matter — "stop police!!!" works, "please stop police" does not) cuffs them and earns **100–300 🍩**.
4. Nobody in time? **The crook escapes and pickpockets 50–250 🍩 from a random member** — announced in the channel (name shown, never pinged).
5. Admins can test instantly: `/economy-config test-hunt:#channel` spawns one crook right there.

A restart forfeits any open hunt (RAM only) — the next busy conversation simply spawns a new one.

## The heist 🕶️ — `/steal target:@member` (S40)

- **30% success** (owner spec): the loot — **500 🍩** — moves from the target to you, capped by what the target actually carries ("that was everything they had on them").
- **70% busted:** YOUR 500 🍩 are confiscated by the **precinct chief — the server owner** (resolved live via `guild.ownerId`, no hardcoded personal id; that's Brandjuh). A failed attempt never touches the target.
- One attempt per **5-minute lay-low window** per thief (stamped on success and failure alike; ephemeral refusal shows the wait). Self-theft and bots refused. Outcome messages name people but never ping.
- House math: expected value per attempt is 0.3·500 − 0.7·500 = **−200 🍩** — stealing is a gamble, not an income.

## Commands

- **/donuts `[member]`** — a wallet check (anyone's; bots run on electricity).
- **/donut-board `[top]`** — richest officers, top 1–25 (default 10).
- **/steal `target`** — the heist above.
- **/economy-config** (admin — Manage Server): `enabled` (master switch), `hunt` (hunts on/off), `earn` (donuts per message 0–100), `test-hunt` (channel — spawn a crook now). Status shows every number plus the Message Content intent state.

## Design notes

- Pure rules in `lib/bank.js` (cooldown pay, activity window, spawn roll, 5–20 s duration, reward/steal ranges, the STOP-POLICE matcher, victim pick) — every random draw takes an injectable `random`, so tests pin outcomes.
- `service.js` owns the store and the RAM hunt state; one watcher event (`economy-watch.js`) handles earn → catch → spawn in that order, so a STOP POLICE shout never doubles as activity that spawns the next crook.
- **Hunts are gated on the Message Content intent**: without it the shout is invisible and the game unwinnable, so spawning is disabled (activity tracking still runs — enabling the intent starts the game instantly). `/economy-config` says exactly this.
- Victims come from the member cache (humans), falling back to existing accounts; stealing from a fresh member correctly dips into their implicit starting 10k.
- All game messages name members without pinging (`allowedMentions: { parse: [] }`) — S35 house rule.

## Testing

- `test/economy.test.js`: cooldown pay, inclusive random ranges, activity-window rules (monologue ≠ active, aging out), spawn-roll matrix, STOP-POLICE matcher (leading-phrase rule), victim pick, starting-balance semantics (read ≠ write), zero floor with honest `applied`, leaderboard, birthday bonus (+ disabled refusal), spawn→catch end-to-end (reward paid, hunt closed, second shout dead), expiry steal (victim named, never pinged, balance dips), empty-server escape, the watcher intent gate (no spawn without Message Content; earnings still flow), and the birthday sweep announcing the 50k line.
- **Manual (live server) checklist:**
  1. `/donuts` → 10,000 🍩 before you ever chat.
  2. Send a message, `/donuts` again → +5.
  3. `/economy-config test-hunt:#general` → crook appears; shout **STOP POLICE** within the window → GOTCHA + bounty.
  4. Test again and stay silent → escape message naming a member who lost donuts.
  5. Chat actively with two people for a few minutes → a crook eventually appears on its own.
  6. On a member's birthday → announcement includes "50,000 donuts", `/donuts member:` confirms.

## Troubleshooting

| Symptom | Likely cause | Fix |
|---|---|---|
| Crooks never appear | Message Content intent off (hunts disabled by design), hunts off, or the channel isn't active enough | `/economy-config` shows the intent state and the activity rules |
| STOP POLICE does nothing | No open hunt (it fled already), or the shout didn't lead the message | Shout faster, shout first |
| No activity pay | Economy disabled, or you're inside the 60 s cooldown | `/economy-config` |
| Birthday came without donuts | Economy disabled at sweep time | `/economy-config enabled:True` |

## Changelog

| Session | Change |
|---|---|
| S38 | Created: 10k starting balance, activity pay, crook hunt (active-channel spawns, 5–20 s window, STOP POLICE catch, escape-steal from a random member), 50k birthday gift announced in the birthday message, `/donuts`, `/donut-board`, `/economy-config` with test-hunt. |
| S40 | `/steal` heist: 30% → 500 🍩 victim→thief; busted → 500 🍩 thief→server owner; 5-min lay-low cooldown; honest capped amounts. |
