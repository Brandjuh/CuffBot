# City (crime) — product spec of the Red cog (S137 screening)

> Commissioned by the owner: *"Ik wil een screening van de Red bot, niet van de node."* This documents how the
> **CalaMariGold/CalaMari-Cogs `city`** cog behaves for a Discord user — every command, screen, flow, text and number — derived from its
> source at HEAD (2026-07-31) by an 11-agent screening pass with per-cog completeness review. Since the pivot to
> Red-DiscordBot this is OPERATING documentation for the cog the precinct actually runs, not a rebuild spec.

### Entry Surfaces: `[p]crime`, `[p]city`, status, stats, leaderboard

All commands below are prefix (text) commands on the `crime` group (`city/crime/commands.py:30`) and the `city` group (`city/base.py:65`). "Currency" always means the server's Red bank currency name (e.g. `credits`), fetched live per guild. All large numbers are rendered with thousands separators via `humanize_number`.

None of these surfaces draw on the bulk data dumps (crime-events / scenarios / prison-breaks / heist tables); those are covered by the sections that consume them.

---

#### 1. Bare `[p]crime` — Main Menu (`commands.py:30-81`, `views.py:1680-1863`)

`crime` is a group with `invoke_without_command=True`: subcommands are still directly invokable; the bare command opens the main menu.

