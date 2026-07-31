# Heist — product spec of the Red cog (S137 screening)

> Commissioned by the owner: *"Ik wil een screening van de Red bot, niet van de node."* This documents how the
> **ltzmax/maxcogs `heist`** cog behaves for a Discord user — every command, screen, flow, text and number — derived from its
> source at HEAD (2026-07-31) by an 11-agent screening pass with per-cog completeness review. Since the pivot to
> Red-DiscordBot this is OPERATING documentation for the cog the precinct actually runs, not a rebuild spec.

### `[p]heist` — player command surface: args, gates, and confirm prompts

All file:line cites below are relative to the cog root `/tmp/claude-0/-home-user-CuffBot/e3ef2ed3-6be3-5dec-a23f-6e5a4b6fe792/scratchpad/maxcogs/heist/`. "{currency}" is the Red bank currency name of the guild, fetched per invocation.

**Bulk-data cross-reference.** All heist tuning numbers (24 heists), all 74 item definitions (costs, boosts, reductions, sell ranges) and all 28 craft recipes are already dumped verbatim in `/home/user/CuffBot/test/fixtures/heist-source-tables.json` (keys `HEISTS`, `ITEMS`, `RECIPES`). Spot-verified against Python HEAD: `casino_vault` (risk 0.20, reward 50,000–200,000, cooldown 5 h, success 10–40, duration 15 min, loss 20,000–100,000, police 0.35, jail 8 h, material drop 0.5, XP 120 — `utils.py:539-554`), `crew_robbery`, `gold_reserve` incl. `materialTiers`, `diamond_shield` (cost 35,000, reduction 0.12) and the `enhanced_elite_kit` recipe all match field-for-field (dump uses ms/hour conversions of the timedeltas). **The dump still matches HEAD** — reference it for every per-heist / per-item number not repeated below.

#### Command group

`[p]heist` is a **hybrid group** (prefix + slash), **guild-only**, help text `Heist game.` (`commands/user_commands.py:48-51`). Bare `[p]heist` does nothing itself (empty group callback). Subcommands: `start`, `crew`, `shop` (alias `shopping`), `equip`, `inventory` (alias `inv`), `sell`, `craft`, `shield`, `profile`, `level`, `cooldowns` (alias `cooldown`), `bailout`. **There is no `paydebt` command** — debt is settled exclusively through the Outstanding Debt confirm prompt that fires as a gate (below).

#### The shared confirm view (`ConfirmLayoutView`)

Used by both the debt and jail prompts (`views.py:459-492`, buttons `views.py:435-456`). It is a Components-v2 LayoutView: one Container holding a TextDisplay (the body text), a Separator, and an ActionRow with exactly two buttons:

- **`Yes`** — green (`ButtonStyle.success`), no emoji (`views.py:437`)
- **`No`** — red (`ButtonStyle.danger`), no emoji (`views.py:449`)

**Timeout: 60 seconds** (both callers pass `timeout=60`; `heist.py:204,248`). Only the invoker may click; anyone else gets an ephemeral `You are not the author of this.` (`views.py:486-492`). Any click disables the buttons and edits the message; on timeout the buttons disable and the caller replaces the view (below). Result messages replace the whole view with a plain Container/TextDisplay (`heist.py:43-46`).

#### Gate 1 — the DEBT prompt (`check_debt`, `heist.py:191-223`)

Runs on `start`, `crew`, and `shop`. If the player's `debt` ≤ 0 it passes silently. Otherwise a ConfirmLayoutView is sent with this exact body (`heist.py:198-203`):

```
## 💸 Outstanding Debt
You owe **{debt:,} {currency}** in debt.
Your current balance is **{balance:,} {currency}**.

Pay **{min(balance, debt):,} {currency}** now?
```

- **Timeout (60 s):** message becomes `Debt payment timed out.` — command aborts (`heist.py:208`).
- **No:** message becomes `Debt payment declined.` — command aborts (`heist.py:211`).
- **Yes:** withdraws `min(balance, debt)` from the bank, reduces debt by that amount, message becomes `Paid **{pay_amount:,}** {currency} towards your debt. (**{remaining_debt:,}** {currency} remaining.)` (`heist.py:213-222`). The gate passes **only if remaining debt is exactly 0** (`heist.py:223`) — a partial payment (balance < debt) still blocks the command this turn. With balance 0 the player can "pay" 0 and stays blocked.

#### Gate 2 — the JAIL prompt (`check_jail`, `heist.py:225-276`)

Runs on every subcommand except `profile` and `level`. Target is the invoker, except via `bailout` where it can be another member. If the target is a bot: `Bots can't be in jail!` and abort (`heist.py:227-229`). Jail auto-expires: `_is_in_jail` clears the record once `end_time` has passed (`heist.py:163-171`). If not in jail the gate passes silently.

If jailed: `tax = int(bail_amount * 0.15)`, `total_bail = bail_amount + tax`. ConfirmLayoutView body (`heist.py:241-247`) — heading is `## 🚨 Behind Bars` for self, `## 🚨 Bail Request` for someone else; the first line starts `You are` (self) or `**{jailed display_name}** is`:

```
## 🚨 Behind Bars
You are in jail until <t:{end_timestamp}:f> (<t:{end_timestamp}:R>).

**Bail amount:** {bail_amount:,} + {tax:,} (15% tax) = **{total_bail:,}** {currency}
**Your balance:** {balance:,} {currency}

Pay bail now?
```

- **Timeout (60 s):** `Bailout timed out.` — abort (`heist.py:252`).
- **No:** `Bailout declined.` — abort (`heist.py:255`).
- **Yes, insufficient funds** (checked only after confirming): `You need **{total_bail:,}** {currency} to bail out {'yourself' | jailed display_name}, but you only have **{balance:,}**.` — abort (`heist.py:257-265`).
- **Yes, funds available:** withdraws `total_bail` from the **invoker**, clears the jailed user's jail record, resets their `heat` and `material_heat` to 0, message becomes `{invoker mention} paid **{total_bail:,}** {currency} - {'you are' | '{name} is'} free!` and the gate passes (`heist.py:266-276`).

#### Gate 3 — active heist (`_has_active_heist`, `heist.py:150-161`)

If a stored heist's `end_time` has already passed, the heist is **resolved on the spot** (outcome posted to its original channel) and the gate passes; otherwise the command aborts with a per-command refusal line (quoted under each command).

---

#### `[p]heist start` — no arguments (`commands/user_commands.py:93-151`)

Gate order: **debt → jail → active heist** (`You have an active heist ongoing. Wait for it to finish.`). Then each equipped slot (`shield`, `tool`, `consumable`) whose item count in inventory is ≤ 0 is silently unequipped, and one plain message lists (newline-joined): `Your equipped {item_type} ({Item Name}) is out of stock and will not be used.` (`user_commands.py:106-116`). Finally the heist **picker** opens (`HeistSelectionView` — specced in the views section): it is built from all non-crew heists (any heist with `crew_size` is excluded, `user_commands.py:121-122`), each merged with owner overrides, and receives the player's level (`get_level(xp)`). Per-heist cooldowns are enforced inside the picker, not here.

#### `[p]heist crew` — no arguments (`commands/user_commands.py:153-186`)

Guild-only, help text: `Organise a 4-player crew robbery for massive rewards.` Gate order: **debt → jail → level → active heist**. Level gate: level < 20 → `You must be **level 20** or higher to organise a crew robbery.` (`user_commands.py:167-169`). Active-heist refusal: `You have an active heist ongoing. Wait for it to finish.` Passing all gates immediately writes an active-heist record `{type: "crew_robbery", end_time: now + duration (20 min), channel_id, lobby: true}` (`user_commands.py:176-184`) and opens the `CrewLobbyView` (views section). Crew numbers: see `crew_robbery` in the fixture dump (crew size 4, reward 1,000,000–80,000,000 split equally, cooldown 8 h, jail 16 h).

#### `[p]heist shop` (alias `shopping`) — no arguments (`commands/user_commands.py:73-91`)

Gate order: **jail → debt → active heist** (note: jail *before* debt, the reverse of `start`/`crew`). Active-heist refusal: `You cannot go shopping while on a heist.` Opens the `ShopView` with the live cost of every item that has a `cost` field (owner-overridable via `get_item_cost`, `heist.py:315-319`; defaults in the fixture dump).

#### `[p]heist equip` — no arguments (`commands/user_commands.py:53-71`)

Gates: **jail → active heist** (`You have an active heist ongoing. You can't equip during a heist.`). No debt gate. Opens the `EquipView` (per-slot selects + unequip buttons — views section). There is no separate `unequip` command; unequipping happens inside this view.

#### `[p]heist inventory` (alias `inv`) — no arguments (`commands/user_commands.py:196-263`)

Gates: **jail → active heist** (`You have an active heist ongoing. You can't check inventory during heist` — no trailing period). Empty inventory and debt ≤ 0 → `Your inventory is empty and you have no debt.` Otherwise a LayoutView (**timeout: none**, non-interactive) containing one Container:

