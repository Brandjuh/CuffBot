# Transcribe — Module Manual

> Part of **CuffBot**, the police-themed Discord bot. This manual is the single source of truth for what the module does and how to operate it. If the code and this manual disagree, that is a bug — fix one of them and log it.

**Status:** stable
**Last updated:** Session 101 · 2026-07-26

## Purpose

The transcription desk (M21.1, owner request: *"voice chats en voice memos worden in het engels getranscribeerd"*). Post a voice message and the bot replies with what was said, **in English**, whatever language it was spoken in. Anyone who cannot listen right now — in a meeting, on a train, deaf or hard of hearing — can still read the room.

This is the **voice-memo half** of M21. It never touches the voice gateway: a voice message is an ordinary attachment on an ordinary message, so the whole feature is "download a file, POST it, post the answer". The **live voice chat** half (the bot joining a VC and transcribing as people speak) is M21.2 and is a separate module.

## Commands

Transcribing on request is public; every knob is **Manage Server**.

| Command | What it does | Key options | Who may use it | Example |
|---|---|---|---|---|
| `!transcribe` | Status: on/off, the service, the language, the scope, today's usage | none | Everyone | `!transcribe` |
| `!transcribe now` | Transcribe the recording you replied to | none | Everyone | *(reply to a memo)* `!transcribe now` |
| `!transcribe on` / `off` | Start / stop transcribing automatically | none | Manage Server | `!transcribe off` |
| `!transcribe auto` | Which attachments are transcribed uninvited | `<voice\|files> <true\|false>` | Manage Server | `!transcribe auto files true` |
| `!transcribe english` | Always English, or keep the spoken language | `<true\|false>` | Manage Server | `!transcribe english false` |
| `!transcribe channel` | Toggle a channel in the covered list | `<channel>` | Manage Server | `!transcribe channel #general` |
| `!transcribe everywhere` | Cover every channel again | none | Manage Server | `!transcribe everywhere` |
| `!transcribe limit` | Longest recording, and how many per day | `<duration\|daily> <value>` | Manage Server | `!transcribe limit duration 120` |

Aliases: the group answers to `!stt` and `!statement`.

### `!transcribe now`, exactly

1. **Reply** to the message with the recording and run `!transcribe now`. That is the precise way and the one to teach.
2. With no reply, the bot scans the **last 25 messages in the channel** for the most recent one carrying audio. That is what makes "…wait, what did that say?" work without scrolling back to copy an id.
3. On request, the desk ignores the on/off switch, the channel list **and** the auto switches — you asked, so it answers. It does **not** ignore the size and duration ceilings, because those are the service's real limits rather than preferences.

## Events

`MessageCreate` — checks for an audio attachment (a cheap test that fails for almost every message) and hands the rest to the service.

**A refusal on the automatic path is silent by design.** "That channel is not covered" or "no key configured" is an answer to a question nobody asked, and posting it under every audio file would turn the feature into noise. `!transcribe now` says all of it out loud, which is where an admin will be looking when they wonder why nothing happened.

## Configuration

`GROQ_API_KEY` in `.env` on the Pi — the **same key the detective module uses**. See `.env.example`. Without it the module loads, the commands work, and `!transcribe` tells you plainly that no service is configured.

Per-guild settings live under `transcribeConfig` and are **sparse** (S35).

| Key | Default | Effect |
|---|---|---|
| `enabled` | `true` | Whether anything is transcribed automatically. `!transcribe now` works either way. |
| `channelIds` | `[]` | **Empty = every channel.** A non-empty list restricts the automatic path to exactly those. |
| `autoVoiceMessages` | `true` | Transcribe Discord's native voice messages without being asked. |
| `autoAudioFiles` | `false` | Transcribe ordinary attached audio files without being asked. |
| `translateToEnglish` | `true` | English out, whatever went in — the owner's literal request. |
| `maxDurationSecs` | `600` | Skip recordings longer than this. `0` = no limit. |
| `dailyLimit` | `100` | Transcriptions per UTC day, per guild. `0` = uncapped. |

