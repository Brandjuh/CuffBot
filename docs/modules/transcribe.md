# Transcribe — Module Manual

> Part of **CuffBot**, the police-themed Discord bot. This manual is the single source of truth for what the module does and how to operate it. If the code and this manual disagree, that is a bug — fix one of them and log it.

**Status:** stable
**Last updated:** Session 110 · 2026-07-26

## Purpose

The transcription desk (M21, owner request: *"Speech to text, voice chats en voice memos worden in het engels getranscribeerd"*). Two halves, one module:

- **Voice memos (M21.1, S101).** Post a voice message and the bot replies with what was said.
- **Live voice chat (M21.2, S102).** `!transcribe join` and the bot sits in the voice channel writing down the conversation as it happens.

Both produce **English**, whatever language was spoken. Anyone who cannot listen right now — in a meeting, on a train, deaf or hard of hearing — can still read the room.

## Commands

Transcribing a memo on request is public; every knob, and everything to do with live voice, is **Manage Server**.

| Command | What it does | Key options | Who may use it | Example |
|---|---|---|---|---|
| `!transcribe` | Status: on/off, the service, the language, the scope, today's usage, whether it is in a voice channel | none | Everyone | `!transcribe` |
| `!transcribe now` | Transcribe the recording you replied to | none | Everyone | *(reply to a memo)* `!transcribe now` |
| `!transcribe join` | Join **your** voice channel and transcribe it into this channel | none | Manage Server | `!transcribe join` |
| `!transcribe autojoin` | Join a voice channel by myself when somebody is in it | `<true\|false>` | Manage Server | `!transcribe autojoin false` |
| `!transcribe voicechannel` | Auto-join only these voice channels | `<channel>` | Manage Server | `!transcribe voicechannel 🔊General` |
| `!transcribe leave` | Leave the voice channel and stop | none | Manage Server | `!transcribe leave` |
| `!transcribe pair` | Say which text channel goes with a voice channel — omit the text channel to unpair | `<voice> [text]` | Manage Server | `!transcribe pair 🔊General #general` |
| `!transcribe pairs` | **Where every voice channel writes**, and why | none | Everyone | `!transcribe pairs` |
| `!transcribe unpair` | Remove a pairing — takes a deleted channel's raw id too | `<voice>` | Manage Server | `!transcribe unpair 411633952961593345` |
| `!transcribe ignore` | Never transcribe this member (toggle) | `<member>` | Manage Server | `!transcribe ignore @Soundboard` |
| `!transcribe bots` | Transcribe other bots too — **off by default, which is what ignores music** | `<true\|false>` | Manage Server | `!transcribe bots false` |
| `!transcribe timestamps` | Stamp each live line with `HH:MM` | `<true\|false>` | Manage Server | `!transcribe timestamps false` |
| `!transcribe on` / `off` | Start / stop transcribing memos automatically | none | Manage Server | `!transcribe off` |
| `!transcribe auto` | Which attachments are transcribed uninvited | `<voice\|files> <true\|false>` | Manage Server | `!transcribe auto files true` |
| `!transcribe english` | Always English, or keep the spoken language | `<true\|false>` | Manage Server | `!transcribe english false` |
| `!transcribe channel` | Toggle a channel in the covered list | `<channel>` | Manage Server | `!transcribe channel #general` |
| `!transcribe everywhere` | Cover every channel again | none | Manage Server | `!transcribe everywhere` |
| `!transcribe limit` | Longest recording, and how many per day | `<duration\|daily> <value>` | Manage Server | `!transcribe limit duration 120` |

Aliases: the group answers to `!stt` and `!statement`; `join` takes `listen`, `leave` takes `stop`.

### Auto-join (S110)

**The bot lets itself in.** The moment somebody enters a voice channel, CuffBot follows and starts transcribing into the text channel **with the same name** — the owner's own server convention. When the last person leaves, it leaves.

**"The same name" is not string equality.** Discord lowercases text-channel names and turns spaces into hyphens, so a voice channel called `🎙️ Squad Room` is `squad-room` as a text one. The matcher normalises both sides: strips emoji and dividers (`・`, `|`, `—`), folds accents, and collapses everything else to hyphens. Four passes, most specific first:

0. **A declared pairing** (S111) — see below. A statement of fact beats every inference underneath it, including a perfect name match.
1. **Exact** on the normalised name. Two channels with the same name → the one in the same category.
2. **Containment, same category only** — `squad-room` finds `squad-room-chat`, but a `general` voice channel will never adopt `general-announcements` from the other side of the server.
3. **Nothing matched** → the transcript goes to the **voice channel's own built-in text chat**. That is always the right room by construction and is never a guess; a wrongly-guessed channel would put a private conversation somewhere it does not belong. The bot says so when it happens.

An ambiguous near-miss (two candidates, neither exact) is **refused**, not guessed.

**It announces itself, every time.** The bot let itself in, so the "🔴 Recording" line matters more here than for a manual `!transcribe join`, and it names both switches that stop it.

It stays out entirely when: auto-join is off, the desk is off, the channel is outside `voiceChannelIds`, there is no `GROQ_API_KEY`, or it lacks **Connect** on the voice channel or **Send Messages** in the text one. All of that is checked *before* joining, so it never appears in a channel it cannot actually work in.

### Groq's real limits (S123)

Owner: *"Ik wil geen budgetten gaan gokken, wat zijn de officiele rate limits hiervan?"* Fair — the old `100/day` was invented in S101 and corresponded to nothing Groq publishes. These are the documented **free-tier** limits, and what the module now enforces:

| Limit | Value |
|---|---|
| Requests / minute | **20** |
| Requests / day | **2,000** |
| Audio-seconds / hour | **7,200** (2 hours of audio) |
| Audio-seconds / day | **28,800** (8 hours of audio) |
| **Minimum billed per request** | **10 seconds** |

**That last row is the one that shapes everything.** A live speaker turn is often 1–3 seconds and is charged as ten, so sending each turn separately threw away most of the budget. Two consequences:

- **Turns are batched** toward the 10-second floor before being sent. Six 1.5-second turns cost **60** audio-seconds sent separately and **10** batched — a 6× saving, and Whisper transcribes better with the context. Batching never claims a saving where there is none: three 12-second turns cost 36 either way, and the arithmetic is tested for exactly that.
- **A lone remark is never stranded.** If nobody else speaks, held audio goes out after 6 seconds regardless, and everything held is flushed when the bot leaves.

**The per-minute cap is enforced locally**, so a busy channel is throttled by us rather than collecting 429s from Groq and silently losing turns. Each refusal names *which* window it hit and when it frees up.

`!transcribe` shows all of it: `0/20 this minute · 0/2000 today · 0/120 audio-min this hour`, with a warning once the tightest window passes 80%.

**`dailyLimit` still exists but now defaults to `0` (off).** Set it only to spend *less* than Groq allows.

### What the daily limit counts (S121)

Owner: *"is dat 100 minuten? 100 seconden? 100 berichten?"* — none of those. It counts **transcriptions**: pieces of audio actually turned into text. `spendBudget` adds exactly **1 per successful call, regardless of length**, so a 9-minute memo and a 3-second one cost the same.

**That is generous for memos and expensive for live voice**, and the difference is worth understanding before setting the number:

| What | Cost |
|---|---|
| A voice memo, any length up to the duration cap | **1** |
| `!transcribe now` on an old recording | **1** |
| **One speaker turn in a voice channel** | **1** |

A live "turn" ends after **800 ms** of silence and is force-cut at **25 s**, so a normal two-person conversation produces something like 4–10 turns a minute. **100 transcriptions is therefore roughly 10–25 minutes of live conversation**, after which everything — including voice memos — stops until midnight UTC.

The default of `100` was chosen in S101, when memos were the only thing that spent it. If the precinct uses auto-join much, raise it: `!transcribe limit daily 2000`. `!transcribe` shows today's usage so the burn rate is visible before it runs out.

### Ignoring music (S117)

Owner: *"Is er ook een manier om muziek te negeren?"* Yes — and until S117 the case that matters was broken.

**A music bot is an ordinary speaker to the voice receiver.** Discord hands the bot one audio stream per speaking user id, and nothing distinguished a person from a jukebox: the music was captured, muxed to Ogg, uploaded to Whisper and written into the channel as garbled lyrics — spending the daily budget on it.