- Header TextDisplay: `## 🎒 {display_name}'s Inventory`
- If debt > 0: Separator, then `**💸 Debt:** {debt:,} {currency}`
- Then, for each non-empty section **in this fixed order** — `🛡️ Shields`, `🔧 Tools`, `💊 Consumables`, `💰 Loot`, `🧱 Materials` — a Separator and a TextDisplay: `**{section name}**` followed by one block per item: `**{emoji} {Item Name} ×{count}** *(equipped)*` (the ` *(equipped)*` suffix only if that item fills the shield/tool/consumable slot) plus a sub-line by type (`user_commands.py:231-248`):
  - shield: `-# Reduces loss by {reduction×100:.1f}% (single use)` (one decimal)
  - tool: `-# +{boost×100:.0f}% success on {Heist Name} (single use)` (whole number)
  - consumable: `-# Reduces risk by {risk_reduction×100:.0f}% (single use)`
  - loot: `-# Sell for {min_sell:,}–{max_sell:,} {currency}` (en dash)
  - material: `-# Craft or sell for {min_sell:,}–{max_sell:,} {currency}`
  - unknown item id: goes in the Loot section with `❓` and no sub-line.

#### `[p]heist sell <item> [amount]` (`commands/user_commands.py:265-292`)

Args: `item` (string; lowercased, spaces → underscores), `amount` (int, default **1**; no lower-bound validation). Gates: **jail → active heist** (`You have an active heist ongoing. You can't sell while on heist.`). Errors: unknown item or type not loot/material → `Invalid item type. Only loot and materials can be sold.`; owned count < amount → `You don't have enough {Item Name} to sell.` Sale price = the **sum of `amount` independent uniform draws** of `randint(min_sell, max_sell)` for that item (each unit rolled separately, `user_commands.py:283`). Credits deposited, stock decremented (entry deleted at 0), then: `Sold {amount} {Item Name} for {sell_price:,} {currency}.`

#### `[p]heist craft` — no arguments (`commands/user_commands.py:294-307`)

Gates: **jail → active heist** (`You have an active heist ongoing. You can't craft while on heist.`). Opens the `CraftView` (views section). Recipes/materials: `RECIPES` in the fixture dump.

#### `[p]heist shield` — no arguments (`commands/user_commands.py:309-325`)

Gate: **jail** only. If a shield is equipped and in stock: `Active {emoji} {Shield Name} shield: Reduces loss by {reduction×100:.1f}% (single use). You have {count}.` Otherwise: `No active shield.`

#### `[p]heist profile` — no arguments (`commands/user_commands.py:327-374`)

**No gates** (usable while jailed or mid-heist). Shows a typing indicator, then a LayoutView (**timeout: none**) with one Container/TextDisplay built from these lines:

1. `## 📊 {display_name}'s Profile`
2. Active heist: `**🎭 Active Heist:** {Heist Name}` + newline + `Completes <t:{end}:R> (<t:{end}:f>)`, or `**🎭 Active Heist:** None`
3. Jail: if still jailed — `**🚨 In Jail** until <t:{end}:f> (<t:{end}:R>)` + newline + `-# Bail: {bail:,} + {tax:,} tax = {bail+tax:,}` (tax = int(bail × 0.15)); an expired record is cleared and shows `**🚨 Jail:** Free`, as does no record.
4. `**📈 Heist Stats**` + newline + `✅ Success: {n}` / `❌ Failed: {n}` / `🚨 Caught: {n}` / `Total: {sum}` (humanized numbers)
5. `**🌡️ Heat:**` + newline + heat bar: a 20-character `●`/`○` bar in backticks followed by ` {pct:.0f}%`, where filled = round(heat/20 × 20) and pct = heat/20 × 100, both capped at 20 chars / 100% (max heat displayed = 20; `user_commands.py:37-42`). The heat shown is the **effective** heat: it decays 1 point per 2 full hours since last change, persisted on read (`heist.py:173-189`).

#### `[p]heist level [member]` (`commands/user_commands.py:376-408`)

Arg: `member` (defaults to the invoker; can inspect anyone). **No gates.** Typing indicator, then a LayoutView (**timeout: none**) with:

1. `## 🎓 {display_name}'s Level`
2. `**Level {lvl}** / 120` (MAX_LEVEL = 120, `leveling.py:32`)
3. XP bar: 20-char `●`/`○` bar in backticks + ` {pct×100:.1f}%` (`leveling.py:95-99`) followed by ` {into}/{span} XP` (humanized; progress within the current level)
4. `-# {xp_needed} XP until level {lvl + 1}`, or at level 120: `-# Max level reached!`
5. If level ≥ 1 bonus > 0: `**Bonus:** +{bonus×100:.0f}% success chance on all heists`; the bonus is +0.5% per level capped at +20% (reached at level 40, `leveling.py:87-92`). If the bonus is 0 (never at level ≥ 1 in practice): `-# Earn XP by completing heists to gain success bonuses (+0.5% per level, max +20% at Lv.40)`

XP curve (`leveling.py:40-48`): XP to climb from level n to n+1 is `floor(100·n·(1 + 0.12·n))` (level 1→2 = 212 XP; thresholds are cumulative from 0 at level 1).

#### `[p]heist cooldowns` (alias `cooldown`) — no arguments (`commands/user_commands.py:410-456`)

Typing indicator, then gate: **jail** only. LayoutView (**timeout: none**), one Container: header `## ⏱️ Heist Cooldowns`; then, if any, a Separator + `**On Cooldown**` section listing `**{emoji} {Heist Name}** - <t:{ready_ts}:R>` per cooling heist, and a Separator + `**Ready**` section listing `**{emoji} {Heist Name}** - ✅ Ready`. Heists are sorted alphabetically by display name; crew heists are excluded. Fallback if both lists were empty (unreachable in practice): `All heists are ready!`

#### `[p]heist bailout [member]` (`commands/user_commands.py:188-194`)

Arg: `member` (defaults to self). If the target is not jailed (or their sentence expired): `{display_name} is not in jail!` Otherwise it runs the **JAIL confirm prompt** above against that target — the *invoker's* balance pays the bail + 15% tax, and on success the target's jail clears and both heat counters reset to 0.

#### Bot-permission requirements

`start`, `shop`, `inventory`, `cooldowns` require the bot to have Embed Links; `equip`, `craft`, `crew` require Embed Links + Send Messages (`user_commands.py:54,74,94,154-155,197,295,411`). `sell`, `shield`, `profile`, `level`, `bailout` declare none.

---

### Views & Interactive Screens (heist cog)

All citations are to `/tmp/claude-0/-home-user-CuffBot/e3ef2ed3-6be3-5dec-a23f-6e5a4b6fe792/scratchpad/maxcogs/heist/` (abbreviated `heist/`). Placeholder `{currency}` = the Red bank currency name for the guild.

**Data-dump status:** `/home/user/CuffBot/test/fixtures/heist-source-tables.json` (24 HEISTS / 74 ITEMS / 28 RECIPES) still matches HEAD of the Python source. Spot-verified: `crew_robbery` — all 15 fields incl. cooldown 8 h = 28,800,000 ms, duration 20 min, jail 16 h, reward 1,000,000–80,000,000, loss 80,000–300,000, success 8–35 %, police 0.45, risk 0.30, material drop 0.6, XP 300, crew size 4 (`heist/utils.py:683-699`); `wooden_shield` cost 3,000 / reduction 0.03 (`heist/utils.py:34-36`); `enhanced_bank_drill` recipe 3× rare_alloy + 2× military_grade_alloy → 1 (`heist/utils.py:430-434`). All per-heist/item/recipe numbers below that are not restated here come from that fixture.

#### Components-v2 conventions (apply to every view except `_ConfirmDebtView`)

- Every screen is a `discord.ui.LayoutView` whose entire content is ONE `Container` holding: a `TextDisplay` (markdown body — `##` heading line, `-#` small-text sub-lines), a `Separator`, then one or more `ActionRow`s of controls (e.g. `heist/views.py:265-271`). No accent colour is ever set on the container.
- Because these are Components-v2 messages, **there are no embeds anywhere in this cog's views** — no embed colour, no fields, no thumbnail/image, no footer. "Title" is always a `## …` markdown line inside the body text.
- Every timed view's `on_timeout` rebuilds itself with **all components disabled** and edits the message in place; the text body stays visible (e.g. `heist/views.py:281-285`).
- Name formatting: `fmt()` replaces underscores with spaces and title-cases (`crew_robbery` → `Crew Robbery`, `atm_smash` → `Atm Smash`) (`heist/utils.py:28-30`).
- Shared display helpers (`heist/views.py:49-64`):
  - **Risk indicator** — `combined = police_chance + risk`: `< 0.15` → `🟢 Low`; `< 0.35` → `🟡 Medium`; `< 0.55` → `🟠 High`; else `🔴 Extreme`.
  - **Cooldown display** — under 1 h: floor-minutes + `m` (45 min → `45m`); otherwise hours to 1 decimal + `h` (8 h → `8.0h`).

