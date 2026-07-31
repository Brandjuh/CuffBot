# CuffBot System Report — S135 (2026-07-31)

Commissioned by the owner: *"Algehele controle op het hele systeem: geef mij een rapportage over de algehele staat van het systeem"* — together with *"Controleer Heist en City, deze lijken niet eens op werking van de cogs die ik je gestuurd heb. Ik wil 1:1 de werking hebben."*

**Method.** A 16-agent audit run in one pass: independent readers mapped the two source cogs (`CalaMariGold/CalaMari-Cogs/city`, `ltzmax/maxcogs/heist`, cloned at HEAD) and our two modules screen by screen; a diff stage produced divergence findings with file:line evidence on both sides; the top findings were then **adversarially verified** by separate agents told to refute them against the real files. In parallel, one agent scoped the five queued M27 work items against the current code and one swept overall repo health. Everything below that carries a verdict mark survived that verification; everything else is a single agent's evidenced claim.

---

## 1. Verdict

**The platform is healthy. The two big game ports are functionally complete but not faithful.**

- Infrastructure: 37 modules, 64 commands (259 subcommands), 79 event handlers, ~33.8k lines of source, ~21.9k lines of tests, **1363/1363 tests green**, 37/37 manuals present and index-linked, self-update chain verified live (S129), three runtime dependencies, zero TODO/FIXME markers.
- **The owner's report is correct, and it is about the interaction layer.** The city and heist *engines* (tables, odds, payouts, resolver maths) were machine-diffed against the sources in earlier sessions and match. What diverges is **what a player sees and does**: entry menus, confirmation steps, pacing, result screens, texts, and a handful of gates we either dropped or invented. The audit found **27 divergences per game**; 7 of the 8 most severe were CONFIRMED by independent verification, 1 was PARTIAL (right in substance, overstated in detail).
- **Why S132's "no divergence" verdict and this report are both true:** S132 checked five *objectively checkable classes* — numeric parameters, stats persistence, leaderboard presence, bare-word invocation, test coverage — and those still hold. It never measured flow, pacing, presentation or texts, which is exactly where this audit finds the gaps. A clean sweep is only as broad as its classes. (Recorded as a skill lesson this session.)

---

## 2. Verified system facts

| Dimension | State |
|---|---|
| Modules | 37, loader-discovered; 1:1 with `docs/modules/` (test-enforced both directions) |
| Command surface | 64 top-level commands, 259 subcommands, 79 event handlers |
| Tests | 90 files, **1363/1363 pass** in ~15 s; every module has a dedicated test file **except `welcome`** (covered inside `logbook-welcome.test.js`) |
| Code size | ~33.8k LOC src, ~21.9k LOC test |
| Dependencies | `discord.js`, `@discordjs/voice`, `@noble/ciphers` — nothing unused, no compiler needed on the Pi |
| Update chain | Bot checks GitHub every 15 min → runs `scripts/update.sh` (ff-only merge → `npm install` → **test gate with rollback** → deregister slash) → clean exit → systemd `Restart=always` respawns. Verified live S129. |
| Deploy scripts | `bash -n` clean, invariants test-guarded (`shell-scripts.test.js`) |
| Linting | None — consistency rests entirely on tests (embed-style, timestamps, docs-consistency guards) |

---

## 3. City — divergence audit (27 findings)

The owner has reported this game three times. S122–S133 built the panel, the narrated attempt, the mark picker, market/board-in-panel and the hub — but the audit shows the cog's *shape* is still different: its `[p]crime` is a **menu-first, confirm-first, narrate-always** experience, and several of its surfaces have no counterpart.

The four headline items, independently verified:

1. **✓ CONFIRMED — the panel's 🎲 random job never draws a scenario.** The cog overwrites the crime's numbers with one of 46 scenarios (rewards to 8,000, jail 30 min–4 h, own flavour text) *before* the attempt; our panel path runs the placeholder table (100–3,000 🍩, 10-minute jail, no flavour). Only the text command `!crime random` does it right. **This is the single worst gameplay divergence — the panel is the main surface, and it plays a different game there.**
2. **✓ CONFIRMED — a failed jailbreak from the panel button answers "✅ Done."** The service returns `ok: true` for success *and* failure; the pump prints a generic line. The cog plays the full paced jailbreak drama with a green success / red failure embed and the penalty maths.
3. **◐ PARTIAL — no confirm step before a crime.** The cog shows "Your move, boss. You ready?" with success rate and potential fine, Confirm/Cancel, and **cancelling costs nothing** (no cooldown until resolution). We commit instantly on pick. (Partial only because our target panel has a free Cancel for targeted crimes *before* a mark is chosen.)
4. **✓ CONFIRMED — text-command crimes resolve instantly.** The cog narrates *every* attempt (attempt message + Bail Out button, paced events, suspense, then the verdict); our narration exists only on the panel path — `!crime store` etc. answer with the finished card in one reply, and mid-crime Bail Out does not exist there.

Full list with evidence:

#### HIGH (12)

**H1. Panel 'random' job never draws a scenario — runs on placeholder numbers with no flavour** `different-numbers` — **✓ CONFIRMED**

- **Cog:** A random crime ALWAYS draws one of the 46 scenarios: scenario success rate (0.30-0.75), rewards up to 8000, jail 1800-14400s, and the scenario's attempt/success/fail flavour text drive the whole attempt.
- **CuffBot:** The jobs-board select's 🎲 option goes through attemptFromPanel -> commitCrime with NO crimeOverride, so it uses the CRIMES.random placeholders: 100-3000 🍩, 50% odds, 10-MINUTE jail, fine 0.5, and the result card is titled just '🎲 Random — …' with no scenario name or flavour. Only the text command `!crime random` uses commitScenarioCrime and behaves like the cog.
- *Evidence:* crime/views.py:533-545 (scenario drawn from defaults+customs before the attempt); crime/scenarios.py RANDOM_SCENARIOS (46 entries, jail 1800-14400s) ↔ src/modules/city/events/panel.js:75-83 -> src/modules/city/commands/crime.js:880 commitCrime(guildId, userId, crimeType, {targetId, events, rng}) with no crimeOverride; src/modules/city/service.js:170-172 (crimeOverride defaults null -> CRIMES.random); src/modules/city/lib/tables.js:68-79 ('Every number below is a placeholder the drawn scenario overrides' — but the panel path never overrides them); crime.js:105 title falls back to title(crimeType)


**H2. Failed jailbreak from the panel button reports '✅ Done.' with zero detail** `different-flow` — **✓ CONFIRMED**