**On the two `auto` switches:** a Discord voice message is unambiguous — somebody recorded a message *for this channel*, so transcribing it uninvited is helpful. An attached `.mp3` is as likely to be a song as a memo, and spending the precinct's API budget on someone's music is the wrong default. Hence: voice messages on, files off, and `!transcribe now` for the rest.

## Permissions & safety

- **Bot permissions needed:** View Channel, Read Message History and Send Messages wherever recordings are posted. Reading attachments needs the **Message Content intent**, already required for every `!command` (S57).
- **Member permissions:** `now` is open to everyone; every configuration subcommand requires Manage Server.
- **Audio leaves the Pi.** A transcribed recording is uploaded to Groq. That is inherent to the owner's chosen backend and worth stating plainly: do not turn on automatic transcription in a channel where members would not expect their voice notes to be processed by a third party. `!transcribe off` and the channel list are both ways to bound it.
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

## Files

| Path | Role |
|---|---|
| `src/modules/transcribe/index.js` | Manifest |
| `src/modules/transcribe/lib/transcribe.js` | Pure eligibility, limits, formatting, the daily budget |
| `src/modules/transcribe/lib/audio-provider.js` | Groq Whisper upload + attachment download (injectable `fetch`) |
| `src/modules/transcribe/service.js` | Config, the persisted budget, the download → transcribe → format sequence |
| `src/modules/transcribe/events/message.js` | `MessageCreate` auto path |
| `src/modules/transcribe/commands/transcribe.js` | The `!transcribe` group |
| `test/transcribe.test.js` | Coverage |

## Testing

- **Automated:** `npm test` — `test/transcribe.test.js` (27 tests) with **no network and no API key**: audio detection by type and by extension incl. the missing-type case; voice message vs attached file incl. the BitField and waveform shapes; every `eligibility` refusal reason and the manual override of the soft ones (but not of size, duration or "that is a bot"); first-attachment-only; duration formatting; truncation at a word boundary with the notice; the embed's speaker/length/language line and the empty-transcript case; the budget's count, block and UTC rollover. Then the provider through an injected `fetch`: translation and transcription hit **different endpoints with different models**, the upload is `FormData` with **no hand-set `Content-Type`** and `temperature: 0`, a missing key / a 429 / a bodyless 200 all throw loudly, and the download enforces the ceiling on real bytes. Then the service: sparse config, claim-and-refund, a full happy path returning a ready embed, honest refusals that never reach the network, over-budget, and a failure refunding its slot. Then the command surface: the subcommand list, the permission split, the status embed naming a missing key, the reply lookup, and every knob writing what it says.
- **Manual (live server) checklist:**
  1. `!transcribe` → the status card. If it says the service is not configured, the key is missing from the Pi's `.env`.
  2. Record a Discord voice message in any channel → within a few seconds the bot replies with a **🎙️ Statement on the record** embed.
  3. Say something in Dutch → the transcript comes back in **English**. `!transcribe english false` → the next one comes back in Dutch.
  4. Attach an `.mp3` → nothing happens (files are off by default). Reply to it with `!transcribe now` → it is transcribed.
  5. `!transcribe channel #general` → the status shows only that channel; a memo elsewhere is ignored. `!transcribe everywhere` puts it back.
  6. `!transcribe limit daily 1`, transcribe twice → the second is refused with the budget message.

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
| The transcript is nonsense over a silent recording | Whisper hallucinating on silence | Known model behaviour; temperature is already pinned to 0, which minimises it |

## Changelog

| Session | Change |
|---|---|
| S101 | Created (M21.1, owner request + owner backend decision): voice messages and audio attachments are transcribed to English via Groq/Whisper, with **zero new dependencies** — the key is the one the detective module already uses. Automatic for voice messages, on request for files, `!transcribe now` for anything out of scope. Per-guild on/off, channel scope, language, duration and daily-budget knobs. 27 tests, none touching the network. |