---

#### HeistSelectionView — the heist picker (`heist/views.py:190-285`)

Opened by `heist start` as a public message; crew-size heists are filtered out by the caller, so it lists the **23 solo heists** (`commands/user_commands.py:118-151`). **Timeout: 120 s** (`heist/views.py:199`). Only the invoker and bot owners may interact; anyone else gets ephemeral `You are not allowed to use this interaction.` (`heist/views.py:273-279`).

**Paging:** 7 heists per page (`HEISTS_PER_PAGE = 7`, `heist/views.py:42`) → 4 pages (7/7/7/2). Nav row: `◀` (secondary), a permanently-disabled secondary counter button labelled `{page}/{total}` (e.g. `1/4`), `▶` (secondary). `◀` is disabled on page 1, `▶` on the last page (`heist/views.py:255-263`). Paging edits the message in place.

**Body:** heading `## 🎯 Choose Your Heist`, then per heist two lines (`heist/views.py:224-240`):

```
**{emoji} {Heist Name}** - {risk indicator}
-# Reward: {reward} · Success: {min}–{max}% · Cooldown: {cd} · Duration: {N}m
```

- **Reward:** normally `{min_reward:,}–{max_reward:,} {currency}`. If the heist name is also a loot-type item (`street_bike` 1,500–3,500; `street_motorcycle` 8,000–12,000; `street_car` 20,000–30,000), it instead shows the loot sell band suffixed ` (loot)` (`heist/views.py:226-230`).
- **Success:** the viewer's level bonus is baked into the displayed numbers: `min(base + int(bonus×100), 100)` where bonus = `min(level × 0.5%, 20%)` — +0.5 %/level, capped +20 % at level 40 (`heist/views.py:234-235`, `heist/leveling.py:87-92`). A `+X% from Lv.N` string is computed but **never displayed** (dead variable, `heist/views.py:218-222`).
- **Duration:** whole floor minutes + `m`.

**Select:** placeholder `Choose your target...`; one option per heist on the current page — label = formatted name, emoji = heist emoji, description = the risk indicator string (`heist/views.py:90-93, 242-250`).

**Selecting a heist** (`heist/views.py:95-174`) — response is deferred ephemeral, then gates fire in order (all ephemeral):
1. Already busy → `You have an active heist ongoing. Wait for it to finish.` (an open crew lobby also counts — see lobby placeholders below).
2. Per-heist cooldown not elapsed → `On cooldown! Ready <t:{end}:R>.`
3. **Debt confirmation** if balance < the heist's `max_loss` (`heist/views.py:123-139`): ephemeral prompt with `_ConfirmDebtView` (below), text:
   > `⚠️ Your balance ({balance:,} {currency}) is too low to cover a potential loss of up to {max_loss:,} {currency}.`
   > `If you fail, you will owe up to **{total_debt:,}** {currency} (including 20% tax).`
   > `-# The final amount is calculated after the heist.`
   where `tax = int(max_loss × 0.2)` and `total_debt = max_loss + tax`. Declining or letting it time out edits the prompt to `Heist cancelled.` (buttons removed).
4. On go: the cooldown timestamp is stamped **now** (cooldown runs from heist start, not resolution), the active heist is saved, and a **public, never-expiring** `_HeistStartedView` is posted (`heist/views.py:154-155, 177-187`, timeout `None`):
   ```
   ## {emoji} {Heist Name} - In Progress
   You're in. No turning back now.

   **Results:** <t:{end}:R> (<t:{end}:f>)
   **Success chance:** {min_success}–{max_success}%
   **Potential loss:** {min_loss:,}–{max_loss:,}
   ```
   Note: this card shows the **base** success band (no level bonus) and the loss line has **no currency name** — reproduce verbatim. Resolution is scheduled after the heist's duration.
5. Finally every component of the picker is disabled — **one launch per picker**; run the command again for another heist (`heist/views.py:171-174`).

**On timeout:** all components disabled in place.

#### `_ConfirmDebtView` (`heist/views.py:495-534`)

The only classic (non-v2) view in the cog: plain text message + two buttons, **timeout 60 s**. Buttons: `Proceed anyway` (danger/red) and `Cancel` (secondary/grey). Pressing either disables both and stops; timeout counts as "not confirmed". Only the prompted user may press; others get ephemeral `You are not the author of this.`

---

#### ShopView (`heist/views.py:288-432`)

Public message, **timeout 120 s**; invoker + bot owners only (`You are not allowed to use this interaction.`, `heist/views.py:420-426`).

**Sections (pages):** exactly two, from `_ALL_SHOP_PAGES` (`heist/views.py:43-46`): `🛡️ Shields` (6 items) and `🔧 Tools` (23 items). A section renders only if at least one item of that type has a `cost` (`heist/views.py:351-355`). **Consumables are never sold** — the code contains a consumable row/description branch (`heist/views.py:378-379, 393`) but no consumable page exists, so it is unreachable; consumables enter inventory only via crafting/drops. Item costs are the config-resolved (owner-adjustable) prices, re-fetched on every page turn (`heist/views.py:301-305`).

**Body:** heading `## 🛒 Heist Shop - {section label}`, then per item (`heist/views.py:370-380`):

```
**{emoji} {Item Name}** - {cost:,} {currency}
-# Reduces loss by {X.X}% (single use)          ← shields (1 decimal)
-# +{X}% success on {Heist Name} (single use)   ← tools (whole number)
```

**Select:** placeholder `Select an item to purchase...`, max 25 options; option description = `Reduces loss by {X.X}%` (shield) or `+{X}% for {Heist Name}` (tool) (`heist/views.py:310-313, 382-398`). **Nav row:** same `◀` / disabled `{page}/{total}` counter / `▶` pattern as the heist picker (`heist/views.py:402-410`).

**Buy flow** (`heist/views.py:315-340`): instant on select — **no confirmation step and no "already owned" gate** (duplicates simply stack in inventory; the only gate is funds):
- Insufficient: ephemeral `Not enough funds. Need **{cost:,}** {currency}, you have **{balance:,}**.`
- Success: credits withdrawn, inventory count +1, ephemeral `Purchased {emoji} **{Item Name}** for **{cost:,}** {currency}. Added to inventory.`, and then **every shop component is disabled** — the shop closes after a single successful purchase; reopen to buy again. A failed (insufficient-funds) attempt leaves the shop open.

---

#### ConfirmLayoutView — generic v2 Yes/No (`heist/views.py:459-492`)

Used for confirmations such as bail payment (`heist/heist.py:241-250`). One container: `TextDisplay(body)`, `Separator`, ActionRow with `Yes` (success/green) and `No` (danger/red). **Timeout: constructor parameter, default 60 s** (callers pass 60). Pressing either disables both buttons, records the choice, stops the view; timeout records "no answer" and disables. Only the addressed user may press; others: ephemeral `You are not the author of this.`

---

#### EquipView (`heist/views.py:1156-1314`)

**Timeout 120 s.** Strictly author-only (bot owners NOT exempt): ephemeral `This isn't your equipment panel.` (`heist/views.py:1300-1306`).

**Body** (`heist/views.py:1263-1275`):
```
## ⚙️ Equipment
**Shield:** {emoji} {Item Name}   (or **Shield:** *None*)
**Tool:** …
**Consumable:** …
```

Then `Separator`, three slot selects (one ActionRow each, order shield → tool → consumable), `Separator`, and one row of three unequip buttons.

- **Slot selects** (`heist/views.py:1156-1197`): placeholder `Equip a 🛡️ Shield...` / `Equip a 🔧 Tool...` / `Equip a 💊 Consumable...`; options are inventory items of that type with count > 0 (max 25), label = item name, emoji = item emoji, description from `_equip_desc` (`heist/views.py:1238-1247`): shield `Reduces loss by {X.X}%`, tool `+{X}% for {Heist Name}`, consumable `Reduces risk by {X}%`. The currently equipped item is pre-selected (`default=True`). If the slot has no candidates the select renders **disabled** with placeholder `No shields in inventory` / `No tools in inventory` / `No consumables in inventory` and a single dummy option labelled `None`.
- **Selecting** an item sets that slot immediately (no confirmation, item not consumed at equip time — it is single-use at resolution) and re-renders the panel in place; the view stays open (`heist/views.py:1199-1210`).
- **Unequip row:** three secondary buttons `Unequip Shield`, `Unequip Tool`, `Unequip Consumable`; each disabled while its slot is empty; pressing clears the slot and re-renders (`heist/views.py:1213-1235`).

**On timeout:** re-fetches inventory/equipped, rebuilds disabled (`heist/views.py:1308-1314`).

---