**The embed** (`commands.py:50-71`):
- Color: `discord.Color.dark_red()` (#992D22). No thumbnail/image/footer.
- Title: `🌃 Welcome to the Criminal Underworld`
- Description:
  ```
  The city never sleeps, and neither do its criminals. What kind of trouble are you looking to get into today?

  Choose your next move wisely...
  ```
- One field, non-inline, name `__Your Criminal Record__`, value (6 lines, exact):
  ```
  🦹 Current Status: {status}
  💰 Lifetime Earnings: {total_credits_earned} {currency}
  ✅ Successful Crimes: {total_successful_crimes}
  ❌ Failed Attempts: {total_failed_crimes}
  🏆 Largest Heist: {largest_heist} {currency}
  📈 Current Streak: {streak_text}
  ```
  - `{status}` is `⛓️ In jail` if remaining jail time > 0, else `✅ Free` (`commands.py:42`).
  - `{streak_text}` (`city/utils.py:279-293`): `No active streak` when streak ≤ 0; otherwise `🔥 {streak} streak (+{bonus}%)` where bonus = `(streak_multiplier − 1.0) × 100`, rendered with 0 decimals.

**The view** (`MainMenuView`, `views.py:1839-1863`): timeout **60 seconds**. On timeout the dropdown is disabled and the message edited in place (menu stays visible, greyed out). Contains a single select menu (`MainMenuSelect`), placeholder `Choose an action...`, min/max 1 selection, 8 options in this order (`views.py:1688-1737`):

| Label | Emoji | Value | Description |
|---|---|---|---|
| Commit Crime | 🦹 | `crime` | Choose a crime to commit |
| Pay Bail | 💰 | `bail` | Pay to get out of jail early |
| Attempt Jailbreak | 🔓 | `jailbreak` | Try to escape from jail |
| Leaderboard | 🏆 | `leaderboard` | View the crime leaderboard |
| View Status | ⏳ | `status` | Check your criminal status |
| View Stats | 📊 | `stats` | View your crime statistics |
| Inventory | 🎒 | `inventory` | View and manage your items |
| Black Market | 🏴‍☠️ | `blackmarket` | Purchase special items and perks |

**(Unavailable) logic** (`views.py:1746-1791`): the message is sent first, then `initialize_menu()` re-checks the author's state and edits the message. No option is ever removed — only its *description* is replaced:
- If the author is jailed: **Commit Crime** description becomes `(Unavailable) Cannot commit crimes while in jail`.
- If the author is NOT jailed: **Pay Bail** and **Attempt Jailbreak** descriptions become `(Unavailable) Only available while in jail`.
- If jailed AND `attempted_jailbreak` is set: **Attempt Jailbreak** description becomes `(Unavailable) Already attempted jailbreak this sentence` (this branch only wins while jailed, since the not-jailed branch is checked first, `views.py:1762-1777`).
- The whole-select disable expression at `views.py:1786-1787` can never evaluate true with the full 8-option list (its `all(...)` checks always fail), so the select itself is effectively never disabled by state — only by the 60 s timeout.

**Selection behaviour** (`views.py:1793-1837`): anyone other than the menu opener gets ephemeral `This menu is not for you!`. The choice is then re-validated against *live* state (state may have changed since render), with ephemeral rejections:
- `crime` while jailed → `You cannot commit crimes while in jail!`
- `bail`/`jailbreak` while not jailed → `You are not in jail!`
- `jailbreak` with attempt already used → `You've already attempted to break out this sentence!`

On a valid choice the menu message is **deleted**, then the corresponding command is invoked exactly as if typed: `crime` → `[p]crime commit`, `bail` → `[p]crime bail`, `jailbreak` → `[p]crime jailbreak`, `leaderboard` → `[p]crime leaderboard`, `status` → `[p]crime status` (self), `stats` → `[p]crime stats` (self), `inventory` → `[p]city inventory`, `blackmarket` → `[p]crime blackmarket`.

Any exception while building the menu produces the plain message `An error occurred while opening the crime menu: {error}` (`commands.py:81`).

---

#### 2. Bare `[p]city` (`base.py:65-69`)

`city` is a group ("Access the city system."). Bare invocation with no subcommand simply sends Red's standard help page for the `city` command group — no custom embed. Its subcommand relevant here is `[p]city inventory` (`base.py:490-517`, covered in the inventory/black-market section).

---

#### 3. `[p]crime status [user]` (`commands.py:195-319`)

Optional `user` argument; defaults to the invoker. There is no self/other difference in content — the embed always shows the *target's* data (mention, avatar, jail state, cooldowns, perks, last target).

**Embed:**
- Title: `🦹‍♂️ Criminal Status`; description: `Current status for {target mention}`; color: the bot's contextual embed color (`ctx.embed_color()`); thumbnail: the target's display avatar.
- Field `⚖️ __Jail Status__` (non-inline), always present:
  - Not jailed: `🆓 Not in jail`
  - Jailed, no perk: `🔒 In jail for ⏳ {time}` (time via the shared formatter, see below)
  - Jailed with the `jail_reducer` black-market perk: `🔒 In jail for ~~{original}~~ → {current} (-20%)` where `original = current ÷ 0.8` (the pre-reduction sentence reconstructed), both rendered *without* the ⏳ emoji (`commands.py:224-231`).
- Field `🔓 __Jailbreak Status__` (non-inline) — only while jailed and the jailbreak attempt is spent: value `❌ Already attempted this sentence` (`commands.py:240-245`).
- Field `📅 __Crime Cooldowns__` (inline): one line per **enabled** crime type, `{crime emoji} **{Crime Name}:** {cooldown}`. Crime names are the config keys with `_`→space, Title Case (e.g. `Rob Store`, `Bank Heist`). Emoji map (`utils.py:146-153`): pickpocket 🧤, mugging 🔪, rob_store 🏪, bank_heist 🏛, random 🎲, fallback 🦹. Cooldown formatting (`utils.py:10-34`): ready → `✅`; otherwise `⏳ {H}h {M}m` (if ≥ 1 h), `⏳ {M}m {S}s` (if ≥ 1 min), else `⏳ {S}s`. Lines are split into two inline columns — first column gets ⌈n/2⌉ lines, second column (field name `\u200b`) the rest, followed by a fully blank inline field (`\u200b`/`\u200b`) to square the grid (`commands.py:253-283`).
- Field `🔰 __Active Perks__` (inline) — only when the target has unlocked notifications and/or owns `jail_reducer`:
  - `🔔 Notifications enabled` or `🔔 Notifications disabled` (if the notify feature is unlocked)
  - `⚖️ Reduced Sentence (-20% jail time)` (if the perk is owned) (`commands.py:286-301`)
- Field `🎯 __Last Target__` (inline) — only if a last pickpocket/mug target is recorded and still fetchable in the guild: the target member's mention (`commands.py:304-314`).

Errors: `An error occurred while retrieving the status. Please try again. Error: {error}` (`commands.py:319`).

Jail time is derived from a stored unix timestamp `jail_until`; reading it after expiry auto-clears it to 0 (`base.py:83-96`). Cooldowns are `cooldown − (now − last_attempt)`, floored at 0, and always 0 for a member whose admin `cooldowns_disabled` override is on (`base.py:98-121`).

---

#### 4. `[p]crime stats [user]` (`commands.py:321-380`)

Optional `user`; defaults to invoker; same content either way.

**Embed:** title `📊 Criminal Statistics`; description `Detailed statistics for {target mention}`; color `ctx.embed_color()`; thumbnail = target's avatar. Two inline fields side by side:

Field `📊 __Crime Statistics__` — 5 lines:
```
**{currency} Earned:** {total_credits_earned}
**Crimes:** ✅ {total_successful_crimes} | ❌ {total_failed_crimes}
**{currency} Stolen:** {total_stolen_from}
**Largest Heist:** {largest_heist}
**Highest Streak:** 🔥 {highest_streak}
```

Field `💰 __Financial Impact__` — 4 lines:
```
**Total Fines:** {total_fines_paid}
**Total Bail:** {total_bail_paid}
**{currency} Lost:** {total_stolen_by}
**Success Rate:** {rate}%
```
Success rate = successful ÷ (successful + failed) × 100, shown with exactly 1 decimal (e.g. `62.5%`); with zero total crimes the line is `**Success Rate:** N/A` (`commands.py:354-362`).

Errors: `An error occurred while retrieving the stats. Please try again. Error: {error}` (`commands.py:380`).

---

#### 5. `[p]crime leaderboard` (alias `[p]crime lb`) (`commands.py:588-731`)

Guild-only. If the guild has no member data at all: plain message `No crime statistics found for this server!` (`commands.py:632`). Otherwise one embed:

- Title: `🏆 Crime Leaderboard - Hall of Infamy`; description: `The most notorious criminals in the server`; color `ctx.embed_color()`; footer text `Updated` with the embed timestamp set to now (Discord renders "Updated • {local time}").
- Six categories, each an **inline** field listing the top **3** members, one line each, prefixed with medals `🥇 🥈 🥉` by rank. Members who have left the guild are skipped from the list *without* promoting lower ranks (their medal simply doesn't appear). Categories in order (`commands.py:596-627`):

| Field name | Ranked by | Line format after `{medal} **{display name}** • ` |
|---|---|---|
| `💰 __Most {currency} Earned__` | `total_credits_earned` | `{value} {currency}` |
| `🦹 __Crime Success/Fails__` | sum of successful + failed crimes | `{wins}w / {fails}f` |
| `💎 __Stolen/Lost {currency}__` | sum of stolen-from + stolen-by | `{stolen} / {lost}` (both humanized, no currency suffix) |
| `🏆 __Largest Heist__` | `largest_heist` | `{value} {currency}` |
| `💸 __Most Fines/Bail Paid__` | sum of fines + bail paid | `{fines + bail} {currency}` (single combined number) |
| `🔥 __Highest Crime Streak__` | `highest_streak` | `{value}` (plain number) |

- Layout: after every odd-numbered populated field (except a final one), a blank inline spacer field (`\u200b`/`\u200b`) is inserted (`commands.py:688-690`, `723-725`). With all six categories populated this yields three Discord rows of "category / spacer / category" — i.e. a two-column board.

---

### Committing a Crime — End-to-End Flow

All screens in this flow are ordinary channel messages (never ephemeral, except one bail-out error noted below). Every view is locked to the invoking player via an `interaction_check` (`city/crime/views.py:214-216`, `views.py:422-424`, `views.py:947-949`, `views.py:1529-1531`).

#### 1. Crime list screen (`!crime commit`)

Entry points: the `!crime commit` command (`city/crime/commands.py:83-101`) or the main menu's "Commit Crime" select option (covered elsewhere).

**Embed** (`commands.py:120-182`):
- Title: `🦹‍♂️ Criminal Activities`
- Color: the bot's configured embed color (`await ctx.embed_color()`, `commands.py:133`) — not hardcoded.
- Description (verbatim, `commands.py:123-132`):
  ```
  Choose your next heist wisely...
  {jail_status}
  **Fines:**
  🟢 Low Risk: 30-35% of max reward
  🟡 Medium Risk: 40-45% of max reward
  🔴 High Risk: 45-50% of max reward
  ```
  If the player is jailed, `{jail_status}` is `⛓️ **JAILED** for {h}h {m}m` (over 1 hour) or `⛓️ **JAILED** for {m}m {s}s` (`commands.py:110-118`); otherwise the line is empty.
- Footer: `Use the buttons below to choose a crime` (`commands.py:182`).
- Fields: one field per crime in config order (pickpocket, mugging, rob_store, bank_heist, random), laid out in pairs of two inline fields followed by a zero-width-space spacer field (`\u200b`) to force 2-per-row (`commands.py:137-180`). Field name: `{crime emoji} __**{Crime Name}**__` (name is `crime_type.replace('_',' ').title()`, e.g. `🏛 __**Bank Heist**__`). Note: the embed loop does not check the per-crime `enabled` flag, so a config-disabled crime still gets a field but no button (`commands.py:137` vs `views.py:173-175`).
- Field value from `format_crime_description` (`city/utils.py:171-222`), lines in order: `**Success Rate:** {n}%`, `**Reward:** …`, `**Risk Level:** {🟢|🟡|🔴}`, `**Cooldown:** {status}`, plus `**Target Required:** Yes` for pickpocket/mugging. Reward line is `**Reward:** 1-10% of target's balance (max 500)` for pickpocket (`utils.py:201`), `**Reward:** 15-25% of target's balance (max 1500)` for mugging (`utils.py:209`), `**Reward:** {min:,} - {max:,}` otherwise (`utils.py:217`). Random crime shows `**Success Rate:** ???`, `**Reward:** ???`, `**Risk Level:** ???` (`utils.py:188-197`). Cooldown status is `✅` when ready, else `⏳ {h}h {m}m` / `⏳ {m}m {s}s` / `⏳ {s}s` (`utils.py:10-34`).

**Default crime numbers** (`city/crime/data.py:4-67`) — these are guild-configurable via `!crimeset`:

| Crime | Target? | Reward | Success | Cooldown | Jail if caught | Risk | Fine multiplier | Shown "Potential Fine" |
|---|---|---|---|---|---|---|---|---|
| pickpocket | Yes | 1–10% of target balance, min 150, max 500 | 60% | 600 s (10 m) | 3,600 s (1 h) | low | 0.35 | 175 |
| mugging | Yes | 15–25% of target balance, min 400, max 1,500 | 60% | 1,800 s (30 m) | 5,400 s (1 h 30 m) | medium | 0.4 | 600 |
| rob_store | No | 500–2,000 flat | 50% | 21,600 s (6 h) | 10,800 s (3 h) | medium | 0.4 | 800 |
| bank_heist | No | 1,500–5,000 flat | 40% | 86,400 s (24 h) | 14,400 s (4 h) | high | 0.4 | 2,000 |
| random | No | per scenario | per scenario | 3,600 s (1 h) | per scenario | per scenario | per scenario | ??? |

Global settings that matter here: `min_steal_balance` 100, `max_steal_amount` 1000 (`data.py:75-76`).

**Buttons — CrimeListView** (`views.py:143-226`), timeout **60 s**:
- One button per enabled crime, label = Title-Case crime name, `custom_id` = crime key. Style by risk (`views.py:178`): **green (success)** for low risk, **blurple (primary)** for medium, **red (danger)** for high; the random crime's risk string is `"random"`, which falls through to **green**. Emoji (`views.py:181-190`): 🧤 Pickpocket, 🔪 Mugging, 🏪 Rob Store, 🎲 Random, 🏛 Bank Heist. So the default row is: 🧤 Pickpocket (green), 🔪 Mugging (blurple), 🏪 Rob Store (blurple), 🏛 Bank Heist (red), 🎲 Random (green).
- Immediately after posting, `update_button_states` edits the message and disables (greys out) any button whose crime is on cooldown, or all of them if the player is jailed (`views.py:202-212`, called at `commands.py:190`). States are not refreshed again afterward.
- On timeout the entire list message is **deleted** (`views.py:218-226`).

**Pressing a crime button** (`views.py:32-141`): re-checks jail and cooldown (buttons can be stale). If jailed: channel message `⛓️ You're still in jail for {minutes}m {seconds}s! You can pay bail using `!crime bail` or jailbreak using `!crime jailbreak`` (`views.py:49-54`). If on cooldown: `⏳ You must wait {hours}h {minutes}m before attempting {crime_type} again!` when over 1 hour, else `⏳ You must wait {minutes}m {seconds}s before attempting {crime_type} again!` (Title-Case crime name; `views.py:60-77`). If both checks pass, the crime list message is **deleted** (`views.py:85-88`) and the flow branches: targeted crimes (pickpocket, mugging) → target selection; others → confirmation. No cooldown is set at this point.

#### 2. Target selection (pickpocket / mugging only)

A plain text message `Choose your target:` with a **TargetSelectionView**, timeout **60 s** (`views.py:92-98`, `views.py:1369-1379`). Three buttons, no emojis:
- **Random Target** — blurple/primary (`views.py:1544`)
- **Select Target** — green/success (`views.py:1602`)
- **Cancel** — red/danger (`views.py:1611`)

**Cancel**: sends `Crime cancelled.` and deletes the tracked messages (`views.py:1611-1622`). **Timeout**: disables the buttons, sends `Target selection timed out.`, deletes tracked messages (`views.py:1624-1647`). Neither costs anything nor sets a cooldown.

**Select Target** opens a modal titled `Select Target` with one required text input — label `Target User`, placeholder `Enter username, nickname, or ID`, length 1–100 (`views.py:1210-1223`). On submit (`views.py:1225-1367`), the input is matched case-insensitively against every guild member's username, display name, and ID (exact matches first, then substring matches):
- Multiple exact matches → `Multiple users found with that exact name/nickname:` + a code block listing `1. @{name}` or `1. @{name} (Nickname: {nick})` per match + `Please use their Discord ID or full @username to target a specific user.` (`views.py:1247-1263`).
- No exact but multiple partial matches → `Multiple possible matches found:` + same code-block list capped at the first **10** + `Please be more specific or use their Discord ID or full @username.` (`views.py:1267-1283`).
- No match → `Could not find a member named '{name}'. Please check the spelling and try again.` (`views.py:1285-1291`).

Target validation (`can_target_for_crime`, `views.py:1649-1678`; `utils.py:36-85`) rejects with: `You can't target yourself!`, `You can't target bots!`, `Target must have at least {min:,} credits!` (min = `min_steal_balance`, default 100), `That user is in jail!`, `You can't target your last victim!` (the single most recent successful-crime target is off-limits). Then a balance check: target must hold at least `max(min_steal_balance, crime min_reward)` — 150 for pickpocket, 400 for mugging — else `This target doesn't have enough {currency} to steal from! (Minimum: {min:,})` (`views.py:1303-1315`).

**Random Target** (`views.py:1544-1600`, algorithm `views.py:1396-1527`): shuffles all guild members excluding bots, the player, and the player's last target; excludes jailed members; then scans in chunks (chunk size `min(25, max(10, N//20))`), returning the first member whose balance ≥ the same minimum and who passes `can_target_for_crime`. It gives up after scanning 50% of the pool. On failure it sends (`views.py:1583-1592`):
```
No valid targets found. A valid target must:
• Have at least {min_balance:,} {currency}
• Not be your last target
• Not be in jail
Try again later or choose a specific target.
```
(or, if the exclusion filters emptied the pool entirely: `No valid targets found! Everyone is either a bot or the only member found was already your last target.`, `views.py:1432`).

**"Target Selected" reveal** — an embed carrying the Confirm/Cancel view (this doubles as the targeted crimes' confirmation screen; they never see the "Your move, boss" embed):
- Title: `🎯 Target Selected` — the 🎯 is the fallback emoji because the default crime data has no `emoji` key (`views.py:1327-1331`, `views.py:1558-1561`; `data.py` has no `emoji` fields).
- Description: `Ready to attempt {crime type} against {target display name}?` (crime type lowercase with spaces, e.g. "rob store" style — here "pickpocket"/"mugging").
- Color: red.
- Fields: `📊 Success Rate` = `{n}%` (inline), `💸 Potential Fine` = `{int(max_reward × fine_multiplier):,} {currency}` (inline). **Modal path only** adds a third non-inline field `🎯 Target Details` with value `Username: @{target.name}` + newline + `Bank Balance: {balance:,} {currency}` (`views.py:1342-1350`) — the random-target path omits it (`views.py:1558-1577`), so the random path never reveals the victim's balance.

#### 3. Confirmation — CrimeView (Confirm / Cancel)

For non-targeted crimes the confirmation embed is posted directly after the button press (`views.py:100-134`):
- Random crime: title `🎲 Random Crime`, description `Are you feeling lucky?`, red, fields `📊 Success Rate` = `???` and `💸 Potential Fine` = `???` (`views.py:104-111`).
- Rob store / bank heist: title `🦹 Rob Store` / `🦹 Bank Heist` (🦹 is the fallback emoji, `views.py:114`), description `Your move, boss. You ready?`, red, fields `📊 Success Rate` = `{n}%`, `💸 Potential Fine` = `{amount:,} {currency}` (`views.py:112-127`).

View timeout **30 s** (`views.py:232`); two buttons: **Confirm** (green/success, `views.py:459`) and **Cancel** (grey/secondary, `views.py:905`).

- **Cancel** deletes all tracked messages plus the confirmation itself and sends the plain message `Crime cancelled.` (`views.py:905-934`). **Cancelling is completely free: no credits deducted, no cooldown started.**
- **Timeout** disables the buttons and sends `Crime timed out.` (`views.py:434-457`) — likewise free.
- **Confirm** (`views.py:459-903`): re-checks cooldown — message `⏳ You must wait {hours}h {minutes}m before attempting {crime_type} again!` with the *raw snake_case* crime key this time (`views.py:474-480`) — and jail (same jail line as §1, `views.py:485-494`). For targeted crimes it re-checks the target's balance (`Your target doesn't have enough {currency} to steal from! (Minimum: {min:,})`, `views.py:497-510`). Any of these aborts without cost or cooldown. Otherwise the confirmation and all earlier flow messages are deleted (`views.py:520-530`) and the attempt begins.
- For the **random crime**, the scenario is drawn now: a uniform pick from the 46 default scenarios plus any guild custom scenarios (`views.py:533-544`; `city/crime/scenarios.py:84-108`). The scenario overrides min/max reward, success rate, jail time, risk, and fine multiplier. Random crimes get **no** mid-crime events (`views.py:545`).

**When the cooldown actually starts:** only at `views.py:896`, after a success or failure result has fully resolved — or on bail-out (`views.py:974`). Opening the list, picking a target, cancelling, timing out, or an aborted confirm never consumes the cooldown.

#### 4. Attempt narration and pacing

A plain-text attempt message is posted with a **CrimeAttemptView** attached (`views.py:550-578`). Attempt texts (`views.py:551-572`):
- pickpocket: `🧤 {user} begins to slip their hand towards {target}'s pocket...` (user = mention, target = display name)
- mugging: `🔪 {user} lurks in the shadows, waiting for {target}...`
- rob_store: `🏪 {user} pulls out their weapon and approaches the store...`
- bank_heist: `🏛 {user} begins their elaborate plan to breach the bank vault...`
- random: the scenario's `attempt_text` formatted with the user's mention.

**CrimeAttemptView** (`views.py:936-1030`): timeout **30 s**, single button **`Bail Out!`** — red/danger with 🏃 emoji (`views.py:951`). Pressing it:
- withdraws a flat **100** credits (hardcoded, `views.py:963`); if the player can't pay: *ephemeral* `You don't have enough {currency} to bail out! (Cost: 100)` and the crime continues (`views.py:964-971`);
- **sets the crime's full cooldown** (`views.py:974`);
- disables the button and posts an embed: title `🏃 Bailed Out!`, description `{user mention} chickened out and bailed on the {crime type}!` (spaces, lowercase, e.g. "bank heist"), color **yellow**, one non-inline field `Cost` = `100 {currency}` (`views.py:981-992`). The crime then silently stops at the next bail check — no result, no jail, no fine.
- On view timeout the button just greys out; the narration continues regardless (`views.py:1009-1030`).

**Pacing** (all in the Confirm handler):
1. Sleep **2 s** after the attempt message (`views.py:581`), then bail check (`views.py:584`).
2. Non-random crimes only — random events (`get_crime_event`, `scenarios.py:45-82`): drawn without replacement from that crime's 24-event pool; the 1st event is guaranteed, a 2nd has **75%** chance, a 3rd **50%**, a 4th **10%** (so 1–4 events). For each event: bail check first (`views.py:599`), then the event's text is posted as a plain message (placeholders `{currency}`, `{credits_bonus}`, `{credits_penalty}` filled; `{user}` becomes a mention if present, `scenarios.py:17-43`), then sleep **4.0 s** (`views.py:615`). Modifiers applied per event (`views.py:617-636`): `chance_bonus` adds to success chance (cap 1.0), `chance_penalty` subtracts (floor **0.05**), `reward_multiplier` stacks multiplicatively, `jail_multiplier` immediately multiplies jail time (`jail_time = int(jail_time × m)`), `credits_bonus`/`credits_penalty` accumulate as a net direct credit change.
3. Suspense sleep by risk (`views.py:638-644`): **6 s** high, **5 s** medium, **4 s** low (random crime uses its scenario's risk).
4. Final bail check (`views.py:647`), then the success roll: `random.random() < success_chance` (`views.py:654`).

Worst-case narration length ≈ 2 + 4×4 + 6 = 24 s, inside the 30 s bail window. The full event pools are dumped verbatim at `/home/user/CuffBot/src/modules/city/data/crime-events.json` (96 events: 24 per crime). Spot-verified: the first pickpocket entry `"Your target is distracted by their phone! 📱 (+15% success chance)"` / `chance_bonus: 0.15` matches `scenarios.py:696-697`, and a full deep-compare of the JSON against `CRIME_EVENTS` and of `/home/user/CuffBot/src/modules/city/data/scenarios.json` (46 scenarios) against `RANDOM_SCENARIOS` both pass at the checkout's HEAD (commit `2edfc7c`) — the dumps are current; reference them for all event/scenario text and modifiers.

#### 5. Success result

Reward pipeline (targeted: `views.py:658-735` + `utils.py:87-127`; non-targeted: `views.py:756-809`):
1. **Base amount** — targeted: a uniform random percentage of the target's balance (pickpocket 1–10%, mugging 15–25%), capped at `max_steal_amount` (default **1,000**), capped at the crime's `max_reward`, and raised to `min_reward` if below it while the target's balance ≥ `min_reward ÷ min_steal_percentage`. Non-targeted: `randint(min_reward, max_reward)`.
2. **× streak multiplier**, rounded. Streaks (`utils.py:224-293`): each success increments the streak; multiplier is `1.0 + 0.05 × streak` capped at **1.25** (streak 5+); streak resets on any failure or if more than **24 h** (86,400 s) has passed since the last crime. Since success always yields streak ≥ 1, a streak line always appears.
3. **× each event `reward_multiplier`** in order, rounded after each.
4. **+ net direct credit changes** from events.
5. Clamp: targeted — to `[0, target balance]`, then withdrawn from the target and deposited to the player (`views.py:701-705`); non-targeted — floored at 0 and deposited (`views.py:781-785`). (Targeted crimes re-check the minimum-balance rule one last time before transfer and abort with the same "doesn't have enough" message — in that case no cooldown is set, `views.py:687-698`.)

**Success embed** (`views.py:257-330`), color **green**, title `💰 Successful {Crime Name}!` (💰 is the fallback emoji). Description:
- pickpocket with target: `🧤 {user mention} successfully pickpocketed {target mention}!`; mugging: `🔪 {user mention} successfully mugged {target mention}!`
- rob_store: `🏪 {user mention} successfully robbed the store!`; bank_heist: `🏛 {user mention} successfully pulled off a bank heist!`
- random: the scenario's `success_text` with `{amount}` = reward before direct credits (unformatted integer) and `{currency}`.

Fields:
- `💰 Reward Calculation` (non-inline, `views.py:285-323`), one line each:
  - `Base: {base:,} {currency}` (or, if there were no modifier lines at all, the single line `** {base:,} {currency}**` — note the space after `**`);
  - streak: `➜ 🔥 {n} streak (+{p}%): {amount:,} {currency}`;
  - each event multiplier: `➜ ({m:.1f}x): {amount:,} {currency}`;
  - direct credits, if nonzero: `➜ (+{c:,}): {final:,} {currency}` or `➜ ({-c:,}): {final:,} {currency}`;
  - `**Final: {final:,} {currency}**`.
- `📊 Success Rate` (inline): the event-modified final chance, `{n}%` (`views.py:325-328`).

The Bail Out button on the attempt message is disabled after the result posts (`views.py:732-734`, `views.py:799-801`).

#### 6. Failure result

On a failed roll (`views.py:819-896`): the streak resets; fine = `int(max_reward × fine_multiplier)` (scenario values for random crimes). If the player can pay, the full fine is withdrawn. If not, **their entire balance is confiscated and jail time is doubled**, with the plain message: `You cannot afford the fine of {fine:,} {currency}. All your money has been confiscated and your jail time has been doubled!` (`views.py:836-851`).

**Failure embed** (`views.py:331-420`), color **red**, title `👮 Failed {Crime Name}!`. Description:
- pickpocket: `{user mention} was caught trying to pickpocket {target mention}!`; mugging: `{user mention} was caught trying to mug {target mention}!`
- rob_store: `{user mention} was caught trying to rob the store!`; bank_heist: `{user mention} was caught trying to rob the bank!`
- random: the scenario's `fail_text` with `{fine}` = the fine actually paid.

Fields (all inline):
- `💸 Fine` = `{fine:,} {currency}` — only if the amount actually paid > 0 (`views.py:360-365`).
- `⛓️ Jail Time` — only if jail time > 0, formatted `Xm Ys`/`Xh Ym` with strikethrough decorations (`views.py:368-413`): doubled → `~~{orig}~~ → {doubled} (+100%)`; jail-reducer perk (Black Market) → `~~{time}~~ → {time×0.8} (-20%)`; both → `~~{orig}~~ → ~~{orig×0.8} (-20%)~~ → {orig×0.8×2} (+100%)`; otherwise plain. ("Doubled" is detected heuristically: jail time equals exactly 2× the config base × cumulative event jail multiplier, `views.py:376-386`.)
- `📊 Success Rate` = `{n}%` (modified chance) — only added when the Jail Time field is present (nested inside its branch, `views.py:415-418`).

Immediately after the embed, a separate message with the **JailOptionsView** (bail / jailbreak buttons — see the jail section) is posted (`views.py:876-880`), the player is jailed for the computed time via `send_to_jail` (the jail-reducer perk trims 20% at this point, `commands.py:944-952`), and the crime's cooldown is set (`views.py:896`).

---

### Jail System: Serving Time, Bail, Jailbreak, and Release

> Source note: `city/crime/jail.py` is dead code — its module docstring reads "CURRENTLY NOT IN USE AND WIP" (`city/crime/jail.py:1-6`) and nothing imports its `JailManager`. Its variants of these screens (e.g. a bail embed with the line "*Bail cost is calculated as: remaining minutes × {multiplier}*", a gold "🔓 Jailbreak Attempt" pre-embed) must NOT be implemented. The live jail experience lives entirely in `city/crime/commands.py`, `city/crime/views.py`, `city/base.py`, and `city/crime/scenarios.py`, cited below.

#### Jail state and how sentences are stored

- A jailed member has a `jail_until` UNIX timestamp; remaining time = `max(0, jail_until − now)`, and the field auto-clears to 0 the first time it is read after expiry (`city/base.py:83-96`). "In jail" means remaining > 0 (`city/base.py:129-132`).
- `send_to_jail(member, jail_time, channel=None)` sets `jail_until = now + jail_time`, resets the per-sentence `attempted_jailbreak` flag to `False`, stores `jail_channel` only when a channel is passed, and — if the member has release notifications enabled — schedules the release ping (`city/crime/commands.py:944-965`). The crime-failure path calls it **without** a channel (`city/crime/views.py:893`); only the admin `[p]crime jail <user> <minutes>` command passes the invoking channel (`city/crime/commands.py:1029`).
- **Jail-reducer perk**: if `"jail_reducer"` is in the member's `purchased_perks`, every sentence passed to `send_to_jail` is multiplied by 0.8 (`int(jail_time * 0.8)`, a flat −20%) before storage (`city/crime/commands.py:947-949`). The perk is the Black Market item "Reduced Sentence" (⚖️, cost 20,000, permanent, not toggleable) (`city/crime/blackmarket.py:25-33`). Quirk to reproduce: the admin `[p]crime jail` command *also* pre-reduces `minutes*60` by 20% itself before calling `send_to_jail` (`city/crime/commands.py:1020-1029`), so a perk-holder manually jailed serves 0.8 × 0.8 = 64% of the stated minutes, while the embed shown ("⛓️ Manual Jail", red, fields "⏰ Sentence Duration" — value suffixed with " (Reduced by 20%)" — and "📅 Release Time" as a Discord relative timestamp) displays the singly-reduced time (`city/crime/commands.py:1031-1052`).

#### What a jailed player sees when trying to act

- **`[p]crime` main menu**: the "Your Criminal Record" field's first line reads `🦹 Current Status: ⛓️ In jail` instead of `✅ Free` (`city/crime/commands.py:41-42,63`). In the menu's select (placeholder "Choose an action...", view timeout 60 s), option descriptions are rewritten by status: while jailed, "Commit Crime" shows "(Unavailable) Cannot commit crimes while in jail"; while free, "Pay Bail"/"Attempt Jailbreak" show "(Unavailable) Only available while in jail"; after using the attempt, "Attempt Jailbreak" shows "(Unavailable) Already attempted jailbreak this sentence" (`city/crime/views.py:1746-1783`). The options stay selectable; picking a disallowed one is rejected with an ephemeral message: "You cannot commit crimes while in jail!", "You are not in jail!", or "You've already attempted to break out this sentence!" (`city/crime/views.py:1804-1813`).
- **`[p]crime commit` list**: the embed description injects a jail banner when jailed — `⛓️ **JAILED** for {h}h {m}m` if over 3600 s remain, else `⛓️ **JAILED** for {m}m {s}s` (`city/crime/commands.py:108-118`) — and every crime button is disabled while jailed (`city/crime/views.py:202-212`).
- If a jailed player still reaches a crime button or the final "Commit Crime" confirmation, the bot posts (plain text, hard-coded `!` prefix): "⛓️ You're still in jail for {minutes}m {seconds}s! You can pay bail using `!crime bail` or jailbreak using `!crime jailbreak`" (`city/crime/views.py:46-55` and `city/crime/views.py:484-494`).
- **Jailed players cannot be targeted**: target validation for pickpocket/mugging returns the refusal "That user is in jail!" (`city/crime/views.py:1669-1671`).
- **`[p]crime status`** shows a "⚖️ __Jail Status__" field: with the reducer perk, `🔒 In jail for ~~{original}~~ → {remaining} (-20%)` where original = remaining ÷ 0.8; without it, `🔒 In jail for ⏳ {time}`; when free, `🆓 Not in jail`. If the jailbreak was used this sentence, an extra field "🔓 __Jailbreak Status__" = "❌ Already attempted this sentence" appears (`city/crime/commands.py:221-251`). Perk holders also get "🔰 __Active Perks__" listing "🔔 Notifications enabled/disabled" and/or "⚖️ Reduced Sentence (-20% jail time)" (`city/crime/commands.py:286-301`).
- **After a failed crime**, below the failure embed the bot sends a second, component-only message (no text, no embed) holding `JailOptionsView` (view timeout 60 s) with two buttons: **"Jail Break"** (danger/red, emoji 🔓) and **"Pay Bail"** (success/green, emoji 💸) (`city/crime/views.py:876-880,1976-2054`). Only the jailed player may press them (`city/crime/views.py:1985-1987`). "Jail Break" disables itself immediately, then runs the `[p]crime jailbreak` flow; "Pay Bail" runs the `[p]crime bail` flow, then disables both buttons. On timeout the buttons are disabled in place (`city/crime/views.py:1989-1996`).

#### `[p]crime bail`

Flow (`city/crime/commands.py:382-447`):

1. Not in jail → plain reply "You're not in jail!" and stop.
2. Guild setting `allow_bail` is false → "Bail is not allowed in this server!" and stop. (Default `allow_bail: true`; toggled by `[p]crimeset global togglebail`, `city/crime/data.py:73`, `city/crime/commands.py:897-906`.)
3. **Cost** = `int(bail_cost_multiplier × (remaining_seconds / 60))`, i.e. multiplier × remaining minutes. Default guild multiplier is **1.6** (`city/crime/data.py:74`); the code falls back to 1.5 only if the key is missing (`city/crime/commands.py:403`). Admin-settable via `[p]crimeset global bailcost` (`city/crime/commands.py:881-895`).
4. Can't afford it → "💵❌You don't have enough {currency} to pay the bail amount of {amount}!" (no space between ❌ and "You") and stop (`city/crime/commands.py:406-413`).
5. Otherwise the **bail prompt embed** is sent — title "💰 Bail Payment Available", color gold, timestamp = now, footer "Requested by {display_name}" with the author's avatar icon, no fields; description exactly (`city/crime/commands.py:423-435`):
   - "You can pay bail to get out of jail immediately, or wait out your sentence." then a blank line, then
   - `**Time Remaining:** {time}` — formatted "Xh Ym" / "Xm Ys" / "Xs" without emoji (`city/utils.py:10-34`), suffixed with " (Reduced by 20%)" if the player owns `jail_reducer`,
   - `**Bail Cost:** {cost:,} {currency}`,
   - `**Current Balance:** {balance:,} {currency}`.
6. Attached is `BailView`, **timeout 30 s**, with buttons **"Pay Bail"** (success/green, 💸) and **"Cancel"** (danger/red, ❌); only the command author may interact (`city/crime/views.py:1032-1089,1153`).
7. Quirk to reproduce: merely opening this prompt resets `attempted_jailbreak` to `False` (`city/crime/commands.py:442-444`) — a player who failed to plan a jailbreak can open/cancel the bail prompt and attempt jailbreak again.

All `BailView` result embeds share one shape: description-only, timestamp = now, footer "Requested by {display_name}" + avatar (`city/crime/views.py:1043-1052`).

- **Pay Bail** (`city/crime/views.py:1089-1151`): re-checks funds; if short, sends a red embed "💵 Insufficient Funds" with description "You don't have enough {currency} to pay bail!\n\n**Required:** {amount:,} {currency}\n**Current Balance:** {balance:,} {currency}" and leaves the prompt active. Otherwise it withdraws the cost, sets `jail_until = 0`, adds the cost to the `total_bail_paid` stat, cancels any pending release notification, **deletes the prompt message**, and sends the receipt embed (green, kept permanently): title "🔓 Bail Paid Successfully!", description "You have been released from jail.\n\n**Bail Cost:** {cost:,} {currency}\n**Previous Balance:** {old:,} {currency}\n**New Balance:** {new:,} {currency}".
- **Cancel** (`city/crime/views.py:1153-1180`): sends an orange embed "❌ Bail Cancelled" with description "You have chosen to serve your time.\n\n**Time Remaining:** {m}m {s}s" (suffix " (Reduced by 20%)" for reducer owners), then deletes **both** the prompt and that cancel embed (cleanup deletes every tracked message, `city/crime/views.py:1054-1065`), leaving nothing behind.
- **Timeout (30 s)** (`city/crime/views.py:1189-1208`): buttons are disabled, a greyple embed "⏰ Time's Up" / "Bail payment timed out." is posted, then the prompt and the timeout embed are both deleted.

#### `[p]crime jailbreak`

Flow (`city/crime/commands.py:449-586`):

1. Not in jail → "You're not in jail!"
2. **One attempt per sentence**: if `attempted_jailbreak` is already true → "You've already attempted to break out this sentence!" The flag is set to true *before* the narration starts (`city/crime/commands.py:470-472`); it resets on a new sentence, on a successful escape, when a bail prompt is opened, or when a jail pass is used.
3. A **prison-break scenario** is drawn uniformly (`random.choice`) from the 14-entry `PRISON_BREAK_SCENARIOS` list (`city/crime/scenarios.py:110-122,1055`). Every scenario has `base_chance` **0.35** (35%) and 12 candidate events. Full data (names, attempt/success/fail texts, all event texts and modifiers) is dumped verbatim in `/home/user/CuffBot/src/modules/city/data/prison-breaks.json` — spot-verified ("Tunnel Escape": 🕳️ texts, base 0.35, +15%/+10%/+25%/+5% bonuses, +200/+400 currency, −15%/−10%/−20%/−5% penalties, −150/−300 currency) and programmatically confirmed an **exact match of all 14 entries against HEAD** of `scenarios.py`. Use that file; do not re-derive.
4. **Paced narration** (all plain text messages, not embeds): the scenario's `attempt_text` is sent with `{user}` = the player's mention; then a **3-second** suspense sleep (`city/crime/commands.py:479-484`). Then **1–3 events** (uniform `random.randint(1, 3)`) are drawn **without replacement** (`random.sample`) from the scenario's 12 events (`city/crime/commands.py:487-488`). Each event's text (with `{currency}` substituted) is sent as its own message, followed by a **3.5-second** sleep after each (`city/crime/commands.py:491-518`). Event effects, applied in draw order:
   - `chance_bonus`: success chance += bonus, capped at **1.0**;
   - `chance_penalty`: success chance −= penalty, floored at **0.05** (5% minimum);
   - `currency_bonus`: deposited immediately; the message gets the suffix ` (+{amount} {currency})`;
   - `currency_penalty`: withdrawn only if the player can afford it, appending ` (-{amount} {currency})`; if they can't pay, it is skipped silently with no suffix (`city/crime/commands.py:509-515`).
5. After the last event a single `random.random()` roll decides: **success iff roll < final chance** (`city/crime/commands.py:520-523`).
6. **Success**: `jail_until` is cleared, `attempted_jailbreak` reset, any pending release notification cancelled. (A safety re-check exists: if jail time somehow remains, "Jail time not properly cleared! Remaining: {}" is sent and it force-clears — `city/crime/commands.py:531-536`.) Result embed: title "🔓 Successful Jailbreak!", green, description = scenario `success_text` with `{user}` mention, one inline field "🎲 Final Escape Chance" = the chance as `{:.1%}` (e.g. "50.0%") (`city/crime/commands.py:538-549`).
7. **Failure**: remaining time is re-read *after* the narration delays; `added_time = int(remaining × 0.3)` is added onto the stored `jail_until` (**+30% of remaining sentence**) (`city/crime/commands.py:551-558`). Result embed: title "⛓️ Failed Jailbreak!", red, description = scenario `fail_text` with `{user}` mention, plus two inline fields (`city/crime/commands.py:560-583`):
   - "⚖️ Penalty" = `Your sentence has been increased by 30%!\n ({m}m {s}s + 30% = ⏰ {new_m}m {new_s}s)` — note the space after the newline; old m/s from the pre-penalty remaining time, new values from `remaining × 1.3`;
   - "🎲 Final Escape Chance" = `{:.1%}`.

#### `notify_ping` release notification

- The Black Market perk **"Jail Release Notification"** (🔔, cost 10,000, toggleable, sellable) sets `notify_unlocked = True` and `notify_on_release = True` on purchase (`city/crime/blackmarket.py:16-24,130-133`); selling it clears both (`city/inventory.py:452-455`). Owners can toggle it from the inventory's activate menu, which replies ephemerally "🔔 Notifications are now enabled/disabled" (`city/inventory.py:297-309`).
- When a member with `notify_on_release = True` is jailed, a timer task is scheduled for exactly the (perk-reduced) sentence length, replacing any prior task (`city/crime/commands.py:958-965`). When it fires it re-checks that the member is actually free and still has notifications enabled, then sends — preferring the stored `jail_channel` (looked up first as a thread, then as a channel): "🔔 {member.mention} Your jail sentence is over! You're now free to commit crimes again."; if no channel is stored/found it falls back to a DM without the mention: "🔔 Your jail sentence is over! You're now free to commit crimes again." (delivery failures are silent) (`city/crime/commands.py:973-1000`). Because the crime-failure path never stores a channel, in practice the channel route only triggers if a `jail_channel` remains from an admin `[p]crime jail`.
- Cancellation/edge behavior to replicate: paying bail and a successful jailbreak both cancel the pending task (`city/crime/views.py:1125`, `city/crime/commands.py:529`). A **failed jailbreak does not reschedule** the task — it wakes at the original release time, sees time still remaining, and exits, so extended sentences produce **no** notification. Using a jail pass does not cancel the task, so the ping still arrives at the originally scheduled time.
- Related consumable (detailed in the Black Market section): "Get Out of Jail Free" (🔑, 1,000, 1 use) — usable only while jailed ("❌ You're not in jail! Save your jail pass for when you need it."), sets `jail_until = 0`, clears `jail_channel` and `attempted_jailbreak`, and replies ephemerally "🔑 Used your Get Out of Jail Free card! You are now free." (`city/inventory.py:324-352`).

---

### Black market and inventory

> Dump status note: this section's data (3 black-market items) is transcribed in full below; it does not rely on the bulk JSON dumps. Spot-check performed anyway per protocol: `/home/user/CuffBot/src/modules/city/data/scenarios.json` entry `ice_cream_heist` (min 100 / max 300 / rate 0.75 / jail 1800 / fine 0.3 and all three texts) matches the Python source at `city/crime/scenarios.py:139-149` — the dump still matches HEAD.

#### Item catalog (the only items in the game)

Defined in `city/crime/blackmarket.py:15-43`. There is no admin way to add items; the `business` shop import in the inventory command fails silently because no `business/` module exists (`city/base.py:508-513`), so this registry is the complete item universe.

| id | Name | Emoji | Price | Type | Effect | Sellable | Notes |
|---|---|---|---|---|---|---|---|
| `notify_ping` | Jail Release Notification | 🔔 | 10,000 | perk | "Get notified when your jail sentence is over" — unlocks and immediately **enables** release pings (`notify_unlocked=True`, `notify_on_release=True` on purchase, blackmarket.py:131-133) | yes | toggleable in inventory |
| `jail_reducer` | Reduced Sentence | ⚖️ | 20,000 | perk | "Permanently reduce jail time by 20%" — every sentence is multiplied by 0.8 at jailing time (`city/crime/jail.py:59-66`; covered in the jail section) | yes | not toggleable — never appears in the use/toggle select |
| `jail_pass` | Get Out of Jail Free | 🔑 | 1,000 | consumable | "Instantly escape from jail" | yes | 1 use per purchase (blackmarket.py:41) |

Prices are static; currency name is the server's Red bank currency.

#### `[p]crime blackmarket` — the shop screen

Command: `crime blackmarket` (`city/crime/commands.py:1057-1065`), help text: "View the black market shop." / "The black market offers special items and perks that can help with your criminal activities." / "Items purchased here will appear in your inventory (!city inventory)." Also reachable from the `[p]crime` main-menu select option **Black Market** 🏴‍☠️ "Purchase special items and perks", which deletes the menu message and invokes this command (`city/crime/views.py:1731-1736`, `1815-1837`).

**Embed** (`blackmarket.py:188-220`):
- Color: dark red (`discord.Color.dark_red()`, `#992D22`)
- Title: `🏴‍☠️ Black Market`
- Description: `Welcome to the black market! Here you can purchase special items and perks.`
- Field `__🔒 Permanent Perks__` (not inline): one block per perk, format `{emoji} **{name}** - {cost:,} {currency}` newline `↳ {description}` — i.e. `🔔 **Jail Release Notification** - 10,000 credits` / `↳ Get notified when your jail sentence is over`, then the ⚖️ line.
- Field `__📦 Consumable Items__` (not inline): same format for `jail_pass`.
- No thumbnail/image.

**View** (`BlackmarketView`, `blackmarket.py:45-84`): timeout **180 s**; on timeout every component is disabled and the message edited in place (`blackmarket.py:169-176`). Single select menu:
- Placeholder: `Select an item to purchase`
- One option per catalog item: label = item name, emoji = item emoji, description = `{description} - {cost:,} credits` — note the select hard-codes the word **"credits"** (`blackmarket.py:77`) even when the server currency is named something else (the embed uses the real currency name).

Only the invoking user can interact: `interaction_check` rejects everyone else (`blackmarket.py:158-167` — Discord shows its generic interaction-failed notice; a redundant ephemeral "This menu is not for you!" guard at `blackmarket.py:92-94` is unreachable behind it).

**Purchase flow** (`_handle_purchase`, `blackmarket.py:86-156`), all responses ephemeral; the shop embed/select never refresh after a purchase:
1. Item id not in registry → `❌ This item is no longer available!` (blackmarket.py:100-103).
2. Balance below cost → `❌ You need {cost:,} {currency_name} to buy this!` (blackmarket.py:107-114).
3. Perk already owned → `❌ You already own this perk!` (blackmarket.py:119-124).
4. **Second-jail-pass block**: buying a consumable you already hold with `uses > 0` → `❌ You already have this item with uses remaining!` (blackmarket.py:138-145). You can only re-buy a jail pass after the previous one is fully used or sold. Buying (re-buying) a consumable sets its uses back to the catalog value (1 for `jail_pass`, blackmarket.py:147).
5. Success: credits withdrawn **after** the config write (blackmarket.py:150) → `✅ Purchased {emoji} **{name}** for {cost:,} {currency_name}`.

#### `[p]city inventory` — the inventory screen

Command: `city inventory`, guild-only (`city/base.py:490-517`), help text "View your inventory of items and perks from all city systems." Also reachable from the `[p]crime` menu option **Inventory** 🎒 "View and manage your items" (`views.py:1725-1730`, `1834-1835`).

On invocation the member's data is cleaned and saved back before rendering: consumables with 0 uses, duration items past `end_time`, and perks/items whose id is no longer in the registry are deleted (`city/inventory.py:19-64`, `521-526`).

**Embed** (`inventory.py:193-251`):
- Color: blue (`discord.Color.blue()`, `#3498DB`)
- Title: `🎒 Your Inventory`
- Description: `Select an item to activate or sell it.` — replaced by `Your inventory is empty!` when the player owns nothing (inventory.py:248-249).
- Field `__🔒 Permanent Perks__` (not inline): `{emoji} **{name}**{status}` newline `↳ {description}`; for `notify_ping` only, `{status}` is ` (Enabled)` or ` (Disabled)` per the current `notify_on_release` flag (inventory.py:211-213).
- Field `__📦 Active Items__` (not inline): use-based items render `{emoji} **{name}**` newline `↳ {uses} uses remaining`; duration items would render `↳ Time remaining: {time_str}` with `format_time_remaining` output like `2d 5h 30m` / `45m` (inventory.py:222-246, 543-567 — no duration item exists in the current catalog, but the pathway must be implemented).
- No thumbnail/image.

**View** (`InventoryView`, timeout **180 s**, `inventory.py:81`; on timeout all components disabled via message edit, `inventory.py:486-493`). Only the invoker may interact (`inventory.py:475-484`). After every successful action the embed and both selects are re-rendered in place on the original message (`inventory.py:253-266`).

- Empty inventory: a single **disabled** select, placeholder `No items in inventory`, one option label `Empty` / description `Your inventory is empty` (inventory.py:119-125).
- Row 0 — **use/toggle select**, placeholder `Select an item to use/toggle` (inventory.py:128-161). Contains every owned item **except** non-toggleable perks (so `jail_reducer` never appears here). Option per item: emoji = item emoji (fallback 📦); label = item name, except `notify_ping` whose label is `Jail Release Notification (Enabled)` or `(Disabled)`; description = item description, prefixed with a status when present — `{uses} uses remaining - {description}` for consumables, or `{h}h {m}m remaining - {description}` for duration items (this row's time format `Xh Ym` differs from the embed's, inventory.py:113).
- Row 1 — **sell select**, placeholder `Select an item to sell` (inventory.py:163-191). One option per sellable owned item: emoji 💰, label `Sell {name}`, description `Sell for {sell_price:,} {currency}` (status-prefixed the same way). Sell-back price = `int(cost × 0.25)` for perks, `int(cost × 0.5)` for consumables (inventory.py:169, 434) — concretely: Jail Release Notification 2,500; Reduced Sentence 5,000; Get Out of Jail Free 500. A consumable's price ignores remaining uses.

**Use/toggle flow** (`_handle_activation`, `inventory.py:268-411`), all responses ephemeral:
- Item vanished from registry → `❌ This item no longer exists!` (inventory.py:282-285). (A `❌ This perk cannot be toggled!` guard exists at inventory.py:290-295 but non-toggleable perks are filtered out of the menu.)
- `notify_ping`: flips `notify_on_release` and replies `🔔 Notifications are now enabled` / `🔔 Notifications are now disabled` (inventory.py:297-308); the embed line and the option label update to the new (Enabled)/(Disabled) state on refresh. This select is the **only** user-facing notify toggle (a `toggle_notifications` helper keyed to a nonexistent `jail_notifier` perk in `jail.py:78-89` is dead code).
- `jail_pass` while **not** jailed → `❌ You're not in jail! Save your jail pass for when you need it.` — the pass is not consumed (inventory.py:325-332).
- `jail_pass` while jailed: one use consumed (entry deleted at its last use), `jail_until` set to 0, jail channel cleared, the once-per-sentence jailbreak-attempt flag reset, reply `🔑 Used your Get Out of Jail Free card! You are now free.` (inventory.py:334-352).
- Generic paths a re-implementation must keep for future items: duration item already running → `❌ This item is already active for {time_str}!`; activating one → `✨ Activated {emoji} **{name}** for {time_str}` (inventory.py:354-377); a use-item at 0 uses that defines default uses is re-armed with `✨ Added {emoji} **{name}** with {uses} uses`, otherwise `❌ This item has no uses remaining!`; a normal use replies `✨ Used {emoji} **{name}**` plus ` ({n} uses remaining)` when uses remain (inventory.py:378-408); other toggleable perks reply `✨ Activated {emoji} **{name}**` (inventory.py:310-315).

**Sell flow** (`_handle_sale`, `inventory.py:413-473`), all responses ephemeral:
- Item gone from registry → `❌ This item no longer exists!`; perk not actually owned → `❌ You no longer have this perk!`; consumable not held → `❌ You no longer have this item!` (inventory.py:427-462).
- Selling `notify_ping` also sets `notify_on_release=False` **and** re-locks the feature (`notify_unlocked=False`, inventory.py:452-455) — it must be re-bought for 10,000 to get pings again.
- Success: item removed (perk from the perk list; consumable entry deleted entirely), sell price deposited, reply `💰 Sold {emoji} **{name}** for {sell_price:,} {currency_name}` (inventory.py:464-472), then the message refreshes.

---

### The Numeric Model (crimes, settings, streaks, events, scenarios, targeting)

All values below are the shipped defaults from `city/crime/data.py`; every crime property is stored per-guild under `crime_options` and every global under `global_settings`, so admins can change them, but a re-implementation must default to exactly these numbers. Source verified at CalaMari-Cogs HEAD `2edfc7c`.

#### The 5 crimes (`city/crime/data.py:4-67`)

| Property | pickpocket | mugging | rob_store | bank_heist | random |
|---|---|---|---|---|---|
| Requires target | yes | yes | no | no | no |
| min_reward | 150 | 400 | 500 | 1,500 | 100 * |
| max_reward | 500 | 1,500 | 2,000 | 5,000 | 3,000 * |
| success_rate | 0.6 (60%) | 0.6 (60%) | 0.5 (50%) | 0.4 (40%) | 0.5 * |
| cooldown | 600 s (10 m) | 1,800 s (30 m) | 21,600 s (6 h) | 86,400 s (24 h) | 3,600 s (1 h) |
| jail_time on failure | 3,600 s (1 h) | 5,400 s (1 h 30 m) | 10,800 s (3 h) | 14,400 s (4 h) | 600 s * |
| risk | low | medium | medium | high | random * |
| fine_multiplier | 0.35 | 0.4 | 0.4 (comment says 45%, value is 0.4 — use 0.4) | 0.4 | 0.5 * |
| steal % of target balance | 1%–10% (`min_steal_percentage` 0.01, `max_steal_percentage` 0.10) | 15%–25% (0.15 / 0.25) | `steal_percentage: 0` | `steal_percentage: 0` | `steal_percentage: 0` |
| emoji (`city/utils.py:146-153`) | 🧤 | 🔪 | 🏪 | 🏛 | 🎲 |

\* For `random`, the starred values are placeholders: min_reward, max_reward, success_rate, jail_time, risk and fine_multiplier are **all overwritten by the drawn scenario** at confirm time (`city/crime/views.py:532-544`). Only its **cooldown (3,600 s)** comes from the table.

Crime-list display strings (numbers baked into UI text, `city/utils.py:188-220`): pickpocket shows `**Reward:** 1-10% of target's balance (max 500)`, mugging shows `**Reward:** 15-25% of target's balance (max 1500)`, non-targeted crimes show `**Reward:** {min:,} - {max:,}`, and `random` shows `???` for Success Rate, Reward and Risk. Risk emoji: 🟢 low / 🟡 medium / 🔴 high (`city/utils.py:164-169`).

- **Fine** on failure = `int(max_reward × fine_multiplier)` (`city/crime/views.py:825`, also `city/base.py:136`). Defaults: pickpocket 175, mugging 600, rob_store 800, bank_heist 2,000; random = scenario-dependent. The same formula feeds the "💸 Potential Fine" field shown before confirming (`city/crime/views.py:1568-1572`).
- If the player cannot pay the full fine, their **entire balance is confiscated** and **jail time is doubled**, with the message: `You cannot afford the fine of {fine:,} {currency}. All your money has been confiscated and your jail time has been doubled!` (`city/crime/views.py:836-851`). Doubling happens **after** event jail multipliers.
- Jail on failure: `jail_until = now + jail_time`; being jailed also resets the member's `attempted_jailbreak` flag (`city/crime/commands.py:944-952`).
- The cooldown timestamp is set **after every attempt, success or failure** (`city/crime/views.py:896`); an admin per-member override `cooldowns_disabled` makes all cooldowns read 0 (`city/base.py:100-103`, default False, `city/crime/data.py:105`).

#### Global settings and their defaults (`city/crime/data.py:70-85`)

| Setting | Default | Used where |
|---|---|---|
| `allow_bail` | True | bail blocked when False (`city/crime/jail.py:299`, `city/crime/commands.py:398`) |
| `bail_cost_multiplier` | **1.6** | bail cost = `int(multiplier × remaining_jail_seconds / 60)` — i.e. 1.6 credits per remaining jail **minute** (`city/crime/jail.py:283`, `city/crime/commands.py:403`). Note: the code's `.get()` fallback is 1.5, but the registered default is 1.6. |
| `min_steal_balance` | 100 | balance floor for being targeted (`city/utils.py:66-69`, `city/crime/views.py:500`, `1402`, `688`) |
| `max_steal_amount` | 1,000 | hard cap on any single steal (`city/utils.py:113-115`) |
| `default_jail_time` | 1,800 s (30 m) | registered default only — never read by any code path |
| `default_fine_multiplier` | 0.5 | registered default only — never read |
| `protect_low_balance` | True | registered default only — never read (protection is in fact always on via `min_steal_balance`) |
| `show_success_rate` | True | registered default only — never read |
| `show_fine_amount` | True | registered default only — never read |
| `enable_random_events` | True | registered default only — never read (events always fire for the 4 fixed crimes) |
| `custom_scenarios` | `[]` | guild-added scenarios merged into the random pool (`city/crime/scenarios.py:84-99`) |

#### Streak rules (`city/utils.py:224-293`)

- Multiplier = `1.0 + min(0.25, streak × 0.05)`: streak 1 → 1.05×, 2 → 1.10×, 3 → 1.15×, 4 → 1.20×, **5+ → 1.25× (cap)** (`city/utils.py:238`).
- On success the streak increments (and `highest_streak` updates); on **any failure it resets to 0**; if **more than 86,400 s (24 h)** passed since the last crime it resets to 0 before the attempt is counted (`city/utils.py:252-271`).
- The streak bonus is applied to the base reward **before** event reward multipliers, rounding after each multiplication (`city/crime/views.py:667-677`, `763-773`).
- Display string when active: `🔥 {streak} streak (+{bonus:.0f}%)`; otherwise `No active streak` (`city/utils.py:289-293`).

#### Event draws (the 4 fixed crimes only)

For pickpocket, mugging, rob_store and bank_heist (never for `random` — it gets an empty event list, `city/crime/views.py:545`), 1–4 events are drawn **without replacement** from that crime's own pool of 24 events (`city/crime/scenarios.py:45-82`):

- 1st event: guaranteed
- 2nd event: 75% chance
- 3rd event: 50% chance
- 4th event: 10% chance

Each event message is posted with the crime's currency substituted, **4.0 s apart** (`city/crime/views.py:613-615`), after a **2 s** pause following the attempt message (`views.py:581`). Modifier application (`views.py:617-636`):

- `chance_bonus` adds to success chance, clamped to **max 1.0**; `chance_penalty` subtracts, clamped to **min 0.05** (a 5% floor).
- `reward_multiplier` values multiply the running reward (rounded after each step, after the streak bonus).
- `jail_multiplier` values multiply jail time (`int()`-truncated per event) and are also multiplied into a cumulative figure shown in the result embed.
- `credits_bonus` / `credits_penalty` are summed into a net direct-credit change applied on top of the final reward (success: added to the deposit/steal, clamped so the final amount is ≥ 0 and, for targeted crimes, ≤ the target's balance — `views.py:679-701`, `776-783`).

The full 96-event pool (4 crimes × 24 events: exact texts, bonuses/penalties of ±5%–±25% chance, 0.6×–1.8× reward, 0.8×–1.3× jail, ±25–±200 credits) is dumped verbatim in `/home/user/CuffBot/src/modules/city/data/crime-events.json` — programmatically verified identical to `city/crime/scenarios.py:693-1351` at HEAD `2edfc7c` (24/24/24/24 entries, zero field mismatches). Spot check: pickpocket event 1 `"Your target is distracted by their phone! 📱 (+15% success chance)"`, `chance_bonus: 0.15` (`scenarios.py:696-697`) matches the dump.

After the last event, a risk-based suspense delay precedes the success roll: **high 6 s, medium 5 s, low 4 s** (`city/crime/views.py:638-644`). Success = `random.random() < success_chance` using the event-modified chance (`views.py:654`); the result embed shows the modified rate as an integer percent (`views.py:725`, `792`).

#### The random-scenario mechanism (`crime random`)

On confirm, the pool = the 46 built-in `RANDOM_SCENARIOS` plus any guild `custom_scenarios`; one is drawn **uniformly at random** (`city/crime/scenarios.py:84-108`, `city/crime/views.py:533-535`). The scenario then overwrites the crime's `min_reward`, `max_reward`, `success_rate`, `jail_time`, `risk` and `fine_multiplier` (`views.py:537-544`); its `attempt_text` / `success_text` / `fail_text` replace the stock messages. No crime events fire. Reward = `random.randint(min_reward, max_reward)`, then streak bonus (`views.py:759-767`).

Ranges across the 46 built-ins (verified by script): `min_reward` 100–3,000; `max_reward` 300–8,000; `jail_time` 1,800–14,400 s; `fine_multiplier` 0.20–0.50; `success_rate` takes only the three constants **0.75 (low risk), 0.50 (medium), 0.30 (high)** (`city/crime/scenarios.py:13-15`); risk mix 13 low / 20 medium / 13 high. The one outlier: `gacha_banner` is low-risk but has 5,400 s jail and 0.20 fine (`scenarios.py:678-689`); the extreme is `botception` (3,000–8,000 reward, 14,400 s jail, 0.50 fine, `scenarios.py:666-677`). All 46 full entries (names, numbers, texts) are dumped verbatim in `/home/user/CuffBot/src/modules/city/data/scenarios.json` — programmatically verified identical to `city/crime/scenarios.py:137-690` at HEAD `2edfc7c` (46/46, zero mismatches). Spot check: `ice_cream_heist` = low risk, 100–300, 0.75, 1,800 s, 0.3 fine (`scenarios.py:138-149`) matches the dump.

#### Targeted-crime rules (pickpocket & mugging)

Who may be targeted (`city/crime/views.py:1649-1678` calling `city/utils.py:36-85`):

1. **Not yourself** — `You can't target yourself!` (`utils.py:55-56`).
2. **Not a bot** — `You can't target bots!` (`utils.py:59-60`).
3. **Balance floor**: target must hold at least `min_steal_balance` (default 100) — `Target must have at least {min_balance:,} credits!` (`utils.py:64-69`). At attempt time the effective floor is `max(min_steal_balance, crime.min_reward)` — i.e. 150 for pickpocket, 400 for mugging — re-checked both before and after the roll with `Your target doesn't have enough {currency} to steal from! (Minimum: {min:,})` (`views.py:497-510`, `686-698`).
4. **Not jailed** — `That user is in jail!` (`views.py:1669-1671`).
5. **Anti-farm lock (not a time window)**: you can never target the person recorded as your `last_target` — `You can't target your last victim!` (`views.py:1673-1676`). `last_target` is written **only on a successful steal** (`views.py:711`; legacy path `city/base.py:190`), so the lock persists indefinitely until you successfully rob someone else (or the victim's data is wiped, `city/base.py:76-81`).

"Random Target" search (`city/crime/views.py:1396-1514`): shuffles the member list after excluding bots, self and the last target; skips jailed members; accepts the first member whose balance ≥ `max(min_steal_balance, crime.min_reward)` that passes the checks above; gives up after scanning **50% of the member list** (`views.py:1511-1512`). On no result it prints: `No valid targets found. A valid target must:\n• Have at least {min_balance:,} {currency}\n• Not be your last target\n• Not be in jail\nTry again later or choose a specific target.` (`views.py:1583-1592`).

Stolen amount on success (`city/utils.py:87-127`): draw a **uniform real percentage** between the crime's min and max steal percentage (1–10% pickpocket, 15–25% mugging) of the target's balance, truncate to int, then cap at `max_steal_amount` (1,000) **and** at the crime's `max_reward` (500 / 1,500); if the result is below the crime's `min_reward` but the target's balance ≥ `min_reward / min_steal_percentage` (15,000 for pickpocket, 2,667 for mugging), raise it to `min_reward`. Streak and event multipliers then apply, net event credits are added, and the transfer is finally clamped to `0 ≤ amount ≤ target_balance` (`city/crime/views.py:663-705`). The victim's loss is recorded in their `total_stolen_by`; the thief's `total_stolen_from`, `total_credits_earned` and (if a record) `largest_heist` update with the actual transferred amount (`views.py:707-717`).

---

### Admin & Owner Surface (crime module)

All paths below are relative to the cog root (`city/`). Verified against checkout HEAD, commit `2edfc7c` ("admin command: toggle crime cooldown for self").

**Dump verification:** spot-checked the first of the 46 entries in `/home/user/CuffBot/src/modules/city/data/scenarios.json` (`ice_cream_heist`: risk low, reward 100–300, success_rate 0.75, jail_time 1800, fine_multiplier 0.3, 🍦 texts) against `crime/scenarios.py:138-149` — identical, including `SUCCESS_RATE_HIGH = 0.75` (`crime/scenarios.py:13`). The dump still matches HEAD; reference it for the full scenario pool rather than retranscribing.

#### Permission gates — summary

| Command | Gate | Source |
|---|---|---|
| `[p]crimeset` + every subcommand | Red admin role **or** Administrator permission (`admin_or_permissions(administrator=True)`; group check inherited by subcommands) | `crime/commands.py:733-734` |
| `[p]crimeset scenarios` + add/list/remove | same admin gate, **plus** guild-only (each subcommand repeats both decorators) | `crime/commands.py:1067-1069, 1080-1082, 1182-1184, 1221-1223` |
| `[p]crimeset reload_defaults` | admin gate (redundantly re-declared on the subcommand) | `crime/commands.py:855-856` |
| `[p]crime jail` | admin gate | `crime/commands.py:1002-1003` |
| `[p]crime togglemycds` | admin gate | `crime/commands.py:1240-1241` |
| `[p]wipecitydata`, `[p]wipecityallusers` | **bot owner only** (`is_owner()`) | `base.py:359-360, 425-426` |

**There is no admin "unjail" command anywhere in the cog.** The only release paths are the player's own `bail`/`jailbreak`, the black-market "Get Out of Jail Free" item, natural expiry, or an owner data wipe. A re-implementation must NOT add one.

#### `[p]crimeset` — per-crime tuning

Bare `[p]crimeset` invokes no default action (empty group body, `crime/commands.py:735-746`), so Red shows the group help. Docstring lists: `success_rate`, `reward`, `cooldown`, `jailtime`, `fine`, `global`.

All five tuning subcommands share the same shape: they mutate the guild's `crime_options` dict, and an unknown `crime_type` yields the plain-text reply `Invalid crime type!`. Valid keys are the guild's crime_options keys — by default `pickpocket`, `mugging`, `rob_store`, `bank_heist`, `random` (`crime/data.py:4-67`). Keys are case-sensitive, snake_case. All replies are plain text (no embed).

| Subcommand | Args | Validation (checked *before* the crime-type check) | Success reply |
|---|---|---|---|
| `success_rate <crime_type> <rate>` | rate: float | rejected if `< 0` or `> 1`: `Success rate must be between 0.0 and 1.0` | `Success rate for {crime_type} set to {rate}` (`crime/commands.py:748-767`) |
| `reward <crime_type> <min> <max>` | two ints | rejected if `min < 0` or `max < min`: `Invalid reward range!` | `Reward range for {crime_type} set to {min}-{max}` (`crime/commands.py:769-790`) |
| `cooldown <crime_type> <seconds>` | int | rejected if `< 0` (0 allowed): `Cooldown must be positive!` | `Cooldown for {crime_type} set to {formatted}` (`crime/commands.py:792-811`) |
| `jailtime <crime_type> <seconds>` | int | rejected if `< 0`: `Jail time must be positive!` | `Jail time for {crime_type} set to {formatted}` (`crime/commands.py:813-832`) |
| `fine <crime_type> <multiplier>` | float | rejected if `< 0`: `Fine multiplier must be positive!` | `Fine multiplier for {crime_type} set to {multiplier}` (`crime/commands.py:834-853`) |

`{formatted}` uses `format_cooldown_time` (`utils.py:10-34`): `⏳ Xh Ym` when ≥ 1 hour, `⏳ Xm Ys` when ≥ 1 minute, `⏳ Xs` otherwise, and just `✅` when the value is ≤ 0 (so setting a cooldown of 0 replies `Cooldown for pickpocket set to ✅`).

**`reload_defaults`** — replaces the guild's entire `crime_options` with a copy of the hardcoded defaults; custom scenarios and global settings are untouched. Reply: `✅ Crime settings have been reloaded from defaults!` (`crime/commands.py:855-868`). Defaults being restored (`crime/data.py:4-67`):

| Crime | Reward | Success | Cooldown | Jail | Fine mult | Steal % of target |
|---|---|---|---|---|---|---|
| pickpocket | 150–500 | 0.6 | 600 s | 3,600 s | 0.35 | 1–10% |
| mugging | 400–1,500 | 0.6 | 1,800 s | 5,400 s | 0.4 | 15–25% |
| rob_store | 500–2,000 | 0.5 | 21,600 s | 10,800 s | 0.4 | — |
| bank_heist | 1,500–5,000 | 0.4 | 86,400 s | 14,400 s | 0.4 | — |
| random | 100–3,000 | 0.5 | 3,600 s | 600 s | 0.5 | — (per-scenario overrides) |

#### `[p]crimeset global` — guild-wide settings

Empty group (help on bare invoke), `crime/commands.py:870-879`.

- **`bailcost <multiplier>`** (float): `< 0` → `Bail cost multiplier must be positive!`; else sets `bail_cost_multiplier` and replies `Bail cost multiplier set to {multiplier}` (`crime/commands.py:881-895`). Registered default is **1.6** (`crime/data.py:74`); note the bail command's code fallback is 1.5 (`crime/commands.py:403`) but the registered default wins in practice.
- **`togglebail <enabled>`** (bool): sets `allow_bail`; replies `Bail system enabled!` or `Bail system disabled!` (`crime/commands.py:897-906`).
- **`view`**: one plain-text message (no embed), built as (`crime/commands.py:908-942`):

  ```
  🌐 **Global Settings**:
    • Bail System: Enabled|Disabled
    • Bail Cost Multiplier: {value}
    • Min Steal Balance: {value}      (default 100, crime/data.py:75)
    • Max Steal Amount: {value}       (default 1000, crime/data.py:76)

  🎯 **Crime Settings**:

  **{Crime_Type.title()}**:
    • Success Rate: {rate}
    • Reward: {min}-{max}
    • Cooldown: {formatted with ⏳/✅}
    • Jail Time: {formatted with ⏳/✅}
    • Fine Multiplier: {mult}
  ```
  Crimes with `enabled: false` are skipped.

#### `[p]crimeset scenarios` — custom random-crime scenarios

Guild-only + admin. Empty group; docstring lists `add`, `list`, `remove` (`crime/commands.py:1067-1078`). Custom scenarios are appended to the guild config list `custom_scenarios` (default `[]`, `crime/data.py:84`) and are merged with the 46 built-in scenarios whenever a "random" crime rolls a scenario (`crime/scenarios.py:90-99, 106-108`) — an equal-weight `random.choice` over built-ins + customs.

**`add`** — a conversational Q&A in chat, **not** a modal. (An `AddScenarioModal` exists at `crime/views.py:1865-1974` but is never instantiated anywhere — dead code; do not implement a modal path.) Flow (`crime/commands.py:1080-1180`), each answer typed as a normal message by the invoking admin in the same channel:

1. Bot: `Let's create a new random scenario! I'll ask you for each piece of information.`
2. Bot: `What would you like to name this scenario? (e.g. cookie_heist)` — 30 s wait; answer lowercased.
3. Bot: `What risk level should this be? (low, medium, or high)` — 30 s wait per attempt; any other answer re-prompts `Please enter either 'low', 'medium', or 'high'.` in an unbounded loop.
4. Bot: `Enter the attempt text (use {user} for the user's mention):` — 60 s.
5. Bot: `Enter the success text (use {user} for the user's mention, {amount} for the reward amount, and {currency} for the currency name):` — 60 s.
6. Bot: `Enter the fail text (use {user} for the user's mention, {fine} for the fine amount, and {currency} for the currency name):` — 60 s.

Any timeout aborts with `❌ Scenario creation timed out. Please try again.`

Stats are fixed by risk level (`crime/commands.py:1130-1147`) — note the *low* success rate here is **0.7**, not the 0.75 used by built-in low-risk scenarios:

| Risk | success_rate | reward | jail_time | fine_multiplier |
|---|---|---|---|---|
| low | 0.7 | 100–300 | 180 s | 0.3 |
| medium | 0.5 | 300–800 | 300 s | 0.4 |
| high | 0.3 | 800–2,000 | 600 s | 0.5 |

Stored dict fields: `name`, `risk`, `min_reward`, `max_reward`, `success_rate`, `jail_time`, `fine_multiplier`, `attempt_text`, `success_text`, `fail_text` (`crime/commands.py:1150-1161`). Confirmation embed (`crime/commands.py:1168-1177`): title `✅ Custom Scenario Added!`, description `Your scenario '{name}' has been added to this server's random crime pool.`, color green, three inline fields — `Risk Level` (title-cased), `Success Rate` (`70%` style), `Reward Range` (`100 - 300`, thousands-separated).

**`list`** (`crime/commands.py:1182-1219`) — if none: `This server has no custom scenarios.` Otherwise an embed: title `📜 Custom Random Scenarios`, description `This server has {N} custom scenarios:`, color = configured embed color, one **non-inline** field per scenario named `🎲 {name}` with value:

```
**Risk Level:** {Risk}
**Success Rate:** {NN}%
**Reward:** {min:,} - {max:,}
**Jail Time:** {seconds} seconds
**Fine Multiplier:** {mult}
```

**`remove <scenario_name>`** (`crime/commands.py:1221-1238`) — case-insensitive name match, removes first hit: `✅ Removed custom scenario: {name}` or `❌ No custom scenario found with that name.`

#### `[p]crime jail <user> <minutes>` — manual jail

`crime/commands.py:1002-1055`. `minutes <= 0` → `❌ Jail time must be positive!` Otherwise jail time = `minutes * 60` seconds.

**Jail-reducer double dip (reproduce exactly):** if the target owns the `jail_reducer` perk, the command multiplies the time by 0.8 (`crime/commands.py:1024-1026`) and then `send_to_jail` multiplies by 0.8 **again** (`crime/commands.py:946-949`), so the target actually serves **64%** of the requested time while the embed displays the once-reduced 80% figure (both the duration text and the release timestamp use the once-reduced value).

Reply embed: title `⛓️ Manual Jail`, description `{user.mention} has been jailed by {admin.mention}!`, color red, two inline fields:
- `⏰ Sentence Duration` — `format_cooldown_time` output, with ` (Reduced by 20%)` appended for perk holders (`crime/commands.py:1037-1039`).
- `📅 Release Time` — Discord relative timestamp `<t:{now + jail_time}:R>`.

Side effects of `send_to_jail` (`crime/commands.py:944-965`): sets `jail_until`, resets `attempted_jailbreak`, records the invocation channel as `jail_channel`, and — if the member has release notifications enabled — schedules a message for sentence end: in the jail channel/thread `🔔 {mention} Your jail sentence is over! You're now free to commit crimes again.`, falling back to the DM `🔔 Your jail sentence is over! You're now free to commit crimes again.` (`crime/commands.py:994, 998`).

#### `[p]crime togglemycds` — admin cooldown self-toggle

`crime/commands.py:1240-1255`. Toggles the invoker's **own** per-member flag `cooldowns_disabled` (default `false`, `crime/data.py:105`); it cannot target anyone else. Replies (plain text): `Your crime cooldowns have been **disabled**.` / `Your crime cooldowns have been **re-enabled**.` While disabled, every cooldown lookup for that member returns 0 immediately, before timestamps are consulted (`base.py:98-103`).

#### Owner wipes

Both are **top-level** commands (not under `city`/`crime`), bot-owner only, and use plain-text prompts (no embeds).

**`[p]wipecitydata <user>`** (`base.py:359-423`) — prompt:

```
⚠️ Are you sure you want to wipe all city data for {user.display_name}?
This action cannot be undone and will remove all their stats, including:
• Crime records and cooldowns
• Jail status and history
• All statistics (successful crimes, failed crimes, etc.)
• All perks and items
• References in other users' data
```

Attached view (`ConfirmWipeView`, `base.py:229-266`): timeout **30 s**; buttons `Confirm Wipe` (danger/red) and `Cancel` (grey), no emoji; only the invoker may press them; both buttons disable on click or timeout. Outcomes: timeout → `❌ Wipe cancelled - timed out.`; cancel → `❌ Wipe cancelled.`; confirm → clears that member's config in **every guild the bot is in** and nulls any other member's `last_target` pointing at them, then `✅ Successfully wiped all city data for {user.display_name} across all guilds.` Errors: `❌ An error occurred while wiping data: {error}`.

**`[p]wipecityallusers`** (`base.py:425-488`) — prompt:

```
🚨 **GLOBAL CITY DATA WIPE** 🚨

You are about to wipe ALL city data for ALL users across ALL guilds.

This will permanently delete:
• All user statistics
• All crime records and cooldowns
• All jail records and history
• All perks and items
• All cross-user references
• All other city-related data

This action CANNOT be undone and will affect ALL users.
Are you sure you want to proceed?
```

View (`ConfirmGlobalWipeView`, `base.py:268-357`): timeout **30 s**; buttons `I Understand - Proceed to Confirmation` (danger) and `Cancel` (grey). Pressing the danger button: generates a random 6-character uppercase-letter phrase, removes the Cancel button, disables the pressed button, adds a **permanently disabled** danger button labeled `CONFIRM WIPE - Type "{PHRASE}"`, and edits the message content to:

```
⚠️ **FINAL WARNING**

To proceed with wiping ALL city data for ALL users, you must type:
```
{PHRASE}
```
This will permanently delete all user stats, crime records, and other city data.
You have 30 seconds to confirm.
```

It then waits **30 s** for a typed message from the invoker in the channel. **Reproduce this bug exactly:** the listener accepts only a message whose content lowercased equals `confirm` (`base.py:319-320`) — the displayed random phrase is never checked, so typing the phrase does nothing and typing `confirm` proceeds. Timeout → `❌ Global wipe cancelled - timed out.`; Cancel button → `❌ Global wipe cancelled.`; confirmed → clears every stored member record and resets every guild's config to defaults, then:

```
✅ Successfully wiped ALL city data:
• Cleared data for {N:,} users
• Reset settings in {M:,} guilds
```

Errors: `❌ An error occurred while wiping data: {error}`.

---

## Known gaps — completeness review

The independent critic flagged the following as missing or wrong in the sections above; treat these areas as "read the source" until filled:

MISSING
- `red_delete_data_for_user` (`base.py:71-81`) — Red's data-deletion API handler: clears member data via `member_from_ids(None, user_id)` (guild-id quirk: `None`, unlike the wipe command's per-guild loop) and nulls other members' `last_target` pointing at the user. No spec section covers it; a re-implementer would omit a required Red surface.
- Member config schema is never enumerated as a whole (`base.py:20-38` CONFIG_SCHEMA["MEMBER"] merged with `data.py:88-106` DEFAULT_MEMBER). Individual fields appear in passing, but a re-implementer cannot rebuild storage: registered-but-unused legacy keys (`jail_time`, `jail_started`, `cooldowns`), streak defaults (`current_streak` 0, `highest_streak` 0, `streak_multiplier` 1.0), and crucially `last_crime_time`, which `update_streak` reads/writes (`utils.py:254,271`) but is **never registered** — it only works because writes go through the `.all()` context.
- Config identity: `Config.get_conf(identifier=95932766180343808, force_registration=True)` (`base.py:46-50`); guild key `blackmarket_items: {}` registered but never read (`base.py:18`); guild/member defaults are registered a second time in `City.__init__` (`__init__.py:23-26`). Needed for data compatibility with the original cog.
- Notification-task volatility: `cog_unload` (`base.py:225-228`) cancels only `self.tasks` (always empty); pending release pings in `self.notification_tasks` are neither cancelled on unload nor persisted anywhere, so all scheduled pings are silently lost on cog reload/bot restart. The notify section documents cancellation edges but not this loss.

WRONG
- Committing §2 Target selection, Cancel/Timeout: spec says it "sends `Crime cancelled.`"/"sends `Target selection timed out.`, deletes tracked messages", implying the notice persists. In code the notice is itself appended to `all_messages` and then deleted by `cleanup_messages()`, leaving nothing behind (`crime/views.py:1617-1622` cancel, `crime/views.py:1635-1638` timeout) — the spec explicitly documents this self-deletion for BailView's cancel but describes the target-selection screens differently.

MINOR
- Entry §5 leaderboard spacer rule "(except a final one)": the code's condition is `field_count < len(stats)` — populated-so-far vs the fixed total of 6 categories (`crime/commands.py:689,724`), so a 5th-and-final populated field still gets a spacer when a category is empty (possible only when all top-3 of a category left the guild).
- Dead-code citations contradict the spec's own "jail.py must NOT be implemented" ruling: numeric model's "Used where" column cites `crime/jail.py:283,299`, and the black-market item table cites `crime/jail.py:59-66` for the jail_reducer effect; live sites are `crime/commands.py:403,398` and `crime/commands.py:947-949` (the latter correctly cited elsewhere).
- Command docstrings (user-visible via Red help) are mostly untranscribed — e.g. the `crime commit` bullet-list help (`crime/commands.py:85-101`), `crime`/`city` group docstrings, wipe-command docstrings, and the cog description "A virtual city where you can commit crimes, work jobs, and more." (`__init__.py:12`). Matters only if help output must match.
- Success-path nuance: on the post-roll target-balance abort (`crime/views.py:690-698`) `update_streak` has already run (`crime/views.py:668`), so the streak increments even though no transfer, stats, or cooldown happen. Spec says only "no cooldown is set".
- Unreachable code the spec silently skips (acceptable, listing for completeness): `format_crime_message`'s `is_attempt` greyple random embed (`crime/views.py:247-255`) and the no-target pickpocket/mugging success/fail descriptions (`crime/views.py:276-279,344-353`); `JailOptionsView.jailbreak` never calls `self.stop()` unlike `pay_bail` (`crime/views.py:1998-2024`).

Verification notes: all 26 commands and all 15 view/select/button/modal classes in the source are otherwise covered; no `@commands.Cog.listener` exists (the two `bot.wait_for` uses are covered). Programmatically re-verified at HEAD `2edfc7c`: 46 scenarios (13 low/20 medium/13 high, rates {0.75, 0.5, 0.3}, rewards 100-3,000/300-8,000, jail 1,800-14,400, fine 0.20-0.50), 14 prison breaks (all base 0.35, 12 events each), 24 events per crime × 4 crimes, and the three JSON dumps under `/home/user/CuffBot/src/modules/city/data/` exist and match (46/14/4×24). The "registered default only — never read" claims (default_jail_time, default_fine_multiplier, protect_low_balance, show_success_rate, show_fine_amount, enable_random_events) all verify against live code.