`ignoreBots` is now **on by default**, and the check happens *before* a subscription exists, so a skipped speaker costs nothing at all. `!transcribe bots true` turns it off if you ever want the opposite. `!transcribe ignore @member` does the same for one person (a soundboard account, or somebody who asked not to be recorded).

**What this does not cover:** music playing through a *human's* microphone. That is indistinguishable from speech at the stream level. Whisper's silence-hallucination filter catches some of it; the rest would need audio analysis the bot deliberately does not do.

### Declared pairings (S111)

The name matcher is an inference. When the owner *says* which text channel goes with which voice channel, that is a fact, and a fact must never lose to an inference — so a declared pairing is consulted first and wins outright.

Four pairings ship as **code defaults** (`DEFAULT_VOICE_PAIRS` in `lib/pairing.js`), given by the owner on 2026-07-26 and therefore live the moment the Pi self-updates — no post-deploy configuration:

| Voice channel | Transcript goes to |
|---|---|
| `411633952961593345` | `411634025426321438` |
| `436248103310327808` | `436248239855894538` |
| `442066086159187978` | `442059736263688213` |
| `411634241965916191` | `411634286655963146` |

A guild's own `voicePairs` sits **on top** of those, so `!transcribe pair` corrects a default without touching code.

**`!transcribe pairs` walks the voice channels, not the pairing table (S118).** It used to list only the four stored pairings — which answers *"what is configured"* rather than *"where does each channel write"*, so the majority of rooms, the ones matched by name, appeared nowhere. Now every voice channel gets a row saying where its transcript goes and **why**: paired, matched by name, matched by name in the same category, or its own built-in chat. Overrides this server made are marked as such.

Two things the list calls out rather than hiding:

- **A pairing whose text channel was deleted.** The matcher silently falls through to a name match, which is correct behaviour and unreadable unless the row says so — otherwise you see a working-looking pairing pointing at a channel that is gone.
- **Pairings whose voice channel no longer exists.** They cause no harm, but they are exactly the rows worth cleaning up, so they are listed separately with the command to remove them.

**`!transcribe unpair <voice>` takes a raw id on purpose.** A pairing whose voice channel has been deleted is the one you most want gone, and a channel argument cannot resolve a channel that no longer exists. The reply says what it falls back to — for the four committed pairings that is the built-in default, not "no pairing", and reporting it as removed without that would be wrong.

A declared id that no longer resolves to a real text channel **falls through to the matcher** rather than sending the transcript into a void.

> **Trap, for whoever edits that table next.** The keys are quoted strings on purpose. An unquoted 18-digit snowflake is a JavaScript `Number`, which cannot hold it: `411633952961593345` silently becomes `411633952961593340` and the lookup never matches anything. The source *looks* right and the map simply never hits — and a check that reads the keys back off the object cannot catch it, because it reads the already-rounded value. `test/transcribe-voice.test.js` spells the four ids out again as literals for exactly this reason.

### Live voice, exactly

1. Be in a voice channel, then run `!transcribe join` in the text channel where you want the transcript.
2. **The bot announces the recording in that channel, unprompted.** It is recording people; everyone within earshot is entitled to know without having to run a command to find out.
3. Each speaker's **turn** is transcribed separately. A turn ends when they stop talking for **800 ms** — long enough that a breath mid-sentence does not split a line in two, short enough that the transcript keeps up. A monologue is force-cut every **25 s** so nothing waits for the speaker to finish.
4. Turns shorter than **700 ms** are dropped without an API call: Discord opens a stream for a cough, a keyboard click and an "mm".
5. Lines are batched and posted every few seconds, or sooner when there are enough of them — one message per utterance would flood the channel.
6. `!transcribe leave` stops it and flushes whatever is still buffered.

The bot joins **muted**, because it is never going to talk back, and stays undeafened, because deafening itself would stop the receiver.

### `!transcribe now`, exactly