#### CraftView (`heist/views.py:1317-1501`)

**Timeout 120 s.** Author-only: ephemeral `This isn't your crafting panel.` (`heist/views.py:1489-1495`).

**Paging:** 10 recipes per page (`RECIPES_PER_PAGE = 10`, `heist/views.py:1415`); 28 recipes → 3 pages. Nav buttons `Previous` (emoji ◀️) and `Next` (emoji ▶️), secondary style, each rendered **only when applicable** (no counter button here); the `Craft` button sits in the same row (`heist/views.py:1474-1479`).

**Body:** heading `## 🔨 Crafting - Page {p}/{n}`, then per recipe (`heist/views.py:1442-1450`):
```
**{emoji} {Recipe Name}** ✅        (✅ if every material owned in quantity, else ❌)
-# {qty}× {Material} ({owned} owned) · {qty}× {Material} ({owned} owned)
```
Recipe emoji comes from the result item, fallback `🔨`. If a recipe is selected, a detail block is appended (`heist/views.py:1452-1465`):
```
**Selected:** {emoji} {Recipe Name} ✅ Ready to craft      (or ❌ Missing materials)
-# {Material}: need {q}, have {n}
```

**Select:** placeholder `Choose a recipe...`, options from the **current page only** (max 25), description = comma-joined material list `{qty}× {Material}, …` truncated at 100 chars (`heist/views.py:1317-1333, 1410-1412`). Selection persists when paging away.

**`Craft` button:** success/green, emoji 🔨, label `Craft`; disabled until a recipe is selected AND currently craftable (`heist/views.py:1467-1473`). On press it re-verifies materials:
- Missing: ephemeral `Missing materials: {Material} (need {q}, have {n}), …` (`heist/views.py:1359-1367`).
- Success: materials deducted (entries dropping to 0 removed), result added × recipe quantity, panel re-renders **and stays open**, plus ephemeral `✅ Crafted **{qty}× {Result Name}**!` (`heist/views.py:1369-1384`).

---

#### CrewLobbyView + crew flow (`heist/views.py:935-1153`)

Opened by `heist crew` (guild-only). Command-level gates before the lobby appears: debt cleared, not jailed, **level ≥ 20** (`You must be **level 20** or higher to organise a crew robbery.`), no active heist (`commands/user_commands.py:153-186`). The command immediately stores a placeholder active-heist for the organiser (`lobby: true`, end = now + 20 min) so they can't start anything else.

**Constants:** `CREW_SIZE = 4`, **lobby timeout 180 s** (`heist/views.py:40-41, 1097`). The organiser fills slot 1 instantly.

**Body** (`heist/views.py:1110-1128`) — with stock `crew_robbery` numbers shown:
```
## 👥 Crew Robbery - Lobby
Need 4 players to begin. Lobby closes <t:{creation+180}:R>.

**Potential haul:** 1,000,000–80,000,000 {currency}
**Split:** ~250,000-20,000,000 per person          (integer-division min//4 - max//4; note hyphen, not en-dash)
**Risk:** 🔴 Extreme                               (police 0.45 + risk 0.30 = 0.75)

**1.** {display name} ✅
**2.** *Waiting...*
**3.** *Waiting...*
**4.** *Waiting...*
```

**Buttons** (one ActionRow): `Join Crew` (success/green, emoji 🤝, disabled at 4/4) and `Begin Heist ({filled}/4)` (danger/red, emoji 🚀, disabled until 4/4; label live-updates) (`heist/views.py:1130-1134`). **No view-level user gate** — anyone in the channel may press; the callbacks gate.

**`Join Crew` checks, in order** (all ephemeral, `heist/views.py:945-996`):
1. `You're already in the crew as the organiser.`
2. `You've already joined this crew.`
3. `The crew is already full.`
4. In jail → `You can't join a heist while in jail.`
5. Debt > 0 → `You have outstanding debt of {debt:,}. Pay it off first.`
6. Active heist → `You already have an active heist.`
7. Level < 20 → `You must be **level 20** or higher to join a crew robbery.`

On success: slot fills with `{display name} ✅`, a placeholder active-heist (`lobby: true`, end = lobby expiry) is stored for the joiner (blocking them from solo heists while the lobby is open), and the lobby message re-renders in place.

**`Begin Heist` checks** (`heist/views.py:1009-1032`): non-organiser → `Only the organiser can begin the heist.`; under 4 → `Need 4 crew members. Currently {n}/4.`; then every member is re-checked: jailed → `{display name} just got thrown in jail. Crew disbanded.`; active heist → `{display name} started another heist. Crew disbanded.`

> **Source defect to be aware of (verify intent before re-implementing exactly):** `_has_active_heist` (`heist/heist.py:150-161`) does not exempt `lobby`-flagged placeholders, and both the organiser (end = now+20 min) and every joiner (end = lobby expiry) hold one while the lobby is open. At HEAD, pressing `Begin Heist (4/4)` therefore always trips the active-heist re-check on the first member and reports `{organiser} started another heist. Crew disbanded.` The evident intent is that lobby placeholders be excluded from the Begin re-check.

**On successful begin** (`heist/views.py:1034-1075`): each member's active heist is set for real (20-min duration), the lobby re-renders fully disabled, and a **public, never-expiring** `_CrewStartedView` is posted (`heist/views.py:1078-1090`):
```
## 👥 Crew Robbery - In Progress
The crew is in. No turning back now.

**Crew:** {name}, {name}, {name}, {name}
**Results:** <t:{end}:R> (<t:{end}:f>)
**Potential haul:** 1,000,000–80,000,000 {currency} (split 4 ways)
**Potential loss:** 80,000–300,000 {currency} (split 4 ways)
```
Resolution is scheduled for all four after the 20-min duration.

**Lobby timeout (180 s):** all components disabled in place, and every member's `lobby`-flagged placeholder active-heist is cleared (`heist/views.py:1143-1153`).

---

#### HeistConfigView — owner settings panel (`heist/views.py:537-780`)

**Timeout 180 s.** Bot owners only: ephemeral `You are not authorized to use this.` (`heist/views.py:768-774`).

**Body:** heading `## ⚙️ Heist Settings`. Before any selection: `-# Select a heist and parameter to edit its value.` After picking a heist: `**{emoji} {Heist Name}**` followed by one `-# {Label}: {value}` per parameter, with ` ◄` appended to the currently selected parameter (`heist/views.py:717-746`). Value formats: risk/police `{X}%` (0 decimals), timedeltas `{N}s`, ints thousands-separated. Loot-type heists show reward rows as `{min_sell:,}–{max_sell:,} (loot sell)`. Note: the summary shows **default** table values (`HEISTS`), not config overrides.

**Controls:** select `Select a heist...` (all 24 heists incl. crew, capped 25, emoji fallback ❓); select `Select a parameter...` — the 9 parameters with labels/hints from `_PARAM_META` (`heist/meta.py:1-11`): `Risk (%)`, `Police Chance (%)`, `Min Success (%)`, `Max Success (%)` (hint `0–100`), `Min Reward`, `Max Reward` (hint `credits`), `Cooldown`, `Duration`, `Jail Time` (hint `seconds`); button `Set Value` (primary/blurple, emoji ✏️, disabled until both selects have values, `heist/views.py:585-593`).

**`Set Value` modal** (`heist/views.py:613-702`): title `{Heist Name} - {Label}`; single text input labelled `New Value`, max length 12, placeholder `Current: {current} ({hint})` — current shown as percent ×100 with 1 decimal for risk/police, whole seconds for the three durations. Validation (ephemeral):
- Non-numeric: `That must be a member.` (verbatim — yes, this odd string)
- Risk/police (entered 0–100) or success out of range: `{Label} must be between 0 and 100.`
- Negative int: `{Label} cannot be negative.`
- Cooldown/jail < 60 s: `{Label} must be at least 60 seconds.` Duration < 30 s: `Duration must be at least 30 seconds.`
- Cross-checks: `Max reward cannot be less than min reward ({min:,}).` / `Min reward cannot be greater than max reward ({max:,}).` / `Max success cannot be less than min success ({min}).` / `Min success cannot be greater than max success ({max}).`
- Success: ephemeral `✅ Set **{Label}** for **{Heist Name}** to **{display}**.` (risk/police display `{X.X}%`, others thousands-separated). The panel itself does not auto-refresh after a modal submit.

---

#### ItemPriceConfigView — owner price panel (`heist/views.py:783-932`)

**Timeout 180 s**; owners only (`You are not authorized to use this.`). Lists the **29 purchasable items** (6 shields + 23 tools), **25 per page** → 2 pages.

**Body:** heading `## 💰 Item Prices - Page {p}/{n}`; rows `-# {emoji} {Item Name}: {cost:,}` with ` ◄` on the selected item (`heist/views.py:893-901`). Note: rows show the **default** table cost; the modal placeholder shows the current (config-resolved) cost.