- **Cog:** The Jail Break button invokes the full crime_jailbreak flow: attempt text, paced event messages, then a green '🔓 Successful Jailbreak!' or red '⛓️ Failed Jailbreak!' embed with the '⚖️ Penalty' math and final escape chance. Pay Bail gives a '🔓 Bail Paid Successfully!' embed with cost, previous and new balance.
- **CuffBot:** cty:bail / cty:jailbreak reply with `result.message ?? (result.ok ? '✅ Done.' : '🚫 That did not work.')` — the services never set .message and attemptJailbreak returns ok:true even when the break FAILS and 30% is added, so a failed jailbreak answers '✅ Done.' ephemerally and the player only learns the truth from the refreshed panel. The whole jailbreak narrative exists only on the text command.
- *Evidence:* crime/views.py:1998-2054 (JailOptionsView invokes crime_jailbreak / crime_bail); crime/commands.py:539-583; crime/views.py:1089-1151 ↔ src/modules/city/events/panel.js:224-234; src/modules/city/service.js:277-288 (attemptJailbreak returns {ok:true,...} for both success and failure, no message field); service.js:237-257 (payCityBail likewise)


**H3. No confirmation step before any crime — picking a job commits you instantly** `different-flow` — **◐ PARTIAL**

> *Corrected after verification:* No confirmation step before committing a crime. Source: after choosing a crime (and target) the player gets a CrimeView confirm embed — "Your move, boss. You ready?" with 📊 Success Rate and 💸 Potential Fine — with Confirm/Cancel (30s); cancelling before Confirm costs nothing and sets no cooldown (cooldown only at resolution or paid bail-out). CuffBot: selecting a non-targeted job from cty:pick, or a mark from the target panel for targeted jobs, starts the narrated attempt immediately with no confirm stage (the target panel's free Cancel exists only for pickpocket/mugging, before a mark is chosen); once the attempt starts the only exit is the paid Bail Out (100 🍩, cooldown still burns), and the text-command path resolves instantly with no confirmation or bail window at all. At the moment of decision CuffBot shows only reward range and risk tier — never the potential fine; the per-crime success percentage is absent from the commit flow, though it is listed on the !crime overview/help card.

- **Cog:** After choosing a crime (and target) the player gets a CrimeView confirm embed — 'Your move, boss. You ready?' with '📊 Success Rate' and '💸 Potential Fine' fields and Confirm/Cancel buttons (30s). Cancelling before Confirm sets NO cooldown.
- **CuffBot:** Selecting a job from cty:pick (or a mark from the target panel) starts the narrated attempt immediately; the only exit after that is the paid Bail Out (100 🍩, cooldown still burns). Success rate and potential fine are never shown before committing.
- *Evidence:* crime/views.py:104-127 (confirm embed), 228-934 (CrimeView), 905-934 (free Cancel), 896 (cooldown only set at resolution) ↔ src/modules/city/events/panel.js:75-83 and 97-127 go straight to attemptFromPanel; src/modules/city/commands/crime.js:833-875 (narration starts on the pick, only bailRow attached)


**H4. Text-command crimes resolve instantly — no narration, no live events, no Bail Out** `different-flow` — **✓ CONFIRMED**

- **Cog:** Every crime attempt is narrated: attempt message with a Bail Out! button, 2s pause, 1-4 event messages at 4s intervals (bail re-checked after each), then a 4-6s suspense delay before the result.
- **CuffBot:** `!crime pickpocket @x`, `!crime mug @x`, `!crime store`, `!crime bank`, `!crime random` call commitCrime and post the finished result card in one reply — events appear only as bullets in the final embed, and the mid-crime Bail Out option does not exist on this path. Only the panel path narrates.
- *Evidence:* crime/views.py:550-644 (attempt text + Bail Out view, event loop with delays, suspense) ↔ src/modules/city/commands/crime.js:145-153 (shared runner `attempt` commits and replies immediately); crime.js:245-261 (`!crime random` same)


**H5. Jailbreak applies ALL 12 scenario events instead of sampling 1-3** `different-numbers`

- **Cog:** A jailbreak draws random.randint(1,3) events via random.sample from the scenario's 12-event pool; only those shift the 35% base chance and the wallet.
- **CuffBot:** resolveJailbreak loops over EVERY event in the scenario ('EVERY event in the drawn scenario applies (there is no probability draw)') — all 12 chance bonuses/penalties and currency effects stack before the single roll, so final odds and payouts differ systematically from the cog.
- *Evidence:* crime/commands.py:487-488 (num_events = random.randint(1, 3); random.sample(scenario['events'], num_events)) ↔ src/modules/city/lib/scenarios.js:55-65 (for (const event of scenario.events ?? []) — no sampling); comment lines 48-52 state the deviation explicitly


**H6. `!crime bail` charges instantly — the bail prompt with Pay/Cancel buttons is gone** `different-flow`

- **Cog:** `[p]crime bail` shows a gold '💰 Bail Payment Available' embed (time remaining incl. reducer note, bail cost, current balance) with Pay Bail / Cancel buttons and a 30s timeout; payment yields a green embed with cost, previous and new balance.
- **CuffBot:** `!crime bail` immediately withdraws the money (after bail-disabled/not-jailed/too-poor gates) and replies with one line: '🔓 Paid **N 🍩** — you walk. Try to make it count.' No preview of the cost, no chance to cancel.
- *Evidence:* crime/commands.py:382-447 (bail prompt + BailView); crime/views.py:1089-1187 (pay/cancel embeds) ↔ src/modules/city/commands/crime.js:267-282 (payCityBail then one-line reply); src/modules/city/service.js:237-257 (charge happens inside the service call)


**H7. Entry surface replaced: no 'Criminal Underworld' main menu with 8-action dropdown** `different-flow`

- **Cog:** `[p]crime` posts a dark-red '🌃 Welcome to the Criminal Underworld' embed with a '__Your Criminal Record__' field (jail status, lifetime earnings, success/fail counts, largest heist, streak) and a 60s dropdown of 8 actions (Commit Crime, Pay Bail, Attempt Jailbreak, Leaderboard, View Status, View Stats, Inventory, Black Market) with '(Unavailable)' annotations; selecting deletes the menu and invokes the command. `[p]city` sends help.
- **CuffBot:** Bare `!crime` opens the jobs-board panel directly; the closest menu is `!city`'s '🌆 The streets' hub with only 4 buttons (Jobs/Market/Board/Record) — no Pay Bail, Jailbreak, Status or Inventory doors, and everything updates in place instead of dispatching commands.
- *Evidence:* crime/commands.py:30-81 (menu embed + record field); crime/views.py:1688-1837 (MainMenuSelect options, invoke-and-delete behavior); base.py:65-69 ↔ src/modules/city/commands/crime.js:167-168 (invokeWithoutSubcommand -> fallback 'panel'); src/modules/city/lib/hub.js:31-36 (4 buttons); src/modules/city/commands/city.js:35-45


**H8. `crime status` command missing — cooldown board, jailbreak status and last target have no home** `missing-feature`

- **Cog:** `[p]crime status [user]` shows a '🦹‍♂️ Criminal Status' embed with avatar thumbnail and fields: '⚖️ __Jail Status__' (with jail-reducer strikethrough), '🔓 __Jailbreak Status__', '📅 __Crime Cooldowns__' in two columns, '🔰 __Active Perks__' and '🎯 __Last Target__' — viewable for any member.
- **CuffBot:** No `status` subcommand exists; `!crime status` hits the group fallback and silently opens the jobs panel instead. Cooldowns only appear for yourself inside `!crime help` and the panel's select descriptions; whether you already used your jailbreak, and who your last target was, are shown nowhere.
- *Evidence:* crime/commands.py:195-319 ↔ src/modules/city/commands/crime.js:194-496 (subcommand list has no status; unknown tokens fall through per crime.js:167-168); record card crime.js:713-731 lacks cooldowns/jailbreak-flag/last-target


**H9. Inventory view and item selling missing** `missing-feature`

- **Cog:** `[p]city inventory` opens a 180s InventoryView: a use/toggle select (jail pass, notify toggle showing Enabled/Disabled) and a sell select that refunds 25% for perks and 50% for consumables, removing the item and depositing credits.
- **CuffBot:** No inventory command at all. The only item interaction is `!crime usepass`; owned kit is a read-only line in the record card, and nothing can ever be sold back.
- *Evidence:* base.py:490-517 (`city inventory`); inventory.py:66-541, sell rates inventory.py:434 ↔ src/modules/city/commands/crime.js:382-399 (`usepass` only); crime.js:706-711 (kit shown read-only); no sell path anywhere in src/modules/city/


**H10. Anti-farm and jailed-victim rules dropped on manual and text targeting** `different-flow`

- **Cog:** can_target_for_crime refuses jailed targets ('That user is in jail!') and your last victim ('You can't target your last victim!') on EVERY path, including the manually-typed TargetModal; the random scan excludes them too.
- **CuffBot:** The last-mark rule is deliberately waived for a manually picked mark (comment: 'A name the player typed themselves is not the roller, so the repeat rule does not apply'), and the text path's canAttempt checks only self/bot/too-poor — jailed victims and repeat victims are freely robbable via `!crime pickpocket @x`, so the same rich member can be farmed every cooldown.
- *Evidence:* crime/views.py:1662-1678 (jail + last-victim refusals in can_target_for_crime, used by the modal at views.py:1294-1300) ↔ src/modules/city/events/panel.js:112-122 (lastTargetId: null for manual picks); src/modules/city/commands/crime.js:112-143 (text-path refusals: jailed-self/cooldown/self/bot/too-poor only — no victim-jail or repeat check); service.js canAttempt (service.js:136-156)


**H11. Per-crime admin tuning gone: crimeset success_rate/reward/cooldown/jailtime/fine/reload_defaults** `missing-feature`

- **Cog:** Admins tune every crime individually — success rate (0.0-1.0), min/max reward, cooldown seconds, jail seconds, fine multiplier — plus `crimeset reload_defaults` and a `crimeset global view` settings dump.
- **CuffBot:** `!crime admin` exposes exactly 4 global knobs (allowbail, bailmultiplier, minstealbalance, maxstealamount). All per-crime numbers are hardcoded in tables.js; an admin cannot change any crime's odds, rewards, cooldowns, jail times or fines.
- *Evidence:* crime/commands.py:748-868 (crimeset subcommands), 908-942 (global view) ↔ src/modules/city/commands/crime.js:440-445 (SETTINGS_SPECS: the only 4 knobs), 447-462 (show); src/modules/city/lib/tables.js:19-80 (fixed crime table)


**H12. Custom scenario management gone: crimeset scenarios add/list/remove** `missing-feature`

- **Cog:** Admins add guild-custom random-crime scenarios via an interactive Q&A (risk presets low 0.7/100-300/180s, medium 0.5/300-800/300s, high 0.3/800-2000/600s), list them, and remove them; custom scenarios join the pool `[p]crime` draws random crimes from.
- **CuffBot:** The random pool is the fixed 46-entry data/scenarios.json — there is no command to add, list or remove scenarios, so guilds cannot extend the game.
- *Evidence:* crime/commands.py:1067-1238 (scenarios group incl. presets at 1130-1147); crime/views.py:533-545 (defaults + guild customs pooled) ↔ src/modules/city/lib/scenarios.js:16-19 (cached JSON file only); no scenario admin surface in src/modules/city/commands/crime.js:430-487



#### MEDIUM (10)

**M1. notify_ping perk and jail-release notification missing (market sells 2 of 3 items)** `missing-feature`

- **Cog:** The black market sells a 10,000-credit 'notify' perk; after the sentence ends the bot posts '🔔 {mention} Your jail sentence is over! You're now free to commit crimes again.' in the jail channel/thread with DM fallback.
- **CuffBot:** market.js documents a RECORDED DEVIATION: notify_ping is not sold because jail is evaluated lazily and no release timer exists — nobody is ever pinged when their sentence ends, and the market shows only jail_reducer and 


**M2. Admin jail, cooldown self-toggle and owner wipe commands missing** `missing-feature`

- **Cog:** `[p]crime jail <user> <minutes>` lets admins jail a member manually; `[p]crime togglemycds` lets an admin disable their own cooldowns; owner-only `[p]wipecitydata <user>` and `[p]wipecityallusers` wipe stored data behind
- **CuffBot:** None of these exist — there is no way to jail someone by hand, no cooldown override, and no user-facing data-wipe command (only the internal resetCity test seam).


**M3. Jail pass can be stockpiled; the cog blocks buying a second one** `different-flow`

- **Cog:** Buying a consumable you already hold with uses remaining is refused: '❌ You already have this item with uses remaining!' — a player can hold at most one active jail pass.
- **CuffBot:** buyMarketItem increments a per-item count with no ceiling ((current.items[itemId] ?? 0) + 1) and the market shows 'you hold N', so a player can stack unlimited 1,000 🍩 passes and pre-buy their way out of every future sen


**M4. No Jail Break / Pay Bail buttons offered right after a failed crime** `different-flow`

- **Cog:** After the fail embed, a separate JailOptionsView message with 'Jail Break' (danger 🔓) and 'Pay Bail' (success 💸) buttons is posted so the player can react immediately.
- **CuffBot:** The result card replaces the narration with components stripped ([]); to reach the bail/jailbreak buttons the player must run `!crime` again and land on the jailed panel.


**M5. Manual targeting: typed-name modal and 'Target Selected' balance reveal replaced by a bare UserSelect** `different-flow`

- **Cog:** 'Choose your target:' plain text with Random Target / Select Target / Cancel buttons; Select Target opens a modal (typed username/nickname/ID with disambiguation lists), then a red '🎯 Target Selected' embed shows Success
- **CuffBot:** An embed target panel with a native UserSelect + Random Target + Cancel; choosing a mark starts the attempt immediately — the victim's balance, the success rate and the potential fine are never previewed.


**M6. Jobs board hides success rates and fine tiers; risk-colored buttons became a select** `different-presentation`

- **Cog:** The '🦹‍♂️ Criminal Activities' embed lists each crime as paired inline fields with success %, reward range, risk dot and cooldown status, a static fine-tier banner ('🟢 Low Risk: 30-35% … of max reward'), and one risk-col
- **CuffBot:** The '🌃 The city' panel shows one StringSelect whose option descriptions carry only '{min}–{max} 🍩 · {risk} risk[ · needs a mark]' or a wait time — no success percentages (those appear only in `!crime help`), no fine info


**M7. Attempt narration: separate plain-text messages became one self-editing embed with different story texts** `different-presentation`

- **Cog:** The attempt line ('🧤 {user} begins to slip their hand towards {target}'s pocket...') and every event are separate plain-text channel messages; the result arrives as a new message.
- **CuffBot:** One orange embed is edited beat by beat on the panel message itself, with rewritten opening lines ('<@you> is running the pickpocket…', suspense line '_This is it…_') and a permanent '-# Second thoughts? **Bail Out** cos


**M8. Result cards: green/red field-based embeds became purple/orange description cards with new titles** `different-presentation`

- **Cog:** Success: green '{emoji} Successful {Crime}!' with '💰 Reward Calculation' and '📊 Success Rate' fields. Failure: red '👮 Failed {Crime}!' with '💸 Fine', '⛓️ Jail Time' (strikethrough math) and '📊 Success Rate' fields.
- **CuffBot:** One card either way: purple 0xa020f0 '{emoji} {Name} — ✅ Clean getaway' or orange 0xff6600 '… — 🚨 Caught', description lines ('You lifted **N 🍩** off @target.', '**How it added up**' list, '**Locked up** until <t:…:R>') 


**M9. Text-path jailbreak collapses the paced multi-message drama into one embed** `different-presentation`

- **Cog:** Attempt message, 3s pause, each sampled event as its own message at 3.5s intervals, then a green/red embed with '🎲 Final Escape Chance: NN.N%' and on failure an '⚖️ Penalty' field spelling out '(Xm Ys + 30% = ⏰ Ym Zs)'.
- **CuffBot:** `!crime jailbreak` posts a single embed containing the attempt flavour, ALL event bullets with (+N 🍩)/(−N 🍩) and the outcome at once — no pacing, penalty rendered as '⛓️ **+30% on your sentence** — out <t:…:R>' and odds 


**M10. Leaderboard: one 6-category top-3 embed became per-category top-10 views** `different-presentation`

- **Cog:** `[p]crime leaderboard` (alias `lb`) shows ONE '🏆 Crime Leaderboard - Hall of Infamy' embed with all 6 categories, each listing its top 3 with 🥇🥈🥉.
- **CuffBot:** `!crime leaderboard [category]` (aliases board/top — no `lb`) shows one category at a time, top 10 ('🌃 Most wanted — {label}'), defaulting to `earned`; other categories require the argument or the panel's category select



#### LOW (5)

**L1. Stats card: fielded 'Criminal Statistics' embed with avatar became a plain description record** `different-presentation`

- **Cog:** `[p]crime stats [user]`: '📊 Criminal Statistics' embed, user-avatar thumbnail, two inline fields '📊 __Crime Statistics__' and '💰 __Financial Impact__' including success-rate %.
- **CuffBot:** `!crime stats` / `record`: '🌃 {username}'s record' — same underlying numbers (incl. success %) but as one description block, no thumbnail, plus lines the cog's stats screen does not have (kit, jail status).


**L2. Cog's bail-prompt loophole (opening bail resets the jailbreak attempt) not carried over** `different-flow`

- **Cog:** Merely opening `[p]crime bail` resets attempted_jailbreak — a player can open the prompt, cancel, and get a second jailbreak attempt in the same sentence.
- **CuffBot:** The flag resets only when bail is actually paid or a jail pass is used; there is no prompt to open, so the second-attempt trick does not exist.


**L3. Panels never expire; the cog's menus time out and disable themselves** `different-flow`

- **Cog:** Every view has a timeout — 30s (confirm/bail/attempt), 60s (crime list, target selection, main menu, jail options), 180s (black market, inventory) — after which components disable or the message is deleted.
- **CuffBot:** Hub, jobs board, market, board and record panels have no timeout and stay pressable indefinitely; only the mid-attempt Bail Out window is bounded (ATTEMPT_WINDOW_MS 30,000 ms, plus in-memory tracking lost on restart -> '


**L4. Interaction refusal and utility texts reworded throughout** `different-texts`

- **Cog:** Someone else's press: 'This menu is not for you!'. Jail refusal on a crime button: '⛓️ You're still in jail for Xm Ys! You can pay bail using `!crime bail` or jailbreak using `!crime jailbreak`'. Cooldown: '⏳ You must wa
- **CuffBot:** Someone else's press: '🌃 That is <@owner>'s board. Run `!city` for your own.'. Jail refusal: '🚨 You are behind bars until <t:…:R>. Sit tight.'. Cooldown: '⏱️ Too soon — lie low until <t:…:R>.'. Similar rewrites on nearly


**L5. Extra text surface the cog does not have: per-crime commands, buy/usepass, group help board** `extra-feature`

- **Cog:** Crimes are reachable only through `[p]crime commit`'s buttons; purchases only through the blackmarket select; consumables only through the inventory view; help is Red's generic help.
- **CuffBot:** Direct subcommands `!crime pickpocket/mug/store/bank/random`, `!crime buy <item>`, `!crime usepass`, plus a rich `!crime help` overview embed with a live status board (crime list with ready/cooldown, streak and jail line



**What genuinely matches:** The pure numbers survived the port almost perfectly: the 4-crime table (rewards, success rates, cooldowns, jail times, fine multipliers incl. mugging's 90 min) matches data.py exactly; the 96 crime events are byte-identical to the cog's CRIME_EVENTS (verified by content diff, 24 per crime, same magnitudes); the 46 random scenarios and 14 prison breaks carry the same names and numbers (the source map's '47' claim was wrong — the cog also has 46); streak math (+5%/success, cap +25%, 24h reset), event-draw odds (100/75/50/10%), chance clamps (5%-100%), fine = maxReward x multiplier with broke-and-doubled confiscation, steal formula with the 1,000 cap / 100 min-balance / min-reward floor, bail = 1.6 x remaining minutes, mid-attempt Bail Out at flat 100 with the cooldown still burning, jailbreak once-per-sentence with +30%-of-remaining on failure, jail_reducer (-20%, 20,000) and jail_pass (1,000, 1 use) prices, sale-less market prices, the six leaderboard categories, and the narration pacing on the panel path (2s opening, 4s per event, 4/5/6s suspense by risk) all reproduce the cog. Owner-gating of components (only the invoker may press, others get an ephemeral refusal) and the settings defaults (allowBail, 1.6, 100, 1000 + the three dead ones) are also faithful. The 🍩 donut currency replacing Red's bank is a deliberate CuffBot-wide economy integration, and dropping slash commands is moot since the source cog is itself prefix-only — no finding was excusable under the text-only mandate. The real gap is interaction architecture and surface completeness, not the math: the resolver is 1:1, the experience around it is not.

---

## 4. Heist — divergence audit (27 findings)

Same shape, smaller scale. The engine matches; the flow does not. The four headline items, independently verified:

1. **✓ CONFIRMED — debt and jail gates lost their pay-now prompts.** The cog answers a debt/jail block with an interactive confirm ("Outstanding Debt … pay now?", "Bail Request … pay bail + 15% tax?") that settles inline; we print a refusal and point at `!heist paydebt` / `!heist bail`.
2. **✓ CONFIRMED — the solo start flow is inverted.** The cog's `[p]heist start` takes **no argument** and opens the paged job picker; ours wants a typed job name plus a literal `confirm` token in the risky case. (Our S126 job *panel* exists — but `!heist play <job> confirm` is the documented path and the picker is not the start flow.)
3. **✓ CONFIRMED — we enforce an 8 h crew-robbery cooldown the source never checks.** The cog gates crew on debt/jail/level/active-heist only. We invented a gate.
4. **✓ CONFIRMED — crew joiners are not level-gated.** The cog requires **level 20 to join**, not just to organise; any level-1 player can join our lobby. (Our S88 note "every member re-gated at launch" re-checks other gates — not the level.)

Full list with evidence:

#### HIGH (4)

**H1. Debt and jail gates: interactive pay-now prompts replaced by refusal texts + separate commands** `different-flow` — **✓ CONFIRMED**

- **Cog:** Any debt/jail-gated command opens an interactive ConfirmLayoutView: '## 💸 Outstanding Debt … Pay X now?' with Yes/No (heist.py:191-223) and '## 🚨 Behind Bars … Bail: X + Y (15% tax) = Z … Pay bail now?' (heist.py:225-276). The player pays debt or bail inline, mid-command; there is no paydebt command at all, and `heist bailout` runs the same bail confirm prompt.
- **CuffBot:** blocked() replies with plain refusal text pointing at other commands: '🚨 You are in jail until <t:R>. Bail is **N 🍩** … `!heist bail`' / '💸 You owe **N 🍩**. Clear it with `!heist paydebt`' (commands/heist.js:209-230). `!heist bail` (579-601) and `!heist paydebt` (602-623) pay instantly with no confirmation step.
- *Evidence:* heist.py:191-276 (ConfirmLayoutView debt + bail prompts); user_commands.py:188-194 (bailout runs check_jail prompt) ↔ /home/user/CuffBot/src/modules/heist/commands/heist.js:209-230, 579-623


**H2. Solo heist start flow: interactive target picker replaced by typed job name + `confirm` token** `different-flow` — **✓ CONFIRMED**

- **Cog:** `heist start` (no args) opens the paged HeistSelectionView (7/page, dropdown 'Choose your target...'); picking a target runs the cooldown check and, if balance < max_loss, an ephemeral debt warning with 'Proceed anyway'/'Cancel' buttons (views.py:90-174, 118-139).
- **CuffBot:** `!heist play <job>` (alias `start`) requires the job name typed; `!heist start` alone is an arg-usage error (CMD:268 job required). Debt consent is a literal `confirm` token: '⚠️ … Run `!heist play <type> confirm` to accept that risk' (CMD:291-303). The interactive board is a separate `!heist panel`, and its select path REFUSES a debt-risk start outright instead of offering Proceed anyway (CMD:904-911, comment 'a panel never signs you up for debt').
- *Evidence:* user_commands.py:93-151; views.py:90-174 (_HeistSelect), 118-139 (_ConfirmDebtView path) ↔ /home/user/CuffBot/src/modules/heist/commands/heist.js:264-303 (verified), 873-929 (panel refusal per module map)


**H3. Crew robbery cooldown enforced (8h) that the source never checks** `different-flow` — **✓ CONFIRMED**

- **Cog:** The crew path never checks or stamps a cooldown: `heist crew` gates only debt/jail/level/active (user_commands.py:153-186) and _BeginCrewBtn sets active_heist without touching heist_cooldowns (views.py:1034-1075). Crews can run back-to-back.
- **CuffBot:** `!heist crew` refuses when crew_robbery is cooling down ('⏱️ Crew robbery is still cooling down for you — ready <t:R>', CMD:637-641) and startCrewHeist stamps the 8h crew_robbery cooldown on ALL four members (service.js:526), so every participant is locked out of organising for 8 hours after one run.
- *Evidence:* views.py:1034-1075 (no cooldown stamp); user_commands.py:153-186 (no cooldown gate) ↔ /home/user/CuffBot/src/modules/heist/commands/heist.js:637-641; /home/user/CuffBot/src/modules/heist/service.js:516-533


**H4. Crew joiners are not level-gated — any level-1 player can join** `different-flow` — **✓ CONFIRMED**

- **Cog:** _JoinCrewBtn rejects joiners below level 20: 'You must be **level 20** or higher to join a crew robbery.' (views.py:977-981).
- **CuffBot:** The join button checks only jail/debt/active-job via unavailable() (events/buttons.js:24-30, 58-60); only the ORGANISER is level-checked (CMD:633-635). A level-1 player can join a 1M–80M crew heist.
- *Evidence:* views.py:977-981 ↔ /home/user/CuffBot/src/modules/heist/events/buttons.js:24-30, 58-65; /home/user/CuffBot/src/modules/heist/commands/heist.js:633-635



#### MEDIUM (14)

**M1. Lobby joiners are not locked while waiting** `different-flow`

- **Cog:** Joining a lobby stamps a `lobby: True` active_heist placeholder that blocks the member from starting any other heist until the lobby resolves or times out (views.py:985-993, timeout cleanup views.py:1143-1153).
- **CuffBot:** joinCrewLobby only mutates the in-RAM lobby (service.js:478-483); no player record changes, so a joined member can walk off and start a solo job — the begin press then fails with '🚫 <@id> can't go: you already have a job


**M2. Job-board panel shows raw table rewards for loot jobs: '0–0 🍩' and '100–5,000 🍩'** `different-numbers`

- **Cog:** The selection view swaps in the loot item's sell range for loot-typed jobs: 'Reward: 1,500–3,500 … (loot)' for street_bike, 8,000–12,000 for street_motorcycle, 20,000–30,000 for street_car (views.py:226-230).
- **CuffBot:** jobPanel always prints minReward–maxReward (panels.js:97), so street_bike and street_motorcycle show '0–0 🍩' and street_car shows '100–5,000 🍩' (tables.js:185-199) — while the job actually pays the vehicle item. Only `!h


**M3. `heist profile` and `heist shield` commands missing; fallback answers '🚫 No such job.'** `missing-feature`

- **Cog:** `heist profile` shows a dedicated card: active heist, jail state with bail breakdown, ✅/❌/🚨 stats plus Total, heat bar (user_commands.py:327-374). `heist shield` reports the equipped shield's reduction % and count or 'No
- **CuffBot:** Neither subcommand exists; the `fallback: 'play'` route turns `!heist profile` / `!heist shield` into '🚫 No such job. `!heist jobs` lists them all.' (CMD:238, 275-277). The bare `!heist` overview covers level/heat/record


**M4. Admin surface: bot-owner-only global `heistset` group became ManageGuild `!heist` subcommands** `different-flow`

- **Cog:** All tuning lives in a separate prefix-only group `[p]heistset …` locked to the bot owner (`@commands.is_owner()`, owner_commands.py:38-41); settings are stored globally for every guild.
- **CuffBot:** Tuning is `!heist admin/tune/pricing/event` requiring Manage Server (CMD:673, 798, 812, 822) with per-guild storage (service.js:334-356) — any server admin, not just the bot owner, can retune jobs, prices and events, per


**M5. `heistset cooldownreset` and `heistset resetprice` have no equivalent** `missing-feature`

- **Cog:** `heistset cooldownreset <member> [heist_type]` clears one or all per-user heist cooldowns (owner_commands.py:132-153); `heistset resetprice [item]` restores one or all shop prices to defaults (owner_commands.py:106-130).
- **CuffBot:** Admin actions are only show/set/reset/price/event ('🚫 Unknown action. Try: show, set, reset, price, event', CMD:791). No way to clear a player's cooldowns; `admin reset` clears job overrides only (CMD:736-749) and price 


**M6. Event start: modal asking multiplier + minutes replaced by fixed 2×/24h button** `different-flow`

- **Cog:** The event panel's Start button opens a modal: 'Multiplier (2–5)' and 'Duration (minutes)' (min 1 minute, up to 5 digits), then '🎉 **{n}x reward event** started! Ends <t:R> (<t:f>).' (events.py:52-105).
- **CuffBot:** The panel's Start button immediately starts a hardcoded 2× for 24 hours — no modal (events/panels.js:28-29, 193-197). Custom values only via typed `!heist admin event <2-5> [hours]`, duration in HOURS (default 1, capped 


**M7. Shop: gates dropped, panel stays open after purchase, quantity buying added** `different-flow`

- **Cog:** `heist shop` is gated by jail, debt and active heist (user_commands.py:77-82), and the ShopView disables itself entirely after ONE purchase (views.py:337-340) — one item per open shop.
- **CuffBot:** `!heist shop` has no gates (CMD:369-380); the panel refreshes after each buy and stays usable indefinitely (events/panels.js:92-98); `!heist buy <item> [amount]` additionally purchases 1–100 at once (CMD:407-434, service


**M8. Shop panel: broke buyer gets 'Nothing by that name on the shelf.' instead of a funds error** `different-texts`

- **Cog:** Insufficient funds on the shop select answers 'Not enough funds. Need **X**, you have **Y**.' (views.py:322-326).
- **CuffBot:** events/panels.js:86 branches on error === 'too-poor' but buyItem returns error 'poor' (service.js:229), so a player picking an item they cannot afford falls to the generic '💰 Nothing by that name on the shelf.' — a wrong


**M9. Craft panel: missing materials shows 'That is not a recipe.'** `different-texts`

- **Cog:** Crafting without materials answers 'Missing materials: …' listing the shortfall (views.py:1359-1367).
- **CuffBot:** events/panels.js:213 checks error === 'missing-materials' but craftPlan returns 'missing' (lib/crafting.js:19), so a shortage press shows '🔨 That is not a recipe.' The Craft button is normally disabled in that state (pan


**M10. Shield/tool/material and crew flavour lines are fixed, not random** `different-texts`

- **Cog:** Every flavour pool is drawn with random.choice: shield/tool/material one-liners on solo results (handlers.py:64-74 via meta.py pools) and crew narration (handlers.py:539-545).
- **CuffBot:** outcomeEmbed hardcodes FLAVOUR_SHIELD[0], FLAVOUR_TOOL[0], FLAVOUR_MATERIAL[0] (commands/heist.js:90, 102, 105) and crewOutcomeEmbed uses pool[0] (CMD:131, 155) — players see the exact same lines ('Your armour took the h


**M11. Panels never expire (source views go dead after 120–180s)** `different-flow`

- **Cog:** Every view times out and disables its controls: selection/shop/equip/craft 120s, config/price/event 180s, confirms 60s (views.py:281-285 and per-view on_timeout handlers).
- **CuffBot:** PANEL_TIMEOUT_MS = 120_000 is declared (panels.js:26) but never referenced; panel state rides in the customId so every panel stays pressable forever and even survives bot restarts (panel-runtime.js:41-48).


**M12. 'In Progress' card omits potential loss, adds gear lines and police %** `different-texts`

- **Cog:** _HeistStartedView: '## {emoji} {Heist} - In Progress / You're in. No turning back now.' + Results <t:R> (<t:f>), 'Success chance: min–max%', 'Potential loss: min–max' (views.py:177-187).
- **CuffBot:** The start embed reads 'You slip away into the night. The job lands <t:R>.', optionally equipped tool/shield lines, then a footer 'Success x–y% · police N% · run any `!heist` command afterwards…' (CMD:310-327). Potential 


**M13. Components v2 layout cards replaced by classic embeds with bold titles and accent colors everywhere** `different-presentation`

- **Cog:** All player surfaces are LayoutView containers with '## ' H2 headers and Separators; accent colors appear ONLY on result cards (handlers.py:322-327).
- **CuffBot:** Everything is a classic embed; headers are bold text, never H1/H2 — an explicit owner mandate ('Sommige teksten zijn veelste groot', panels.js:114-121, enforced by the S114 build guard) — and every card carries crime-red


**M14. Crew lobby gains Leave and Cancel buttons plus a one-lobby-per-channel rule** `extra-feature`

- **Cog:** The lobby has exactly two buttons: 🤝 Join Crew and 🚀 Begin Heist (views.py:935-1075). A joiner cannot leave and the organiser cannot call it off — only the 3-minute timeout ends it. Nothing stops two organisers opening l
- **CuffBot:** Four buttons: Join, Leave, Begin, ✖️ Cancel (CMD:174-188); Leave/Cancel flows in events/buttons.js:68-88 ('You left the crew.', '👥 Crew Robbery — called off'). `!heist crew` also refuses when 'A crew is already forming i



#### LOW (9)

**L1. Jailed players can browse inventory/jobs/shop/level — source jail-gates them** `different-flow`

- **Cog:** check_jail gates inventory, shop, cooldowns, shield, sell, craft and equip — a jailed player triggers the bail prompt instead of seeing any of them (user_commands.py:77, 200, 268, 298, 312, 415).
- **CuffBot:** `!heist inventory` (CMD:481-483), `jobs` (345), `shop` (373), `catalogue` (386) and `level` (833) run with no jail check; only play/buy/sell/craft/equip/crew are blocked.


**L2. `!heist jobs` (alias cooldowns) is a payout-sorted price list, not the cog's Ready/On-Cooldown card** `different-presentation`

- **Cog:** `heist cooldowns` lists heists alphabetically split into '**On Cooldown**' (<t:R>) and '**Ready**' (✅) sections, no payout/odds shown (user_commands.py:420-452).
- **CuffBot:** One list sorted by maxReward ascending, each line 'emoji **Name** — pays · min–max% · ✅ ready | ⏱️ <t:R>' with a 'risk rises with the payout' footer (CMD:348-364).


**L3. `!heist admin show` lists only overrides; source's `heistset settings` prints every heist's full table** `different-presentation`

- **Cog:** 'Heist Settings' embed with one inline field per heist showing reward/risk/success/cooldown/duration/police/jail/loss for ALL heists, ⭐ marking customized values (owner_commands.py:163-226).
- **CuffBot:** '⚙️ Heist tuning' shows only the override lines, or 'No overrides — every job runs on the ported defaults.' (CMD:684-707). Full per-job values are visible only one job at a time in the `!heist tune` panel.


**L4. Admin value entry: 0–1 floats, looser minimums, no min/max cross-checks** `different-numbers`

- **Cog:** The value modal takes risk/police_chance as a PERCENT 0–100 and stores /100 (views.py:641-646); cooldown/jail_time min 60s, duration min 30s (views.py:659-666); min/max reward and success are cross-validated against each
- **CuffBot:** risk/policeChance are typed as raw 0–1 floats (service.js:342-343); cooldown/jail min 0, duration min 5s, all capped at 604,800/86,400s (SVC:344-346); no cross-field validation, so minReward > maxReward is accepted. Non-


**L5. Crew result card wording drifts: bail shown on caught line, shield-held line, level-up without numbers** `different-texts`

- **Cog:** Per-member caught line is '🚨 Caught - jail until <t:R>' with NO bail amount (handlers.py:495); a fully-shielded member reads '-0 {currency}' (handlers.py:460-462); level-up reads 'Level up! a -> b 🎉' (handlers.py:533).
- **CuffBot:** Caught line appends ', bail N 🍩' (CMD:146); full shield reads 'No losses — the shield held.' (CMD:145); level-up is just '· Level up! 🎉' without the numbers (CMD:148). Also the source card mentions all members under the 


**L6. `!heist play crew_robbery` replies with stale dev text 'that lands in a later slice'** `different-texts`

- **Cog:** crew_robbery is simply filtered out of the solo picker (crew_size filter, user_commands.py:121) — a player can never attempt to solo-start it.
- **CuffBot:** Typing it answers '🚫 Crew robbery needs a four-officer lobby — that lands in a later slice.' (CMD:279-281) — internal build-plan wording shipped to players, and factually stale since `!heist crew` exists.


**L7. Consumable slot and 💊 Consumables inventory section dropped** `missing-feature`

- **Cog:** EquipView shows three slots (Shield/Tool/Consumable, views.py:1263-1275) and inventory shows a 💊 Consumables section (user_commands.py:213-219) — even though no consumable items exist in ITEMS, the UI surface is there.
- **CuffBot:** Only shield and tool slots exist (EQUIP_SLOTS panels.js:208, recorded divergence 213-217); inventory sections are Shields/Tools/Loot/Materials (CMD:489-509). Since the cog has zero obtainable consumables, this is cosmeti


**L8. Text-first extras with no cog counterpart** `extra-feature`

- **Cog:** The cog has no bare-group status card (bare `heist` shows default group help), no player price-list command, no direct equip/unequip/craft-by-name commands (view-only), no job-name shorthand, and the config view has no p
- **CuffBot:** Bare `!heist` renders a status overview (level/heat/record/ready-count, CMD:239-261); `!heist catalogue` is a player-readable price list (381-406); `equip <item>`/`unequip <slot>`/`craft <recipe>` work by name (435-475, 


**L9. Hybrid slash+prefix invocation replaced by '!' prefix only** `text-only-mandate`

- **Cog:** Player commands are a hybrid group — both `[p]heist …` and `/heist …` slash commands (user_commands.py:48-51); `heistset` is prefix-only.
- **CuffBot:** Everything is `!heist <sub>` text commands via the Red-style group framework (CMD:233-238); no slash surface. This is the S68 owner mandate — invocation-style divergence only.



**What genuinely matches:** The numeric and mechanical core is a faithful port. All 23 solo jobs + crew_robbery carry identical default values across every column — reward, success band, duration, cooldown, loss, police %, jail time, material-drop %, XP (tables.js:139-263 ≡ utils.py:442-831, including street_car's odd raw 100–5,000 reward pair, which exists verbatim in the cog too). Shop shield/tool costs and effects, loot/material sell ranges, and all 28 recipes match exactly. The solo resolution pipeline is order-faithful: tool consumed even on failure → roll = drawn% + trunc(boost·100) + level bonus capped 1.0 → loot item for loot-named jobs vs cash × event multiplier → shield single-use, loss ×(1−reduction) → unpayable loss becomes debt +20% tax only when consented → heat +1 / materialHeat +1 → drop chance base+4%/pity cap 90%, qty 1–3/1–2, pity reset → police base+2%/heat cap 90% → arrest zeroes heat, bail = trunc(maxLoss·U(0.5,1.0)) + 15% tax, confiscation/seizure rules identical → stats → XP full/20% min 1/0. Crew resolution keeps the shared raw roll (no tool/level bonus), trunc split, per-member shield and police, the crew-specific police-before-material order, 1–2 crew drops, no loot/confiscation, and even the unreachable tool-share boost. Leveling (cap 120, floor(100·n·(1+0.12n)) curve, +0.5%/level cap +20% at 40), heat decay 1 per 2 idle hours, bail clearing both heat counters, anyone-can-bail, lazy settlement + armed timers + restart re-arm with immediate overdue fire, solo outcome-card wording (flavour pools verbatim, '+X added to your balance', jail/bail lines, XP line with dot bar) and result colors (0xFF0000/0xA020F0/0xFF6600), pagination sizes (7 jobs, 10 recipes, 25 options), lobby slots/180s timeout, organiser level-20 gate, event multiplier bounds 2–5, and the empty-inventory line 'Your inventory is empty and you have no debt.' all match the cog. The gaps listed are real, but they sit in the interaction flow and the admin/panel shell — not in the game math.

---

## 5. M27.1 rebuild plan — sessions are cut from THIS list

Standing target (owner): a player who knows the source cog must not be able to tell ours apart, except where the S68 text-only mandate replaces slash invocation with `!command`.

**City (estimate: 3–4 sessions)**

- **City-A — entry + attempt flow 1:1.** `!crime` becomes the cog's "🌃 Criminal Underworld" menu (record field + 8-action dropdown with (Unavailable) annotations); the confirm step ("Your move, boss. You ready?" — success rate + potential fine, free Cancel, cooldown only at resolution); narration on **every** path including the text commands; `!crime status` built.
- **City-B — the money moments.** Panel 🎲 draws a real scenario (fixes city finding H1); bail prompt with Pay/Cancel and the cost preview; jailbreak samples 1–3 events (not all 12) and reports its real embeds from the panel buttons; post-failure Jail Break / Pay Bail buttons.
- **City-C — missing surfaces.** Inventory view + item selling; `notify_ping` perk + release notification (needs a release timer — heist's scheduler is the pattern); jail-pass second-buy block; anti-farm + jailed-victim rules on *all* targeting paths.
- **City-D — admin + presentation parity.** `crimeset` per-crime tuning (success_rate/reward/cooldown/jailtime/fine/reload_defaults) + custom scenario add/list/remove + admin jail/cooldown toggles + owner wipe; the cog's green/red fielded result embeds, leaderboard format, texts.

**Heist (estimate: 2–3 sessions)**

- **Heist-A — flow.** `!heist` bare (and `!heist start`) opens the job picker as THE start path; debt/jail pay-now confirm prompts; lobby joiner level-20 gate; drop the invented 8 h crew cooldown; lobby locking.
- **Heist-B — surfaces.** `!heist profile`, `!heist shield`; jailed players gated out of browsing; consumable slot + 💊 inventory section; event modal (multiplier + minutes) instead of fixed 2×/24 h.
- **Heist-C — parity sweep.** Loot-job reward display ("0–0 🍩" bug), shop gates + close-after-purchase, randomized flavour lines, panel timeouts, `heistset` parity (cooldownreset, resetprice, full settings print, value ranges), text fixes incl. the stale "lands in a later slice" reply.

**One open decision, flagged rather than guessed:** strict 1:1 would also *delete* our extra text surfaces (`!crime bank`, `!crime buy`, the per-crime commands). Recommendation: keep them as typed entry points into the *same* 1:1 flows (S68 text-only needs typed entries), and remove only what contradicts the cog. Cheap to delete later if the owner wants strict.

---

## 6. The queued items, scoped (M27.2–M27.5)

- **M27.2 Steal rework — MEDIUM (one session).** Current: flat 500 🍩, 30% odds, 3 h thief cooldown, failure feeds the pot, target required. Changes: random 5–500; per-victim once-per-day stamp; no steal-backs (`lastRobbedBy`); caught → **victim takes from the thief** (replaces the pot inflow — pot texts/manual updated to match); no member named → random eligible target (hunting's picker is the proven pattern); all replies embeds; last slash references removed (module description + one manual heading). Two sub-decisions with recommendations: "robbed once/day" counts **successful** robberies (that is what "bestolen" means), and caught pays the victim, not the pot.
- **M27.3 Chat-killer announcement — SMALL.** The award path is deliberately silent today (the S99 manual documents silence as a principle — that section gets rewritten, not appended). Plan: pure `killAnnouncement()` text builder, channel stashed at kill time, post "X killed the chat for the Nth time" with empty `allowedMentions` (name renders, nobody pinged).
- **M27.4 Hammertime US zones — SMALL.** Verified live in this container: `EST` currently resolves to 5 Caribbean zones (not New York), `CST` to 13 Mexico/Central-America zones, `PST` leaks through as a literal pseudo-zone. Plan: a season-independent alias table checked first — `est/edt→America/New_York`, `cst/cdt→America/Chicago`, `mst/mdt→America/Denver`, `pst/pdt→America/Los_Angeles` — single match applies instantly, no picker. (MST→Denver, the canonical "Americans say MST" reading; Phoenix would pin winter time year-round.) Bonus fix: the zone cache never rebuilds, so DST flips make it stale on a long-running Pi.
- **M27.5 Module disable — MEDIUM.** Gate commands in the **router** (loader already stamps `command.module`); gate events + component pumps in the **loader's wrapper** (one choke point); never gate ready/once handlers — timer-driven sends (heist scheduler, killcounter) need one service-side check each. Admin surface: a `!modules` group (list/disable/enable), refusing to disable `core` (it carries the re-enable command). Recommendation per skill lesson 0.5.54: a disabled module's commands answer a quiet one-line refusal, **not** silence — a silently-dead known command is exactly how `!city` was lost for eleven sessions. Single-guild bot, so per-guild ≈ global in practice.

---

## 7. Repo health — findings beyond the queue

1. **`welcome` is the only module without a dedicated test file** (covered inside `logbook-welcome.test.js`). Low risk, worth one small session alongside other cleanups.
2. **Manual "Last updated" headers have rotted systemically**: absent in 12 of 37 manuals, more than 15 sessions stale in 17 more (worst: records says S8, last touched S134). The manual *content* is co-committed with source and near-parity — it is the header line that lies. No guard covers it; this is the sixth instance of the hand-maintained-list pattern (skill 0.5.46). Fix: a docs-consistency guard or deleting the header in favour of git history.
3. **16 truly dead exports** (never referenced in src or test), e.g. `city/service.js resetCity`, `mafia/service.js resetMafiaTables`, `transcribe/voice/session.js drainBeforeLeaving`. One cleanup commit.
4. **`STATE.md` is 130 KB** — operationally heavy for the Orient step every session pays. Worth pruning to current-truth + pointers into SESSION_LOG.
5. **SESSION_LOG dates wobble ±1 day** vs commit dates around S130–S134. Append-only journal, so noted rather than rewritten.
6. Hammertime's zone cache ignores its `nowMs` argument once built (stale after a DST flip on a long-running Pi) — folded into M27.4.

---

## 8. Recommended order

| # | Session(s) | Item | Why here |
|---|---|---|---|
| 1 | S136 | **City-A** (menu + confirm + narrate-everywhere + status) | The owner's top complaint, third report; City-A is the shape of the game |
| 2 | S137 | **City-B** (panel scenario fix, bail prompt, jailbreak truth) | The verified worst gameplay bugs |
| 3 | S138 | **Heist-A** (start flow, pay-now prompts, crew gates) | All four verified heist items land here |
| 4 | S139 | **Steal rework** (M27.2) | Explicit owner spec, self-contained |
| 5 | S140 | **Chat killer + Hammertime US zones** (M27.3+M27.4, both small) | Two small items, one session |
| 6 | S141–S142 | **City-C/D, Heist-B/C** | The long tail of 1:1 |
| 7 | S143 | **Module disable** (M27.5) | Touches core routing — calmer after the game rebuilds |
| 8 | — | Health items §7 (welcome test, dead exports, manual headers, STATE.md diet) | Fold into retro slots of the above |

---

*Generated in S135. Verification transcript: workflow `wf_2f92b2c2-ce6` (16 agents, 8 adversarial verdicts). Source clones at audit time: CalaMari-Cogs and maxcogs HEAD of 2026-07-31.*