1. **Reply** to the message with the recording and run `!transcribe now`. That is the precise way and the one to teach.
2. With no reply, the bot scans the **last 25 messages in the channel** for the most recent one carrying audio. That is what makes "…wait, what did that say?" work without scrolling back to copy an id.
3. On request, the desk ignores the on/off switch, the channel list **and** the auto switches — you asked, so it answers. It does **not** ignore the size and duration ceilings, because those are the service's real limits rather than preferences.

## Events

`MessageCreate` — checks for an audio attachment (a cheap test that fails for almost every message) and hands the rest to the service.

`VoiceStateUpdate` (S110) — somebody joined or left a voice channel. The handler owns nothing but the plumbing: whether to join, who to pair with and when to leave are all pure functions in `lib/pairing.js`. **The bot's own comings and goings are ignored**, or joining would immediately re-trigger itself.

Live voice itself uses no gateway event: `@discordjs/voice`'s receiver has its own `speaking` stream, subscribed per speaker while a session is open.

**A refusal on the automatic path is silent by design.** "That channel is not covered" or "no key configured" is an answer to a question nobody asked, and posting it under every audio file would turn the feature into noise. `!transcribe now` says all of it out loud, which is where an admin will be looking when they wonder why nothing happened.

## Configuration

`GROQ_API_KEY` in `.env` on the Pi — the **same key the detective module uses**. See `.env.example`. Without it the module loads, the commands work, and `!transcribe` tells you plainly that no service is configured.

**Dependencies (S102).** Live voice is the first thing in CuffBot that needs more than discord.js. Two declared packages, both installing on a Raspberry Pi with **no compiler**:

| Package | Why | Pi story |
|---|---|---|
| `@discordjs/voice` | Joining a voice channel and receiving audio | Pure JS. Pulls `prism-media` and `@snazzah/davey`; davey ships **prebuilt binaries** for `linux-arm64-gnu` and `linux-arm-gnueabihf`, so `npm ci` downloads rather than builds |
| `@noble/ciphers` | Voice needs an encryption backend or it refuses to connect | Pure JS, **zero transitive dependencies**. Chosen over `sodium-native` (needs a compiler) and `libsodium-wrappers` (WASM blob) |

**No opus binding is installed, and none is needed** — see *How it works*. `npm run doctor` has a **Voice stack** section that reports exactly this and names the fix when something is missing.

Per-guild settings live under `transcribeConfig` and are **sparse** (S35).

| Key | Default | Effect |
|---|---|---|
| `enabled` | `true` | Whether anything is transcribed automatically. `!transcribe now` works either way. |
| `channelIds` | `[]` | **Empty = every channel.** A non-empty list restricts the automatic path to exactly those. |
| `autoVoiceMessages` | `true` | Transcribe Discord's native voice messages without being asked. |
| `autoAudioFiles` | `false` | Transcribe ordinary attached audio files without being asked. |
| `translateToEnglish` | `true` | English out, whatever went in — the owner's literal request. |
| `maxDurationSecs` | `600` | Skip recordings longer than this. `0` = no limit. |
| `autoJoin` | `true` | Join a voice channel unprompted. **On by default** — the owner asked for exactly this. |
| `voiceChannelIds` | `[]` | **Empty = every voice channel.** A non-empty list restricts auto-join. |
| `autoJoinMinimum` | `1` | How many humans must be in the channel first. |
| `ignoreBots` | `true` | Skip other bots entirely. **This is the music switch** — a music bot is an ordinary speaker to the voice receiver. |
| `ignoredUserIds` | `[]` | Members never transcribed. Ids as **strings**. |
| `voicePairs` | `{}` | This server's own voice → text pairings, laid over the four committed defaults. Keys and values are channel ids **as strings**. |
| `dailyLimit` | `100` | **Transcriptions** per UTC day, per guild — not minutes, not messages: pieces of audio actually turned into text. `0` = uncapped. **One call costs 1 whatever its length**, so a 9-minute memo and a 3-second one cost the same. ⚠️ **Live voice spends the same budget one TURN at a time** — see below. |
| `voiceTimestamps` | `true` | Prefix each live line with `HH:MM` (UTC). |

**On the two `auto` switches:** a Discord voice message is unambiguous — somebody recorded a message *for this channel*, so transcribing it uninvited is helpful. An attached `.mp3` is as likely to be a song as a memo, and spending the precinct's API budget on someone's music is the wrong default. Hence: voice messages on, files off, and `!transcribe now` for the rest.