**Controls:** select `Select an item...` (current page's items); nav buttons `Previous` ◀️ / `Next` ▶️ (secondary, rendered only when applicable — no counter button); `Set Price` (primary, ✏️, disabled until an item is selected) (`heist/views.py:808-844, 903-909`).

**`Set Price` modal** (`heist/views.py:847-873`): title `Set Price - {Item Name}`; input labelled `New Cost`, max length 12, placeholder `Current: {current:,}`. Error: ephemeral `Must be a non-negative integer.` Success: ephemeral `✅ Set **{Item Name}** price to **{value:,}**.`

---

#### Timeout summary

| View | Timeout | After timeout |
|---|---|---|
| HeistSelectionView | 120 s | all components disabled in place |
| `_HeistStartedView` / `_CrewStartedView` | none (permanent) | — |
| ShopView | 120 s | disabled in place |
| ConfirmLayoutView | caller-set, default 60 s | disabled; counts as "no answer" |
| `_ConfirmDebtView` | 60 s | disabled; heist cancelled (`Heist cancelled.`) |
| EquipView | 120 s | re-fetch state, disabled in place |
| CraftView | 120 s | disabled in place |
| CrewLobbyView | 180 s | disabled in place + lobby placeholder active-heists cleared |
| HeistConfigView | 180 s | disabled in place |
| ItemPriceConfigView | 180 s | disabled in place |

---

### Heist Resolution — In-Progress Card, Timer, and Result Announcements

All paths below are relative to the cog root `/tmp/claude-0/-home-user-CuffBot/e3ef2ed3-6be3-5dec-a23f-6e5a4b6fe792/scratchpad/maxcogs/heist/`. Heist names shown to users are always rendered by `fmt()` — underscores become spaces, Title Case (`utils.py:28-30`), e.g. `pocket_steal` → "Pocket Steal". All cards in this flow are Components-v2 `LayoutView`s (a single Container; "accent colour" is the colored strip on the container's left edge — the Components-v2 equivalent of an embed color).

**Fixture note:** `/home/user/CuffBot/test/fixtures/heist-source-tables.json` (24 heists, 74 items, 28 recipes) still matches this cog at HEAD — spot-verified `HEISTS.gold_reserve` (cooldownMs 21600000 = 6 h, durationMs 1080000 = 18 min, jailMs 36000000 = 10 h, rewards 3,000,000–4,000,000, loss 40,000–180,000, success 6–28, police 0.38, materialDropChance 0.45, materialTiers, xpReward 130) against `utils.py:780-796`, and `ITEMS.street_bike` (loot, sell 1,500–3,500) against `utils.py:106` — all identical. Reference that file for the full per-heist number tables; every number *not* in it is given below.

#### 1. The In-Progress Card (solo)

When the player picks a target from the "Choose your target..." select and passes all gates, the heist starts immediately: the per-heist cooldown timestamp is recorded **at start, not at resolution** (`views.py:141-142`), `active_heist = {type, end_time, channel_id, tax_agreed}` is stored (`views.py:145-152`), and a **public** (non-ephemeral) card is posted as a followup while every component of the selection message is disabled (`views.py:154-155, 171-174`).

The card (`_HeistStartedView`, `views.py:177-187`): LayoutView, **timeout None**, one Container with **no accent colour**, containing exactly one TextDisplay:

```
## {emoji} {Heist Name} - In Progress
You're in. No turning back now.

**Results:** <t:{end_ts}:R> (<t:{end_ts}:f>)
**Success chance:** {min_success}–{max_success}%
**Potential loss:** {min_loss:,}–{max_loss:,}
```

Notes for exact reproduction: the **Potential loss** line has **no currency name**; the **Success chance** line shows the raw table range (no level/tool bonus applied); the card contains **no gear lines and no police %** — nothing else is on it. `end_ts = start + duration` from the heist table.

If the player's balance was below the heist's `max_loss`, starting first required the ephemeral debt warning (`views.py:123-139`): text "⚠️ Your balance ({balance:,} {currency}) is too low to cover a potential loss of up to {max_loss:,} {currency}.\nIf you fail, you will owe up to **{total_debt:,}** {currency} (including 20% tax).\n-# The final amount is calculated after the heist." where `total_debt = max_loss + int(max_loss*0.2)`, with buttons **"Proceed anyway"** (danger) / **"Cancel"** (secondary), timeout 60 s (`views.py:495-518`); decline or timeout edits it to "Heist cancelled." Accepting sets `tax_agreed=True` on the active heist, which matters at resolution (§3).

#### 2. The Timer — how the result gets delivered

- **Primary path:** starting a heist spawns an asyncio task (`schedule_resolve`, `handlers.py:89-113`) that sleeps exactly `duration` seconds, then runs `resolve_heist` in the **channel where the heist was started**. One task per user in `cog.pending_tasks`; starting again cancels a duplicate (`views.py:157-169`).
- **Lazy path:** every command gate calls `_has_active_heist` (`heist.py:150-161`); if the stored `end_time` has passed, the heist is resolved right then, posting to the original channel, with the channel the user is currently typing in as fallback.
- **Restart path:** on cog load, overdue heists resolve immediately; still-running ones are re-scheduled with the remaining seconds (`heist.py:321-354`). If the user is no longer cached, the heist is silently cleared with no result message (`heist.py:334-339`).
- **Fallback:** if posting to the original channel raises Forbidden, the result is retried in the fallback channel if one was provided (`handlers.py:363-373`).
- The `active_heist` record is always cleared afterwards, success or crash (`handlers.py:377-381`). There are no Discord event listeners involved — delivery is timers + lazy checks only.

#### 3. Solo resolution mechanics (`handlers.py:116-381`)

Computed in this order:

1. **Tool consumption** (`handlers.py:148-163`): if the equipped tool's `for_heist` equals this heist and the player owns ≥1, one is consumed immediately (auto-unequips at 0) and its `boost` is banked.
2. **Success roll** (`handlers.py:165-171`): `base = randint(min_success, max_success)`; `chance = min((base + tool_boost·100)/100 + level_bonus, 1.0)`; success if `random() < chance`. Level bonus = 0.5 % per level, capped at +20 % at level 40 (`leveling.py:87-92`).
3. **Payout / loss** — see result lines in §4. Loot heists are those whose name is itself a loot item: only `street_bike`, `street_car`, `street_motorcycle` (`utils.py:106-108`, `handlers.py:173-177`).
4. **Heat**: +1 heist heat and +1 material heat per attempt (`handlers.py:251-256`). Effective heat decays 1 per 2 idle hours before use (`heist.py:173-189`).
5. **Material drop** (`handlers.py:258-272`): chance = `min(material_drop_chance + material_heat·0.04, 0.9)`; on a drop, material heat resets to 0, one material is chosen uniformly from the heist's `material_tiers` (or all `material`-type items if the heist has none), quantity `randint(1,3)` on success, `randint(1,2)` on failure.
6. **Police roll** (`handlers.py:274-320`): chance = `min(police_chance + heat·0.02, 0.9)` using the already-incremented heat. On caught: heat resets to 0; `bail = int(max_loss · uniform(0.5, 1.0))`; jail until now + the heist's `jail_time`.
7. **Stats** counters `success`/`fail`/`caught` increment (`handlers.py:330-336`); **XP** is awarded: caught → 0 XP; failure → `max(1, int(xp_reward·0.20))`; success → full `xp_reward` (`leveling.py:102-138`).

#### 4. Solo result card (`_build_result_view`, `handlers.py:53-86`)

LayoutView, **timeout None**, single Container whose **accent colour** is: caught (even if the roll succeeded) `0xFF0000` red; success `0xA020F0` purple; failure `0xFF6600` orange (`handlers.py:322-327`). Contents:

**Header TextDisplay** (`handlers.py:70-74`):
```
## {emoji} {Heist Name} - {status}
{@player mention}
*{narrative}*
```
`status` is `✅ Success` or `❌ Failed`, with ` - 🚨 Caught` appended when caught. `narrative` is one random line from the matching pool (`meta.py:12-39`) — caught takes priority over success/fail:

- `_FLAVOUR_SUCCESS` (7): "You moved like a ghost - in and out before anyone noticed." / "Textbook execution. The crew would be proud." / "Clean hands, full pockets. Another day, another score." / "No alarms. No witnesses. Just profit." / "Like taking candy from a baby - if the baby had a vault." / "You vanished into the night with exactly what you came for." / "The plan worked perfectly. It never does, but this time it did."
- `_FLAVOUR_FAIL` (7): "Something went wrong. It always does eventually." / "The mark was smarter than expected." / "Bad luck. The kind you can't plan around." / "You got out, but not with what you came for." / "Sloppy execution. You'll do better next time." / "The score wasn't worth the heat you brought down." / "Close, but close only counts in horseshoes."
- `_FLAVOUR_CAUGHT` (6): "Red and blue lights filled the rear-view mirror." / "Sirens. Always the sirens." / "Someone talked. Or maybe you just got unlucky." / "The long arm of the law finally caught up." / "Cuffs clicked. Game over - for now." / "You froze at the wrong moment."

Then a **Separator**, then one TextDisplay of the accumulated lines joined by newlines, **in this exact build order**:

**On success** (`handlers.py:182-204`):
- Loot heist: `You stole a **{Loot Item}** from the {Heist Name}.` (since the loot item name equals the heist name, this literally reads e.g. "You stole a **Street Bike** from the Street Bike.", `handlers.py:186`). Event multiplier does **not** apply to loot.
- Cash heist: `reward = randint(min_reward, max_reward) · event_multiplier`. Line: `**+{reward:,} {currency}** added to your balance.` — or, with an event active (multiplier > 1): `**+{reward:,} {currency}** added to your balance. 🎉 {mult}x event! (base: {base:,} {currency})`. If the bank cap is hit: `You would have gained {reward:,} {currency}, but your balance is already at the maximum.` and the reward is treated as 0. The multiplier comes from `get_event_multiplier` (`events.py:35-49`), which returns 1 and auto-clears the config if the owner-set event has expired.

**On failure** (`handlers.py:205-243`):
- `loss = randint(min_loss, max_loss)`. If a shield is equipped and owned, one is consumed (auto-unequips at 0), `loss = int(loss · (1 − reduction))`, and one random `_FLAVOUR_SHIELD` line (`meta.py:41-45`) is added: "Your armour took the hit so you didn't have to." / "The shield held. Barely." / "Damage mitigated. Gear degraded."
- If loss > 0 and balance covers it: `**−{loss:,} {currency}** deducted from your bank balance.` (note the minus sign is U+2212 `−`).
- If balance can't cover it, the **entire** loss becomes debt (no partial payment), plus `int(loss·0.2)` tax if `tax_agreed`: `**{debt_to_add:,} {currency}** added to your debt (incl. {tax:,} tax). Total debt: **{new_debt:,}**.` (the "(incl. … tax)" part only when tax > 0).
- If loss reduced to 0: `Your shield absorbed everything. No losses this time.`

**Tool line** (if a tool was consumed, `handlers.py:245-249`): one random `_FLAVOUR_TOOL` line (`meta.py:47-51`: "Your equipment gave you the edge you needed." / "Proper tools make proper criminals." / "The gear performed exactly as advertised.") then a subtext line:
```
-# {Tool Name} used (+{boost·100:.0f}% success boost)
```

**Material line** (if the drop rolled, `handlers.py:270-272`): one random `_FLAVOUR_MATERIAL` line (`meta.py:53-57`: "You pocketed some useful scraps on the way out." / "A bonus find among the chaos." / "Salvaged something valuable from the wreckage.") then:
```
-# Found {qty}× {Material Name}
```

**Police lines** (only when caught, `handlers.py:288-320`):
- Caught after a successful loot heist: the just-stolen item is taken back — `Police confiscated the **{Loot Item}**.`
- Caught after a successful cash heist: the reward is withdrawn again — `Police seized **{reward:,} {currency}** from you.`
- Caught after a failure: one random loot-type item from the inventory (if any) is removed — `Police confiscated your **{Item Name}**.`
- Always, the jail line (bail display adds 15 % tax: `tax = int(bail·0.15)`):
```
**In jail** until <t:{end_ts}:f> (<t:{end_ts}:R>).
Bail: {bail:,} + {tax:,} tax = **{total_bail:,}** {currency}.
```

**XP line** (always last, `handlers.py:338-350`):
- Caught: `-# 🎓 No XP earned (caught)`
- Otherwise: `-# 🎓 +{xp_gained} XP{level_up} · Lv.{lvl} {bar} {into:,}/{span:,}` where `{level_up}` is ` — **Level up! {old} -> {new}** 🎉` only when a level was gained, and `{bar}` is `xp_bar` (`leveling.py:95-99`): a 20-character `●`/`○` bar inside backticks followed by percent, e.g. `` `●●●○○○○○○○○○○○○○○○○○` 15.3% ``. `into`/`span` are XP into the current level / total XP span of the level (WoW-style table, `leveling.py:32-48`, max level 120).

#### 5. Crew resolution differences (`resolve_crew_heist`, `handlers.py:384-591`)

Started from the crew lobby's **"Begin Heist (4/4)"** button (crew size fixed at 4, `views.py:40`): every member gets `active_heist` with `tax_agreed: False` (`views.py:1040-1048` — so crew debt **never** gets the 20 % tax in practice, `handlers.py:419, 464-467`), the lobby is disabled, and a public crew in-progress card is posted (`_CrewStartedView`, `views.py:1078-1090` — LayoutView, timeout None, no accent colour):

```
## 👥 Crew Robbery - In Progress
The crew is in. No turning back now.

**Crew:** {display names, comma-joined}
**Results:** <t:{end_ts}:R> (<t:{end_ts}:f>)
**Potential haul:** {min_reward:,}–{max_reward:,} {currency} (split {n} ways)
**Potential loss:** {min_loss:,}–{max_loss:,} {currency} (split {n} ways)
```

A **single** asyncio task sleeps the crew_robbery duration (20 min) then resolves; it is registered in `pending_tasks` under every member's ID (`views.py:1060-1075`).

Mechanics that differ from solo:
- **One shared success roll** for the whole crew: `chance = randint(min_success, max_success)/100` — **no tool boost, no level bonus** in the roll (`handlers.py:395-397`).
- **One shared reward/loss draw**: on success `total = randint(min_reward, max_reward) · event_multiplier`; on failure `total_loss = randint(min_loss, max_loss)`. Each is integer-divided by the member count for the per-head share (`handlers.py:399-406`).
- **Tools** (matching `for_heist == "crew_robbery"`) are still consumed per member, but instead of aiding the roll they multiply that member's payout share by `(1 + boost)` (`handlers.py:420-441`).
- **Shields** reduce that member's loss share exactly as in solo; there is no "absorbed everything" special line (`handlers.py:448-458`).
- **Debt**: full per-member share if balance is insufficient (`handlers.py:463-469`).
- **Police roll is per member** — same formula (`min(police_chance + heat·0.02, 0.9)`, heat +1 first, reset on catch). Bail is `int(max_loss · uniform(0.5, 1.0))` off the **full** (unsplit) max_loss = 300,000, jail 16 h (`handlers.py:476-495`); a 15 % bail tax is computed but **not shown** in the crew line.
- **Materials**: per member, quantity always `randint(1,2)` regardless of outcome (`handlers.py:499-514`).
- **XP** per member follows the shared success but the member's own caught state (`handlers.py:525-534`).

**Crew result card** (`handlers.py:538-583`): LayoutView, timeout None, accent colour red `0xFF0000` if **any** member was caught, else purple `0xA020F0` on success, orange `0xFF6600` on failure. Layout:

1. Header TextDisplay: `## 👥 Crew Robbery - {status}` — status `✅ Success`/`❌ Failed`, with ` - 🚨 Some Caught` appended if anyone was caught — then all member mentions space-joined, then `*{narrative}*` from the crew pools (`meta.py:59-78`):
   - `_CREW_FLAVOUR_SUCCESS` (4): "The crew moved as one. Nobody left empty-handed." / "Four minds, one plan. It worked like clockwork." / "In and out. The perfect score." / "Coordination is everything - and yours was flawless."
   - `_CREW_FLAVOUR_FAIL` (4): "Someone broke formation. The whole crew paid for it." / "The job fell apart. Happens to the best of them." / "Too many moving parts. Something had to go wrong." / "The plan looked good on paper."
   - `_CREW_FLAVOUR_CAUGHT` (4): "A whole crew in cuffs. Someone's going to write a book about this." / "You almost made it. Almost." / "Four sets of hands - and every one of them caught." / "The police were waiting. Someone talked."
2. Separator, then on success: `**Total haul:** {total_reward:,} {currency} split {n} ways` newline `**Per member:** ~{per_member:,} {currency}`, plus `-# 🎉 {mult}x event active!` on a third line when an event is running. On failure: `**Total loss:** {total_loss:,} {currency} split {n} ways`.
3. Separator, then `**Individual results:**` followed by one block per member (blocks separated by a blank line), each block's lines in order (`handlers.py:436-536`):
   - `**{display name}**`
   - payout `+{amount:,} {currency}` / cap line `Balance already at maximum.` / loss `-{loss:,} {currency}` (plain ASCII hyphen here, unlike solo) / `Debt +{amount:,} {currency}`
   - `🚨 Caught - jail until <t:{end_ts}:R>` **or** `✅ Got away clean`
   - `-# Found {qty}× {Material Name}` (only if that member's material dropped)
   - `-# 🎓 No XP earned (caught)` **or** `-# 🎓 +{xp} XP · Lv.{lvl}{lv_up}` where `{lv_up}` = ` · Level up! {old} -> {new} 🎉` when leveled (no XP bar in crew blocks).

On any exception during crew resolution every member's `active_heist` is cleared silently (`handlers.py:587-591`).

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

### Owner/Admin Surface — `[p]heistset`

All paths below are relative to the cog root (`maxcogs/heist/`). Source-table numbers (per-heist defaults, item costs, recipes) referenced here are dumped verbatim in `/home/user/CuffBot/test/fixtures/heist-source-tables.json`; I spot-verified `HEISTS.casino_vault` (risk 0.2, reward 50,000–200,000, cooldown 18,000,000 ms = 5 h, success 10–40, duration 900,000 ms = 15 min, loss 20,000–100,000, police 0.35, jail 28,800,000 ms = 8 h, xp 120), `ITEMS.hacking_device` (cost 2,500, boost 0.15, for `casino_vault`) and `RECIPES.enhanced_elite_kit` (5× rare_alloy, 3× military_grade_alloy, 2× classified_docs) against `utils.py:539-554`, `utils.py:90-93`, `utils.py:435-439` — **the dump matches HEAD** (24 heists, 74 items, 28 recipes). Use the dump for the full tables.

#### 0. Group and permissions

- `[p]heistset` is a **prefix-only** command group (`with_app_command=False`) gated by **`is_owner()`** — only bot owner(s) can run it or any subcommand (`commands/owner_commands.py:38-41`). Help text: "Manage global heist settings."
- The interactive panels double-check clicks: any non-owner interacting with the config, price, or event panel gets an ephemeral "You are not authorized to use this." (`views.py:768-774`, `views.py:920-926`, `events.py:200-206`).
- `[p]heistset settings` and `[p]heistset showprices` additionally require the bot to have **Embed Links** permission (`commands/owner_commands.py:156, 239`).
- All nine tunables are pre-seeded into global config with their defaults at cog init (`heist.py:78-100`), so "custom" means the stored value differs from the `HEISTS`/`ITEMS` default.
- Everywhere a `heist_type`/`item_name` argument is accepted, the input is lowercased and spaces become underscores before lookup (`commands/owner_commands.py:69, 114, 145, 159, 242`), so `Casino Vault` works.

#### 1. `[p]heistset settings [heist_type]` — settings print

(`commands/owner_commands.py:155-226`)

- Invalid argument → plain text `Invalid heist type: {heist_type}` (`:161`).
- Otherwise sends **one embed**: title **"Heist Settings"**, description `Settings for {all heists|{Heist Name}} (custom values marked with ⭐)`, color = the bot's contextual embed color (`ctx.embed_color()`), no thumbnail/image, no components (`:163-167`).
- With no argument it lists **every heist except crew heists** (any `HEISTS` entry with `crew_size` — i.e. `crew_robbery` is hidden), **sorted alphabetically** → 23 inline fields; with an argument it shows just that one (naming `crew_robbery` explicitly does show it) (`:169-173`).
- Each field: name `{emoji} {Heist Name}` (e.g. `🎰 Casino Vault`), `inline=True`, value is exactly these 8 lines (`:211-220`), each tunable line gaining a trailing ` ⭐` when its stored value differs from the default:
  - `Reward: {min:,}-{max:,} credits` — **except** for heists whose name is a loot item (`street_bike`, `street_car`, `street_motorcycle`), which instead show the loot sell range `{min_sell:,}-{max_sell:,} credits` and never a star (`:205-210`)
  - `Risk: {risk*100:.0f}%`
  - `Success: {min_success}-{max_success}%`
  - `Cooldown: {hours:.1f}h` (seconds/3600, e.g. vending machine's 600 s → `0.2h`)
  - `Duration: {minutes} min` (integer floor, e.g. vending machine's 30 s → `0 min`)
  - `Police Chance: {pct*100:.0f}%`
  - `Jail Time: {hours:.1f}h`
  - `Loss: {min_loss:,}-{max_loss:,} credits` — losses are **not tunable** and never starred (they always come from defaults, `heist.py:301-302`)

#### 2. `[p]heistset set` — per-heist field tuning panel

(`commands/owner_commands.py:43-50`, view `views.py:705-780`)

Sends a Components-v2 container panel (not an embed; the code passes `ephemeral=True` but since the command is prefix-only the panel posts as a normal channel message). **Timeout 180 s** — on timeout every component is disabled in place (`views.py:709, 776-780`).

Panel content, top to bottom inside one container:
1. Text: `## ⚙️ Heist Settings` followed by the summary. Before any selection the summary is `-# Select a heist and parameter to edit its value.` (`views.py:717-719, 751`). After picking a heist it becomes `**{emoji} {Heist Name}**` plus one `-# {label}: {value}` subtext line per parameter (from **defaults**, not custom values — `views.py:720`), with ` ◄` appended to the currently selected parameter's line. Formatting: risk/police chance `{x*100:.0f}%`, time params `{seconds}s`, others thousands-separated. For the 3 loot heists the Min/Max Reward lines instead read `{min_sell:,}–{max_sell:,} (loot sell)` (`views.py:722-746`).
2. Separator.
3. **Heist select** — placeholder `Select a heist...`, one option per `HEISTS` entry (all 24 fit under the 25-option cap, including Crew Robbery): label = title-cased name, emoji = the heist's emoji, currently selected option marked default (`views.py:537-553`).
4. **Parameter select** — placeholder `Select a parameter...`, exactly 9 options with label + description hint from `meta.py:1-11`: `Risk (%)` / `0–100`, `Police Chance (%)` / `0–100`, `Min Success (%)` / `0–100`, `Max Success (%)` / `0–100`, `Min Reward` / `credits`, `Max Reward` / `credits`, `Cooldown` / `seconds`, `Duration` / `seconds`, `Jail Time` / `seconds` (`views.py:561-577`).
5. **"Set Value"** button — primary (blurple), emoji ✏️, disabled until *both* a heist and a parameter are selected (`views.py:585-593`).

Pressing **Set Value** opens a **modal** titled `{Heist Name} - {Param Label}` (e.g. `Casino Vault - Risk (%)`) with a single text input: label **"New Value"**, max length 12, placeholder `Current: {current} ({hint})` where *current* is the **resolved** (custom-aware) value — percentages rendered as `{x*100:.1f}` (e.g. `20.0`), time params as integer seconds, others as-is (`views.py:596-626`).

Modal validation on submit (all failures are ephemeral, value unchanged):
- Not a number → `That must be a member.` (verbatim, sic — `views.py:634-636`).
- `risk`/`police_chance`: input is a **percentage**, stored ÷100; must be 0–100 or → `{Label} must be between 0 and 100.` (`views.py:641-646`).
- `min_success`/`max_success`: integer 0–100 or → same `…must be between 0 and 100.` line (`views.py:647-652`).
- All other params: integer; negative → `{Label} cannot be negative.`; `cooldown`/`jail_time` under 60 → `{Label} must be at least 60 seconds.`; `duration` under 30 → `Duration must be at least 30 seconds.` (`views.py:653-666`).
- Cross-checks against the currently stored counterpart (`views.py:668-693`):
  - `Max reward cannot be less than min reward ({min:,}).`
  - `Min reward cannot be greater than max reward ({max:,}).`
  - `Max success cannot be less than min success ({min}).`
  - `Min success cannot be greater than max success ({max}).`
- Success: value written to global config, ephemeral `✅ Set **{Param Label}** for **{Heist Name}** to **{display}**.` where display is `{v*100:.1f}%` for risk/police chance, else `{v:,}` (`views.py:695-702`). The panel itself is **not** refreshed after a save (its summary still shows defaults until re-selection).

#### 3. `[p]heistset price` — item price panel

(`commands/owner_commands.py:52-59`, view `views.py:876-932`)

Components-v2 container panel, **timeout 180 s**, disabled in place on timeout. Only items with a `cost` key appear (29 shop items → 2 pages of up to 25).

1. Text: `## 💰 Item Prices - Page {n}/{total}` followed by one `-# {emoji} {Item Name}: {cost:,}` line per item on the page, with ` ◄` after the selected item. Note: this list always shows the **default** cost, not a customized one (`views.py:893-901`) — only the modal placeholder shows the live value.
2. Separator.
3. **Item select** — placeholder `Select an item...`, up to 25 options (label = title-cased item name, emoji = item emoji, selected marked default) (`views.py:783-800`).
4. Nav/action row: **"Previous"** (secondary, emoji ◀️, only present when not on page 1), **"Next"** (secondary, emoji ▶️, only present when not on the last page), and **"Set Price"** (primary, emoji ✏️, disabled until an item is selected) (`views.py:808-839, 904-909`).

**Set Price** opens a modal titled `Set Price - {Item Name}` with one input: label **"New Cost"**, max length 12, placeholder `Current: {resolved_cost:,}` (`views.py:847-858`). On submit: must parse as an integer ≥ 0 or → ephemeral `Must be a non-negative integer.`; success → ephemeral `✅ Set **{Item Name}** price to **{value:,}**.` (`views.py:860-873`). Panel list is not auto-refreshed.

#### 4. `[p]heistset showprices [item_name]` — price print

(`commands/owner_commands.py:238-270`)

- Unknown item / non-shop item → `Invalid item: {item_name}` (`:245`).
- Embed: title **"Shop Item Prices"**, description `Prices for {all items|{Item Name}} (custom values marked with ⭐)`, color `ctx.embed_color()`, footer **"Use [p]heistset price to modify values or [p]heistset resetprice to revert to defaults."** (literal `[p]`, no substitution) (`:247-254`). One inline field per item (all 29 sorted alphabetically, or just the named one): name `{emoji} {Item Name}`, value `Cost: {cost:,}` + ` ⭐` when a custom cost differs from default (`:256-269`).

#### 5. `[p]heistset reset [heist_type]`

(`commands/owner_commands.py:61-104`) Re-writes the 9 tunables back to `HEISTS` defaults.
- Unknown type → `Invalid heist type: {heist_type}`.
- Named heist → `Reset settings for {Heist Name} to defaults.`
- No argument → wipes and re-seeds **all** heists → `Reset all heist settings to defaults.`

#### 6. `[p]heistset resetprice [item_name]`

(`commands/owner_commands.py:106-130`)
- Unknown/cost-less item → `Invalid item: {item_name}`.
- Named item → `Reset price for {Item Name} to default.`
- No argument → re-seeds all shop prices → `Reset all item prices to defaults.`

#### 7. `[p]heistset cooldownreset <member> [heist_type]`

(`commands/owner_commands.py:132-153`) Clears the named member's stored heist cooldown timestamps.
- Unknown type → `` Invalid heist type: `{heist_type}`. `` (backticked, with period).
- Named heist → `Reset **{Heist Name}** cooldown for {member.display_name}.`
- No type → clears all → `Reset all heist cooldowns for {member.display_name}.`

#### 8. `[p]heistset event start` — reward-event panel

(`commands/owner_commands.py:228-236`, `events.py:35-213`) `[p]heistset event` is a subgroup ("Manage heist reward events.") whose only subcommand, `start`, posts the event status/control panel — a Components-v2 container, **timeout 180 s**, buttons disabled in place on timeout.

Panel text (`events.py:153-173`):
- No active event: `## 🎉 Heist Events` / `No event currently active.` / blank line / `-# Start an event to multiply all cash rewards for a set duration.`
- Active event: `## 🎉 Event Active - {mult}x Rewards` / `Ends <t:{end}:R> (<t:{end}:f>)` / blank line / `-# All heist cash rewards are multiplied by {mult}.`

Below a separator, two buttons (`events.py:108-140, 175-178`):
- **"Start Event"** — green (success), emoji 🎉, **disabled while an event is active**. Opens a modal titled **"Start Heist Event"** with two required inputs (`events.py:52-64`):
  - label **"Multiplier (2–5)"**, placeholder `e.g. 2`, max length 1
  - label **"Duration (minutes)"**, placeholder `e.g. 60`, max length 5
  - Validation: multiplier must be an integer 2–5 → else ephemeral `Multiplier must be an integer between 2 and 5.`; duration must be an integer ≥ 1 → else ephemeral `Duration must be a positive integer (minutes).` (`events.py:70-86`).
  - Success: sets the global multiplier and end time (now + minutes), replies ephemerally `🎉 **{mult}x reward event** started! Ends <t:{end_ts}:R> (<t:{end_ts}:f>).`, and the panel re-renders to the "Event Active" state (`events.py:88-105`).
- **"Stop Event"** — red (danger), emoji 🛑, **disabled while no event is active**. Resets multiplier to 1 and end time to none, replies ephemerally `Event stopped.`, and re-renders the panel to the inactive state (`events.py:122-140`).

Expired events self-clear: any read of the event state past its end timestamp resets the multiplier to 1 and the end time to none automatically (`events.py:35-49`) — no owner action needed after the timer lapses.

---

## Known gaps — completeness review

# Spec completeness review — heist cog

Surface enumerated from source: 1 hybrid group + 12 subcommands, 1 prefix group + 8 subcommands + 1 subgroup, 35 discord.ui classes (views/selects/buttons/modals), 0 listeners, 2 config scopes. Fixture re-verified programmatically: 24/74/28 tables, zero field mismatches vs `utils.py` — all bulk-data claims hold.

## MISSING

- **Package/metadata surface**: `__init__.py` `setup()`; `info.json` (min_bot_version `3.5.24`, min_python `3.10.0`, `permissions: ["embed_links"]`, install_msg, end_user_data_statement, tags); cog class docstring (shown as cog help), `__version__ "2.0.0"` / `__author__` / `__docs__` and `format_help_for_context` appending them (`heist.py:49-106`). Nothing in the spec covers any of this.
- **User config schema never enumerated**: Config identifier `11236022492481444`, `force_registration=True`, and the full `default_user` record — including the **dead legacy keys `shield` and `shield_end`** (registered, never read/written), `heat_last_set` (drives decay), and the `stats` dict shape (`heist.py:56-77`). Task-relevant since resume/verification depends on the stored shape.
- **`red_delete_data_for_user`** — clears the entire user record (`heist.py:108-110`).
- **`cog_unload`** — cancels every task in `pending_tasks` (`heist.py:356-359`); in-flight heists then survive only via the restart/lazy paths.
- **Crew resolution routing gap**: `resolve_crew_heist` is reachable *only* from the live `Begin Heist` button. `cog_load` and the lazy gate route every stored `"crew_robbery"` record through the **solo** resolver (`heist.py:150-161, 321-354` → `handlers.py:116`), so after a bot restart mid-crew each member independently rolls the full unsplit 1,000,000–80,000,000 reward / 80,000–300,000 loss with solo mechanics; a lobby placeholder surviving a crash resolves the same way. The Resolution section's "Restart path" omits this entirely.
- **Crew robbery has no cooldown**: the table's 8 h cooldown is never stamped or checked — cooldown stamping/checking exists only in `_HeistSelect` (`views.py:107-116, 141-142`); `[p]heist crew` has no cooldown gate (`user_commands.py:153-186`) and `cooldowns` excludes crew. Spec cites "cooldown 8 h" for crew twice without stating it is inert; a re-implementer would build an enforcement that doesn't exist.

## WRONG

- Player-commands section, `[p]heist level`: "level 1→2 = 212 XP" — the formula it itself quotes gives **112** (`floor(100·1·1.12)`, `leveling.py:40-48`); 212 is the stale code comment (`leveling.py:37`). Directly contradicts the numeric-model section, which correctly says 112 and flags the comment as stale.
- Player-commands section: "Bare `[p]heist` does nothing itself (empty group callback)" — `redbot.core.commands` groups default `autohelp=True`, so a bare group invocation sends the group help (`commands/user_commands.py:48-51`; same for bare `[p]heistset` / `[p]heistset event`, `owner_commands.py:38-41, 228-230`). "Does nothing" would make a re-implementer suppress the help reply.

## MINOR

- Views §crew / Resolution §5: crew shields "reduce that member's loss share **exactly as in solo**" — not exactly: crew consumption never clears the equipped slot when the last charge is used (`handlers.py:451-457` vs solo `handlers.py:213-216`); same for crew tools (`handlers.py:431-434` vs `handlers.py:158-162`). The stale equipped entry persists until `heist start`'s out-of-stock sweep.
- "…Crew disbanded." replies disband nothing — the lobby stays fully interactive and members' placeholders persist until the 180 s lobby timeout clears them (`views.py:1020-1032` vs `1143-1153`).
- `[p]heist profile` renders the raw stored `active_heist` even when expired or a `lobby: true` placeholder (`user_commands.py:338-343`) — during an open lobby it shows "Active Heist: Crew Robbery" with the placeholder end time; spec doesn't mention either case.
- Dead helper methods `_has_active_shield`, `_get_equipped_tool`, `_has_equipped_consumable`, `_consume_item` (`heist.py:112-148`) are never called — resolvers inline their own logic.
- `cog_load` edge: an overdue heist whose channel (or `channel_id`) is gone is left stored and only resolves lazily; still-running heists with a missing channel are not rescheduled (`heist.py:327-354`).
- `EventView` is only constructible via the async `create()` classmethod; the plain `__init__` path reads `_cached_mult` before assignment and would crash (`events.py:146-151` vs `187-198`) — panel state is cached at build, not re-read.
- `schedule_resolve` deletes its own `pending_tasks` entry after firing (`handlers.py:101-102`); the crew task deletes all four members' entries (`views.py:1066-1068`).
- Solo success chance uses `int(tool_boost * 100)` (truncation) rather than the spec's exact `tool_boost·100` (`handlers.py:170`) — no practical difference for the shipped boost values.