## Permissions & safety

- **Bot permissions needed:** View Channel, Read Message History and Send Messages wherever recordings are posted. Reading attachments needs the **Message Content intent**, already required for every `!command` (S57). Live voice additionally needs **Connect** on the voice channel; the `GuildVoiceStates` intent is already enabled (leveling has used it since S45).
- **Member permissions:** `now` is open to everyone; every configuration subcommand — **and `join`/`leave`** — requires Manage Server. Starting a recording of everyone in a voice channel is not something any member may do.
- **Audio leaves the Pi.** A transcribed recording is uploaded to Groq. That is inherent to the owner's chosen backend and worth stating plainly: do not turn on automatic transcription in a channel where members would not expect their voice notes to be processed by a third party. `!transcribe off` and the channel list are both ways to bound it.
- **A live recording announces itself.** `!transcribe join` posts "🔴 Recording #channel" in the text channel before a single word is captured, and `!transcribe` shows the state at any time. The bot is recording people; that must never be something they have to discover.
- **No pings.** Every transcript carries `allowedMentions: { parse: [] }`; the speaker is named with a rendered mention that notifies nobody.
- **Nothing is stored.** The audio is held in memory for the length of one request and never written to disk; only the daily counter and the config are persisted. The transcript lives in the reply, like any other message.
- **A truncated transcript says it was truncated.** Silently posting half a statement is worse than posting a short one, because the reader cannot tell which they are looking at.

## How it works

- **`lib/transcribe.js` (pure, no discord.js, no network):** `isAudioAttachment` (content-type first, extension as the fallback — mobile clients and re-uploads routinely omit the type), `isVoiceMessage` (Discord's message flag, with the attachment waveform as a fallback), `audioAttachmentsOf`, `eligibility` (returns a **reason**, not a boolean, because the command has to explain a refusal), `formatDuration`, `truncateTranscript`, `transcriptEmbed`, `refusalFor`, and the `dayKey`/`spendBudget` pair behind the daily limit.
- **`lib/audio-provider.js`:** the Groq call. **Zero dependencies** — Node ≥18 has `fetch`, `FormData` and `Blob`, and a multipart upload is exactly those three. `fetchImpl` is injectable, the same seam detective's `providers.js` uses, so the whole suite runs with no network and no key.
- **Two endpoints, two models.** English-out uses Groq's **translation** endpoint with `whisper-large-v3`, which is the only model it accepts. Same-language output uses the **transcription** endpoint with `whisper-large-v3-turbo`, which is markedly faster and translation is the only thing it cannot do. Temperature is pinned to `0`: Whisper invents fluent nonsense over silence when it is warmer.
- **The `Content-Type` header is deliberately absent** from the upload. `fetch` derives it from the `FormData`, including the multipart boundary; setting it by hand drops the boundary and the request fails with an opaque 400. There is a test asserting this, because it is easy to "fix" in the wrong direction.
- **The daily budget is claimed before the work and refunded if the work never happened** (S22 claim-before-send). Two memos landing together cannot both see the last slot free, and a failed download costs the precinct nothing. The counter carries a UTC day stamp, so a new day resets it without any scheduled job.
- **The advertised size is a claim; the bytes are the fact.** The 25 MB ceiling is enforced on the downloaded buffer, not only on the size Discord reported.
- **Only the first audio attachment on a message is transcribed** — otherwise one message's cost is multiplied by however many files it carried.

### Live voice (S102)

- **No audio is ever decoded.** Discord's receiver hands over **Opus packets**; Groq accepts **Ogg/Opus**; so the only missing piece is the container between them. `lib/ogg.js` is a ~150-line pure Ogg muxer (RFC 3533 + RFC 7845) that writes the OpusHead and OpusTags pages and packs the packets. Decoding to PCM instead would have meant a native opus binding — a compiler on the Pi — or `opusscript`, which is pure JS and slow, for no gain at all.
- **Why it is hand-written rather than borrowed:** the obvious answer is prism-media's `OggLogicalBitstream`, but `@discordjs/voice` bundles **prism-media 1.3.5**, whose `opus` export is only Decoder/Encoder/OggDemuxer/WebmDemuxer — `OggLogicalBitstream` exists in the 2.x alpha. That was checked before a line was written, not assumed.
- **Ogg's CRC is its own variant** (polynomial `0x04c11db7`, init 0, no reflection, no final xor) and is *not* zlib's CRC-32. The muxer was cross-checked against **mutagen**, an unrelated Ogg implementation: parsing and re-serialising the output produced byte-identical pages, and `OggOpus` reported exactly the expected duration. The test suite re-checks the round trip with its own reader written independently of the writer — two mirrors of the same mistake would agree with each other.
- **The packet count IS the clock.** Every Opus frame Discord sends is 20 ms, so 50 packets is exactly one second — no wall-clock arithmetic, no drift, and every timing rule is a pure function of an integer. That is what makes `shouldFlush`, `isOverCap` and `isWorthTranscribing` testable without waiting.
- **A turn is a natural unit, not a fixed window.** The receiver's `AfterSilence` behaviour ends a speaker's stream 800 ms after they stop, and that stream is the chunk. A 25 s force-cut handles the monologue case; a 60 s hard cap keeps a stuck stream from growing without bound.
- **Whisper's silence hallucinations are filtered by name.** Given a second of room tone it returns a confident "Thank you." — the same handful of phrases every time. Matching that known set is cheaper and far more reliable than trying to detect silence ourselves, and `formatLine` returns `null` for them so no line is ever created.
- **Lines are batched.** `createLineBuffer` flushes on time *or* on size, so a busy channel does not wait and a quiet one never strands a line; `packLines` splits between lines and hard-splits an over-long one rather than dropping it.
- **The session map is RAM-only.** A restart leaves the voice channel, which is the honest outcome: silently resuming a recording nobody re-authorised would be worse than stopping.

## Files

| Path | Role |
|---|---|
| `src/modules/transcribe/index.js` | Manifest |
| `src/modules/transcribe/lib/transcribe.js` | Pure eligibility, limits, formatting, the daily budget |
| `src/modules/transcribe/lib/audio-provider.js` | Groq Whisper upload + attachment download (injectable `fetch`) |
| `src/modules/transcribe/service.js` | Config, the persisted budget, the download → transcribe → format sequence |
| `src/modules/transcribe/events/message.js` | `MessageCreate` auto path |
| `src/modules/transcribe/events/voice-state.js` | `VoiceStateUpdate` — auto-join and auto-leave (S110) |
| `src/modules/transcribe/lib/pairing.js` | Pure voice ↔ text pairing: the declared table (S111) and the name matcher (S110) |
| `src/modules/transcribe/commands/transcribe.js` | The `!transcribe` group |
| `src/modules/transcribe/lib/ogg.js` | Pure Ogg/Opus muxer (S102) — the reason no decoder is needed |
| `src/modules/transcribe/lib/voice-session.js` | Pure live-voice policy (S102): chunking, hallucination filter, line batching |
| `src/modules/transcribe/voice/session.js` | The only file that touches the voice gateway |
| `test/transcribe.test.js` | Memo coverage |
| `test/transcribe-voice.test.js` | Ogg + live-voice policy coverage |

## Testing

- **Automated:** `npm test` — **`test/transcribe-voice.test.js` (16 tests)** covers the container and the policy with no gateway anywhere: the lacing rules including the 255-multiple trap (a packet of exactly 255 bytes needs a terminating zero); the CRC being Ogg's variant rather than zlib's; OpusHead/OpusTags against RFC 7845; a page refusing to exceed 255 segments instead of silently truncating; a full round trip through **a reader written independently of the writer**, checking BOS/EOS flags, contiguous sequence numbers, one serial, every packet byte-identical and the final granule; an empty capture still being a valid file; an oversized packet refused. Then the policy: packet↔ms conversion, the monologue cut and the hard cap, a cough not being a turn, every known Whisper hallucination filtered while a real sentence that merely starts the same way survives, line formatting with and without stamps, packing that splits only between lines, a single over-long line split rather than dropped, and the buffer flushing on time OR on size and resetting its clock on drain. Then `test/transcribe.test.js` (27 tests) with **no network and no API key**: audio detection by type and by extension incl. the missing-type case; voice message vs attached file incl. the BitField and waveform shapes; every `eligibility` refusal reason and the manual override of the soft ones (but not of size, duration or "that is a bot"); first-attachment-only; duration formatting; truncation at a word boundary with the notice; the embed's speaker/length/language line and the empty-transcript case; the budget's count, block and UTC rollover. Then the provider through an injected `fetch`: translation and transcription hit **different endpoints with different models**, the upload is `FormData` with **no hand-set `Content-Type`** and `temperature: 0`, a missing key / a 429 / a bodyless 200 all throw loudly, and the download enforces the ceiling on real bytes. Then the service: sparse config, claim-and-refund, a full happy path returning a ready embed, honest refusals that never reach the network, over-budget, and a failure refunding its slot. Then the command surface: the subcommand list, the permission split, the status embed naming a missing key, the reply lookup, and every knob writing what it says.
- **Manual (live server) checklist:**
  1. `!transcribe` → the status card. If it says the service is not configured, the key is missing from the Pi's `.env`.
  2. Record a Discord voice message in any channel → within a few seconds the bot replies with a **🎙️ Statement on the record** embed.
  3. Say something in Dutch → the transcript comes back in **English**. `!transcribe english false` → the next one comes back in Dutch.
  4. Attach an `.mp3` → nothing happens (files are off by default). Reply to it with `!transcribe now` → it is transcribed.
  5. `!transcribe channel #general` → the status shows only that channel; a memo elsewhere is ignored. `!transcribe everywhere` puts it back.
  6. `!transcribe limit daily 1`, transcribe twice → the second is refused with the budget message.
  7. **Auto-join, the S110 half:** walk into a voice channel on your own. The bot appears within a second or two and posts "🔴 Recording" in the text channel **with the same name**. Say something → a line appears there. Walk out → the bot leaves and says so. Then `!transcribe autojoin false`, rejoin the channel → nothing happens.
  8. **Declared pairings, the S111 half:** `!transcribe pairs` → the four committed pairings are listed and every `<#id>` renders as a real channel name (a mention that stays a raw id is the snowflake-rounding trap). Walk into one of those four voice channels → the transcript appears in its paired text channel, even if another channel shares its name.
  9. **Live voice, the part only the Pi can prove:** `npm run doctor` → the **Voice stack** section is all ✅. Join a voice channel, run `!transcribe join` → the bot announces the recording and appears in the channel, muted. Talk → a line appears within a few seconds. Have two people talk → both are named correctly. Stay silent for a minute → **nothing is posted** (this is the hallucination filter earning its place). `!transcribe leave` → the bot leaves and the last lines are flushed.

## Troubleshooting

| Symptom | Likely cause | Fix |
|---|---|---|
| Nothing happens on a voice message | The desk is off, the channel is outside the list, or there is no API key | `!transcribe` shows all three; `!transcribe now` says the reason out loud |
| "No transcription service is configured" | `GROQ_API_KEY` is missing from the Pi's `.env` | Add it and restart the service. A Gemini-only key is not enough — only Groq hosts Whisper |
| Transcripts arrive in the spoken language | `translateToEnglish` was turned off | `!transcribe english true` |
| An `.mp3` someone posted is ignored | Automatic file transcription is off by default | Reply with `!transcribe now`, or `!transcribe auto files true` |
| "The precinct has used its transcription budget" | The daily cap was reached | It resets at midnight UTC; `!transcribe limit daily <n>` raises it, `0` removes it |
| "That file is over the 25 MB…" | Groq's upload ceiling | Nothing to fix — shorter recordings, or split the file |
| A transcript ends in *(transcript truncated)* | The speech was longer than one embed holds | Expected. The recording itself is still in the channel |
| `!transcribe join` says it cannot connect | The bot lacks **Connect** on that voice channel, or the gateway refused | Check the channel's permissions; `npm run doctor` → Voice stack rules out a broken install |
| The bot joins but no lines ever appear | No API key, the daily budget is spent, or nobody spoke for longer than 700 ms | `!transcribe` shows the key and the budget; the 700 ms floor is deliberate |
| Lines appear for silence | A Whisper hallucination not yet in the filter list | Add it to `HALLUCINATIONS` in `lib/voice-session.js` — the list is data, not logic |
| The bot left the voice channel on its own | The process restarted, or the connection dropped and could not resume | By design: a recording nobody re-authorised must not resume silently. `!transcribe join` again |
| The transcript is nonsense over a silent recording | Whisper hallucinating on silence | Known model behaviour; temperature is already pinned to 0, which minimises it |

## Changelog

| Session | Change |
|---|---|
| S123 | **The budget is Groq's, not one we invented** (owner: *"Ik wil geen budgetten gaan gokken"*). Enforces the published free-tier limits — 20/min, 2,000/day, 7,200 audio-sec/hour, 28,800/day — including the **10-second minimum billed per request**, with a local per-minute throttle so a busy channel is not answered with 429s. Short voice turns are **batched toward that floor**, worth up to 6× more conversation on the same budget. `dailyLimit` becomes an optional extra ceiling, default off. Also removed a duplicate **Auto-join** line the S118 edit had left in the status. |
| S121 | **The limits say what they measure.** Owner asked whether `100` meant minutes, seconds or messages — nothing anywhere said. The status now reads `3 / 100 transcriptions · resets at midnight UTC`, shows the recording-length cap (which was invisible), and `!transcribe limit` states the unit each choice takes and spells out that live voice spends the same budget one **turn** at a time. |
| S118 | **`!transcribe pairs` answers the question it was asked** (owner: *"een optie dat ik kan zien welke VC kanalen aan welke kanalen zijn gekoppeld"*): it walks every voice channel instead of the pairing table, so rooms matched by name — most of them — are no longer invisible, and each row states its reason. Deleted targets and orphaned pairings are flagged rather than rendered as broken mentions. New **`!transcribe unpair`** takes a raw id so a deleted channel's pairing can still be cleaned up, and names the fallback rather than just saying "removed". |
| S117 | **Music is ignored**, **auto-join says why it is not firing**, and usage lines spell out their options. A music bot was being transcribed because the receiver saw it as an ordinary speaker (`ignoreBots`, on by default, checked before subscribing). The bare `!transcribe` status gained an **Auto-join** line naming which of five conditions is blocking it and the fix for each — every refusal in the handler is a silent `return`, which is right for a background feature and useless for diagnosing one. `!transcribe auto` now reads `<voice|files> <true|false>` instead of `<kind> <state>`, framework-wide. |
| S111 | **Declared pairings** (owner gave four VC → text channel ids): a stated pairing beats the name matcher, because a fact must not lose to an inference. The four ship as code defaults (S35) so they work the moment the Pi updates; `!transcribe pair` overrides one per guild, `!transcribe pairs` lists what is in force, and a stale id falls through to the matcher instead of posting into a void. |
| S110 | **Auto-join** (owner request): the bot follows anyone into a voice channel and transcribes into the text channel with the matching name, then leaves when the room empties. Name matching is pure and normalised (emoji, dividers, accents, Discord's own hyphenation), exact beats near, near only inside the same category, ambiguity is refused, and an unmatched channel falls back to the voice channel's own built-in chat. On by default with `!transcribe autojoin false` to stop it and `!transcribe voicechannel` to narrow it. |
| S102 | Live voice chat (M21.2): `!transcribe join`/`leave` — the bot sits in a voice channel and writes the conversation into a text channel, per speaker, announcing the recording unprompted. **No audio decoder**: Opus packets are muxed straight into Ogg by a hand-written pure muxer, cross-checked against `mutagen`. First dependencies beyond discord.js (`@discordjs/voice`, `@noble/ciphers`), both compiler-free on a Pi; `npm run doctor` gained a Voice stack section. 16 more tests, still none touching a gateway. |
| S101 | Created (M21.1, owner request + owner backend decision): voice messages and audio attachments are transcribed to English via Groq/Whisper, with **zero new dependencies** — the key is the one the detective module already uses. Automatic for voice messages, on request for files, `!transcribe now` for anything out of scope. Per-guild on/off, channel scope, language, duration and daily-budget knobs. 27 tests, none touching the network. |
