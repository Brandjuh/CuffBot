"""Live voice transcription — the bot sits in a voice channel and writes down
what is said.

Ported from CuffBot's ``src/modules/transcribe/lib/voice-session.js`` (the
timing policy, the batching toward Groq's billing floor, the hallucination
filter, the line buffer), ``lib/pairing.js`` (voice → text channel pairing and
the auto-join rules) and ``voice/session.js`` (the capture plumbing).

The pure half of this module — every function above :class:`LiveSession` —
takes plain numbers, strings and dicts, so the whole policy is testable
without a gateway. The impure half is one session class per guild that owns a
``discord-ext-voice-recv`` client, a thread-fed PCM buffer and an asyncio
watchdog.

Audio path: the sink receives 48 kHz s16 **stereo** PCM in 20 ms frames
(3840 bytes each) **on a non-asyncio thread**; ``LiveSession.feed`` therefore
only appends to a lock-protected buffer. The watchdog (asyncio, ~200 ms tick)
does everything else: ends turns after silence, batches them per speaker, and
dispatches them. The batch itself — downmix to 16 kHz mono WAV, budget claim,
Whisper, line buffer — runs in its own task, at most MAX_INFLIGHT at a time, so
no single request can hold up the beat. Because those tasks finish out of
order, every batch carries a sequence number and the transcript is sorted back
into speech order before it is posted.
"""

from __future__ import annotations

import asyncio
import contextlib
import io
import logging
import re
import threading
import time
import unicodedata
import wave
from typing import Any, Dict, List, Optional, Tuple

import discord

from .limits import RateLimited, describe_usage

log = logging.getLogger("red.cuff-cogs.cufftranscribe.livevoice")

# ── Optional dependencies ────────────────────────────────────────────────────
#
# The cog must load (and keep serving voice memos) even when the voice-receive
# stack is missing, so both imports are defensive. Commands check
# ``voice_recv is None`` and explain instead of crashing Red.

try:  # pragma: no cover - environment dependent
    from discord.ext import voice_recv
    from discord.ext.voice_recv import opus as voice_recv_opus
    from discord.ext.voice_recv import rtp as voice_recv_rtp
except Exception:  # ImportError, or PyNaCl/opus loading trouble inside it
    voice_recv = None  # type: ignore[assignment]
    voice_recv_opus = None  # type: ignore[assignment]
    voice_recv_rtp = None  # type: ignore[assignment]

try:  # pragma: no cover - environment dependent
    # Discord's end-to-end encryption. discord.py picks this up on its own and
    # will not negotiate E2EE without it — which since 2026-03-02 means it
    # cannot join a normal voice channel at all.
    import davey
except Exception:
    davey = None  # type: ignore[assignment]

try:  # pragma: no cover - stdlib on 3.11/3.12, gone in 3.13
    import audioop
except Exception:
    audioop = None  # type: ignore[assignment]


def live_voice_available() -> Tuple[bool, str]:
    """Can live voice work in this install? Returns ``(ok, why-not)``."""
    if voice_recv is None:
        return False, "the `discord-ext-voice-recv` / `pynacl` packages are not installed"
    if davey is None:
        return (
            False,
            "the `davey` package is not installed — Discord requires E2EE (DAVE) on voice",
        )
    if audioop is None:
        return False, "the `audioop` module is unavailable on this Python"
    return True, "ok"


# ── Policy (port of lib/voice-session.js DEFAULT_VOICE_POLICY) ───────────────

#: How long a speaker must stop talking before their turn is considered
#: finished. Short enough that a transcript keeps up with the conversation,
#: long enough that a breath mid-sentence does not split it in two.
SILENCE_MS = 800

#: Ignore anything shorter than this. Discord emits a stream for a cough, a
#: keyboard click and an "mm" — transcribing those costs an API call each and
#: produces Whisper's favourite hallucination, "Thank you.".
#:
#: Briefly lowered to 400 on the theory that the silence stripping had made
#: this measure four times stricter. It had not: the buffer still carries the
#: KEEP_SILENCE_MS kept after each word, so 400 let through turns holding
#: 140 ms of actual speech — which came back as "Ha ha ha ha.". Back at 700.
MIN_SPEECH_MS = 700

#: Force a cut in a monologue. Without it a continuous speaker produces one
#: capture that never ends, so nothing is transcribed until they stop — and
#: the buffer grows the whole time.
MAX_CHUNK_MS = 25_000

#: Refuse to buffer beyond this even if MAX_CHUNK_MS somehow passes.
HARD_CAP_MS = 60_000

# S123: batch short turns toward Groq's 10-second minimum billing. Groq
# charges a floor of 10 audio-seconds per request, so a 1.5-second "yeah"
# costs exactly as much as ten seconds of speech.
#: Whisper was trained on THIRTY-SECOND windows, and that — not Groq's billing
#: floor — is what should set this. Ten-second batches were sized for the
#: invoice and they cost accuracy twice over: less context for the model to
#: anchor on, and three times the requests against a 20-per-minute ceiling
#: that is already saturated, so turns get dropped and the transcript ends up
#: with holes in it. A longer batch is not more expensive (the 10-second floor
#: is a minimum, not a maximum) and it is the same audio either way; it only
#: arrives later.
BATCH_TARGET_MS = 25_000
#: How long a lone remark may sit waiting for a second one to batch with. Every
#: millisecond here lands directly in the delay a reader sees, and in a normal
#: conversation the follow-up turn arrives within a second or not at all — a
#: longer hold mostly buys dead time. Raise it to trade latency back for the
#: billing floor.
#: There is no good reason to ever send Whisper a second and a half of speech:
#: it is billed as ten, it carries no context, and it is exactly the input
#: that makes the model invent a fluent sentence out of nothing. So even a
#: lone remark in a silent channel waits this long for company. It is the
#: floor on transcript latency, and it buys the accuracy back.
BATCH_MAX_WAIT_MS = 5_000

#: ...but that trade is only affordable while there is budget to spend, and
#: the day's REQUESTS are what runs out first. Groq's free tier allows 2,000 a
#: day and bills a 10-second floor on every one, so what a request costs in
#: budget is fixed while what it buys depends entirely on how much speech it
#: carries: batches of a full 10 seconds buy ~5.5 hours of conversation a day,
#: batches of 1.5 seconds buy well under one. Holding every turn for the full
#: floor would pay for that with latency nobody wants during a quiet call, so
#: the wait is stretched only as the budget actually tightens — responsive
#: while there is room, frugal once there is not.
BATCH_PRESSURE_LOW = 0.35
BATCH_PRESSURE_HIGH = 0.85

#: Refusals worth waiting out rather than treating as a lost turn.
RATE_REASONS = ("rpm", "rpd", "audio-hour", "audio-day")

#: Hold speech for a window that rolls this soon; past it the wait is longer
#: than the conversation and posting stale lines helps nobody.
REQUEUE_MAX_WAIT_MS = 60_000

#: Never stop offering batches for longer than this, however far off the
#: window's own estimate is — a stuck hold is a silent session.
RATE_HOLD_CAP_MS = 30_000

#: The sink delivers 48 kHz, 16-bit, stereo PCM: 48000 × 2 bytes × 2 channels
#: per second = 192 bytes per millisecond. The byte count IS the clock — every
#: 20 ms frame is exactly 3840 bytes — so durations are exact, not estimated.
PCM_BYTES_PER_MS = 48_000 * 2 * 2 // 1000
HARD_CAP_BYTES = HARD_CAP_MS * PCM_BYTES_PER_MS

WATCHDOG_TICK_SECS = 0.2

#: Below this RMS a 20 ms frame carries no speech. Discord does not transmit
#: during a pause, voice-recv fills the gap with silence frames to keep the
#: stream continuous, and every frame this cog could not decrypt became
#: silence too — so dead air arrives from three directions and lands in the
#: MIDDLE of somebody's sentence.
#:
#: Measured on real captures: batches under 50% silence transcribed correctly,
#: batches over 75% came back as confident nonsense ("PICKING WINGS." for two
#: seconds of audio holding 0.16 s of speech). Whisper does not fail on quiet
#: audio, it invents — so the silence has to go before it is uploaded, not be
#: paid for at ten seconds a request and then hallucinated over.
SILENCE_RMS = 150

#: A pause is part of speech; only DEAD air is not. This much silence is kept
#: after each word, so sentences keep their rhythm instead of being crushed
#: into one breathless run that Whisper would re-punctuate for us.
KEEP_SILENCE_MS = 200

#: The least speech worth a request.
#:
#: Density is NOT the signal down here — a batch holding 1.09 s at 30.8%
#: silence still came back "Ha ha ha ha." — so this is a duration threshold,
#: and where to put it was measured rather than reasoned. Across 35 captures
#: taken once the silence stripping was in place there is a clean gap: the
#: longest invention is 1.56 s ("Thank you.") and the shortest real utterance
#: above it is 1.63 s ("Oh, see ya. Look at the chat."). Sitting in that gap
#: lets nothing invented through.
#:
#: It was briefly 2,500, which blocked exactly the same inventions while
#: throwing away twelve real remarks instead of five — the extra strictness
#: bought nothing and cost "So you can shoot it there, right?".
#:
#: The remaining cost is real and accepted: five short utterances in that
#: sample ("Yeah.", "Oh.", "Hell yeah.") are dropped rather than delayed.
#: Inventing laughter nobody made is worse than missing a word.
BATCH_MIN_MS = 1_600

#: How long a batch too thin to transcribe is kept in case more arrives. Past
#: this it is DISCARDED, not sent — see the "drop" branch below. Sending it
#: anyway is how "Thank you." and "Ha ha ha." reached the channel even while
#: the threshold above was doing its job.
BATCH_GIVE_UP_MS = 30_000

#: davey reports its failures as a ValueError with a message rather than as a
#: type, and this is the one that is not really a failure: the frame was never
#: encrypted, which is what a speaker's audio looks like until they finish
#: joining the group.
DAVE_UNENCRYPTED = "UnencryptedWhenPassthroughDisabled"

#: Turns batched into one request were NOT said back to back — under pressure
#: they can be seconds apart — so they are glued together with a little
#: silence. Butted straight against each other, Whisper reads two separate
#: remarks as one run-on sentence and re-punctuates both to make it fit,
#: which is how a transcript ends up fluent and wrong. Silence is cheap:
#: every request is billed a 10-second floor regardless.
BATCH_GAP_MS = 300

#: How many recent utterances travel with the next request as context. Enough
#: to carry names and the thread of a sentence; short enough that the prompt
#: stays a hint rather than something Whisper starts reciting.
CONTEXT_LINES = 4

#: How many Whisper requests may be in flight at once. Batches are dispatched
#: as tasks instead of awaited inside the tick, so one speaker's request no
#: longer delays every other speaker's turn — but an unbounded fan-out would
#: burst straight through Groq's RPM ceiling.
MAX_INFLIGHT = 3

#: Guild settings change when someone types a command, not five times a second.
#: Re-reading Config every beat cost a round-trip and a full dict copy per tick.
SETTINGS_TTL_SECS = 2.0

#: Concurrent transcription means completions arrive out of speech order, so a
#: post is held back while an OLDER batch is still running. This caps that
#: hold: one hung request must not strand the whole transcript behind it.
ORDER_HOLD_MS = 8_000

#: How long teardown waits for running transcriptions, so the final post is not
#: missing the last thing anyone said.
STOP_DRAIN_SECS = 3.0

#: voice-recv tears down its ENTIRE receiver when one packet fails to decode:
#: the router thread raises out of its loop and calls ``stop_listening`` on the
#: way out. The voice connection stays up, so the session goes on looking
#: healthy while being permanently deaf. These bound how often the sink may be
#: restarted before the session gives up and says so.
MAX_RELISTENS = 3
#: A restart that survives this long counts as recovered, so an hour-long call
#: with the occasional lost packet does not exhaust the allowance.
RELISTEN_WINDOW_SECS = 60.0

#: Discord allows a bot ~5 messages per 5 seconds in one channel. The flush
#: interval below already keeps the steady state under that, but a drain can
#: still yield several posts at once — a rate hold that releases, or an order
#: hold that finally clears, hands over a backlog in one go. Posting those
#: back-to-back buys nothing: discord.py would queue them against the bucket
#: and the transcript arrives at the same time either way, just with a 429
#: round-trip in between. So a flush posts at most this many and leaves the
#: rest for the next beat, which spreads a burst instead of racing it.
MAX_POSTS_PER_FLUSH = 2

#: A backlog longer than this means the channel is further behind than anyone
#: will read. Keep the NEWEST — stale transcript is the part worth losing.
MAX_BACKLOG_POSTS = 20

# Line buffer thresholds (port of createLineBuffer defaults).
#: The buffer exists so a busy channel gets one post per burst instead of one
#: per utterance. That only needs to span the gap between near-simultaneous
#: speakers, not five seconds of it.
FLUSH_AFTER_MS = 1_200
SOFT_LIMIT = 1_500


def pcm_ms(byte_count: int) -> float:
    """Milliseconds of audio in a run of 48 kHz s16 stereo PCM bytes."""
    return byte_count / PCM_BYTES_PER_MS


def evaluate_capture(buffered_ms: float, silent_for_ms: float) -> str:
    """What should happen to one speaker's in-progress capture right now?

    Returns ``"cut"`` (force a mid-monologue flush and keep collecting),
    ``"end"`` (silence finished the turn) or ``"wait"``. Pure — the watchdog
    feeds it clock readings, tests feed it plain numbers.
    """
    if buffered_ms >= MAX_CHUNK_MS:
        return "cut"
    if silent_for_ms >= SILENCE_MS:
        return "end"
    return "wait"


def is_worth_transcribing(buffered_ms: float) -> bool:
    """Is a finished capture worth an API call? (port of isWorthTranscribing)"""
    return buffered_ms > 0 and buffered_ms >= MIN_SPEECH_MS


def should_send_batch(
    ms: float,
    held_since_ms: float,
    *,
    target_ms: int = BATCH_TARGET_MS,
    max_wait_ms: int = BATCH_MAX_WAIT_MS,
) -> Tuple[bool, str]:
    """Should this speaker's held audio be sent now? (port of shouldSendBatch)

    Returns ``(send, reason)`` with reason one of ``enough``/``waited``/``hold``.
    """
    if ms >= target_ms:
        return True, "enough"
    if ms < BATCH_MIN_MS:
        # Too little speech to transcribe: below BATCH_MIN_MS the model does
        # not return a poor transcript, it returns a confident invention. Wait
        # for more — and if none comes, DROP it. Sending it anyway was the
        # hole every hallucination came through: the threshold held the batch
        # back and then the timeout posted it regardless.
        return False, "thin" if held_since_ms < BATCH_GIVE_UP_MS else "drop"
    # A remark in a quiet channel must not sit unsent waiting for a second one
    # that is never coming.
    if held_since_ms >= max_wait_ms:
        return True, "waited"
    return False, "hold"


def batch_wait_for(pressure: float) -> int:
    """How long a short turn may wait for company, given how much of the
    tightest Groq window is already spent (``describe_usage()["tightest"]``).

    Latency while there is budget, thrift once there is not: below
    ``BATCH_PRESSURE_LOW`` nothing changes, above ``BATCH_PRESSURE_HIGH``
    every turn is held for the full billing floor, and in between the wait
    slides between the two. Pure, so the policy is testable with plain
    numbers.
    """
    try:
        used = float(pressure)
    except (TypeError, ValueError):
        used = 0.0
    if used <= BATCH_PRESSURE_LOW:
        return BATCH_MAX_WAIT_MS
    if used >= BATCH_PRESSURE_HIGH:
        return BATCH_TARGET_MS
    span = BATCH_PRESSURE_HIGH - BATCH_PRESSURE_LOW
    climbed = (used - BATCH_PRESSURE_LOW) / span
    return int(BATCH_MAX_WAIT_MS + climbed * (BATCH_TARGET_MS - BATCH_MAX_WAIT_MS))


# ── Hallucination filter (port of cleanTranscript, verbatim list) ────────────

#: Whisper's silence hallucinations. It returns fluent, confident sentences
#: for a second of room tone, and the same handful of them every time —
#: filtering the known set is cheaper and far more effective than trying to
#: detect silence in the audio ourselves.
HALLUCINATIONS = [
    "thank you",
    "thanks for watching",
    "thank you for watching",
    "you",
    "bye",
    "bye.",
    ".",
    "thank you.",
    "subtitles by the amara.org community",
    "transcription by castingwords",
    "please subscribe",
    "okay",
    # Observed live on near-silent captures in this precinct.
    "baa",
    "baa baa",
    "picking wings",
]

_TRAILING_NOISE = re.compile(r"[!?.,\s]+$")

#: What Whisper returns for "there was no speech in here" once it is given a
#: language instead of made to guess. Not punctuation and not a word, so the
#: filter below has to recognise it or every silent fragment posts a line of
#: asterisks.
_NO_SPEECH = re.compile(r"^[\s*\-–—_.·•]+$")


#: A run of the same short utterance is Whisper stuttering at near-silence,
#: not somebody repeating themselves. Observed live as "Baa. Baa. Baa. Baa."
#: — including as a prefix on an otherwise perfectly good 17-second batch,
#: which is the shape that matters: a blocklist would have to know the word,
#: and the next one will be different.
_SEGMENT = re.compile(r"[^.!?]+[.!?]*")
REPEAT_RUN = 3
REPEAT_MAX_CHARS = 14


def _is_word_stutter(segment: str) -> bool:
    """Is this segment one short word repeated, and nothing else?

    Whisper's rendering of laughter and breath on thin audio — "Ha ha ha ha."
    — is a single segment, so the sentence-level pass below never sees it.
    Matching the SHAPE rather than the word keeps this from becoming a list of
    every noise a model has ever invented.
    """
    words = re.findall(r"[^\W\d_]+", segment.lower())
    return len(words) >= REPEAT_RUN and len(set(words)) == 1 and len(words[0]) <= 3


def collapse_repeats(text: str) -> str:
    """Collapse a stutter to one instance, keeping anything real after it.

    Only short segments repeated at least ``REPEAT_RUN`` times in a row are
    touched, so "No, no, no — stop" survives while "Baa. Baa. Baa. Baa." does
    not.
    """
    segments = [s.strip() for s in _SEGMENT.findall(text) if s.strip()]
    kept = [s for s in segments if not _is_word_stutter(s)]
    if len(kept) != len(segments):
        # "Ha ha ha. I meant it." keeps the half that is speech.
        return " ".join(kept)
    if len(segments) < REPEAT_RUN:
        return text
    out: List[str] = []
    index = 0
    while index < len(segments):
        run = 1
        while index + run < len(segments) and segments[index + run] == segments[index]:
            run += 1
        if run >= REPEAT_RUN and len(segments[index]) <= REPEAT_MAX_CHARS:
            out.append(segments[index])  # one is enough; the rest was stutter
        else:
            out.extend(segments[index : index + run])
        index += run
    return " ".join(out)


def clean_transcript(text: Any) -> str:
    """Strip a transcript that is really just silence. Returns '' when it is."""
    trimmed = str(text if text is not None else "").strip()
    if _NO_SPEECH.match(trimmed):
        return ""
    collapsed = collapse_repeats(trimmed)
    if collapsed != trimmed:
        # What is left may now be a bare hallucination on its own, so it goes
        # back through the checks below rather than straight out.
        trimmed = collapsed
    bare = _TRAILING_NOISE.sub("", trimmed.lower()).strip()
    if len(bare) == 0:
        return ""
    if bare in HALLUCINATIONS:
        return ""
    return trimmed


# ── Transcript lines (port of formatLine / packLines / createLineBuffer) ─────


def apply_replacements(text: str, mapping: Optional[Dict[str, str]]) -> str:
    """Swap configured words for their stand-ins, whole words only.

    Whole words on purpose: a substring rule would rewrite the middle of
    innocent words, and the point is to catch what was said rather than every
    string that contains it. Longest key first, so a two-word rule wins over a
    one-word rule that starts the same way.
    """
    if not mapping or not text:
        return text
    pattern = re.compile(
        r"\b(" + "|".join(re.escape(w) for w in sorted(mapping, key=len, reverse=True)) + r")\b",
        re.IGNORECASE,
    )
    # A function replacement, not a template: a stand-in containing a
    # backslash would otherwise be read as a regex escape.
    return pattern.sub(lambda m: mapping.get(m.group(0).lower(), m.group(0)), text)


#: Orpheus refuses more than this in one request, so anything longer is read
#: in pieces rather than truncated mid-word.
TTS_INPUT_LIMIT = 200

#: A backlog longer than this means the channel is typing faster than anyone
#: can listen. Further messages are skipped rather than queued into a monologue
#: that arrives minutes after the conversation moved on.
SPEAK_QUEUE_MAX = 5

_URL = re.compile(r"https?://\S+")
_CUSTOM_EMOJI = re.compile(r"<a?:(\w+):\d+>")
_CODE_BLOCK = re.compile(r"```.*?```", re.DOTALL)
_INLINE_CODE = re.compile(r"`([^`]*)`")


def clean_for_speech(text: Any) -> str:
    """Turn a chat message into something worth hearing out loud.

    A URL read character by character is thirty seconds of nobody listening,
    and a code block is worse. Both are announced instead of recited.
    """
    out = str(text if text is not None else "")
    out = _CODE_BLOCK.sub(" code block ", out)
    out = _INLINE_CODE.sub(r"\1", out)
    out = _URL.sub(" link ", out)
    out = _CUSTOM_EMOJI.sub(r" \1 ", out)  # the name is the readable part
    out = re.sub(r"[*_~|>#]", "", out)  # markdown that is punctuation, not speech
    return re.sub(r"\s+", " ", out).strip()


def chunk_for_speech(text: str, limit: int = TTS_INPUT_LIMIT) -> List[str]:
    """Split into request-sized pieces, preferring sentence then word breaks.

    Splitting mid-word is audible; splitting mid-sentence is not, so sentence
    ends are used where they fall close enough to the limit to be worth it.
    """
    text = text.strip()
    if not text:
        return []
    chunks: List[str] = []
    while len(text) > limit:
        window = text[:limit]
        cut = max(window.rfind(". "), window.rfind("! "), window.rfind("? "))
        if cut < limit // 2:
            cut = window.rfind(" ")
        if cut <= 0:
            cut = limit  # one very long word: a hard cut is all that is left
        else:
            cut += 1
        chunks.append(text[:cut].strip())
        text = text[cut:].strip()
    if text:
        chunks.append(text)
    return chunks


async def play_wav(voice_client, wav: bytes) -> None:
    """Play one piece of audio and wait for it to finish.

    Waiting is what keeps callers serial: ``play`` returns the moment the
    stream starts, and a second call while the first is running raises. The
    ``after`` callback fires on the player THREAD, so the event that unblocks
    us is set back on the loop rather than touched directly.
    """
    if voice_client is None or not voice_client.is_connected():
        raise RuntimeError("not connected to voice")
    while voice_client.is_playing():
        await asyncio.sleep(0.1)
    loop = asyncio.get_running_loop()
    done = asyncio.Event()
    failure: List[Exception] = []

    def finished(error: Optional[Exception]) -> None:
        if error:
            failure.append(error)
        loop.call_soon_threadsafe(done.set)

    voice_client.play(discord.FFmpegPCMAudio(io.BytesIO(wav), pipe=True), after=finished)
    await done.wait()
    if failure:
        raise failure[0]


_MENTION = re.compile(r"<@!?(\d+)>")


def mentions_in(text: Any) -> List[int]:
    """User ids mentioned in a piece of text, in order, without duplicates."""
    seen: List[int] = []
    for raw in _MENTION.findall(str(text if text is not None else "")):
        value = int(raw)
        if value not in seen:
            seen.append(value)
    return seen


def allowed_for(mapping: Optional[Dict[str, str]]) -> discord.AllowedMentions:
    """Who a transcript is allowed to ping: exactly the people an admin wrote
    into a replacement, and nobody else.

    Transcripts are otherwise silent by design — the speaker's own name would
    ping them on every single line, and a transcript is a record, not a
    summons. But a replacement is a deliberate act by somebody with Manage
    Server, so the ids inside one are allowed through by name. Everyone, here
    and roles stay blocked whatever a rule says.
    """
    targets: List[int] = []
    for value in (mapping or {}).values():
        for user_id in mentions_in(value):
            if user_id not in targets:
                targets.append(user_id)
    return discord.AllowedMentions(
        everyone=False,
        roles=False,
        replied_user=False,
        users=[discord.Object(id=user_id) for user_id in targets],
    )


def format_line(*, name: str, text: Any, at_ms: int, timestamps: bool = True) -> Optional[str]:
    """One line of the log, or ``None`` when the transcript was hallucinated.

    ``<t:…:t>`` (Discord short time), NOT ``:R``: relative is right for a
    countdown and useless down a transcript, where every line would read
    "a minute ago". The stamp renders in the reader's own timezone.
    """
    clean = clean_transcript(text)
    if clean == "":
        return None
    if not timestamps:
        return f"**{name}:** {clean}"
    return f"<t:{at_ms // 1000}:t> **{name}:** {clean}"


def pack_lines(lines: List[str], limit: int = 1900) -> List[str]:
    """Pack transcript lines into Discord-sized posts, splitting only between
    lines. A transcript that arrives as one message per utterance would flood
    the channel; one that silently drops the overflow would be worse."""
    posts: List[str] = []
    current = ""
    for line in lines:
        piece = str(line)
        if len(current) > 0 and len(current) + 1 + len(piece) > limit:
            posts.append(current)
            current = ""
        # A single line longer than the limit is hard-split rather than dropped.
        if len(piece) > limit:
            if len(current) > 0:
                posts.append(current)
                current = ""
            for i in range(0, len(piece), limit):
                posts.append(piece[i : i + limit])
            continue
        current = piece if len(current) == 0 else f"{current}\n{piece}"
    if len(current) > 0:
        posts.append(current)
    return posts


class LineBuffer:
    """A buffer that batches lines and says when it wants flushing — either
    because enough time has passed or because it is nearly a full post.

    Every line carries the sequence number of the batch that produced it.
    Transcriptions run concurrently, so they finish in whatever order Groq
    answers them — the buffer sorts on drain, and the session holds a post back
    while an older batch is still running.
    """

    def __init__(self, *, flush_after_ms: int = FLUSH_AFTER_MS, soft_limit: int = SOFT_LIMIT):
        self._flush_after_ms = flush_after_ms
        self._soft_limit = soft_limit
        self._lines: List[Tuple[int, str]] = []
        self._first_at: Optional[int] = None

    def add(self, line: Optional[str], now: int, seq: int = 0) -> None:
        if line is None:
            return
        if not self._lines:
            self._first_at = now
        self._lines.append((seq, line))

    @property
    def size(self) -> int:
        return len(self._lines)

    @property
    def length(self) -> int:
        return sum(len(line) + 1 for _seq, line in self._lines)

    @property
    def max_seq(self) -> int:
        """Newest batch sitting in the buffer; -1 when it is empty."""
        return max((seq for seq, _line in self._lines), default=-1)

    @property
    def waiting_since(self) -> Optional[int]:
        """When the oldest held line arrived, or None when empty."""
        return self._first_at

    def should_flush(self, now: int) -> bool:
        """Time-based OR size-based; a long silence must not strand a line."""
        if not self._lines:
            return False
        assert self._first_at is not None
        return now - self._first_at >= self._flush_after_ms or self.length >= self._soft_limit

    def drain(self) -> List[str]:
        out = [line for _seq, line in sorted(self._lines, key=lambda item: item[0])]
        self._lines = []
        self._first_at = None
        return out


# ── Pairing (port of lib/pairing.js) ─────────────────────────────────────────

#: The precinct's own voice → text pairings (owner, 2026-07-26, given as ids).
#: The keys are STRINGS on purpose — they were strings in the Node source
#: because an unquoted 18-digit snowflake is not representable as a JS number,
#: and Red's Config stores dict keys as strings anyway.
DEFAULT_VOICE_PAIRS: Dict[str, str] = {
    "411633952961593345": "411634025426321438",
    "436248103310327808": "436248239855894538",
    "442066086159187978": "442059736263688213",
    "411634241965916191": "411634286655963146",
}


def normalize_channel_name(name: Any) -> str:
    """Reduce a channel name to what it is actually *called*.

    Strips the decoration servers put in names — emoji, box-drawing,
    separators — then folds accents, collapses every run of non-alphanumerics
    into a single hyphen, and trims.
    """
    decomposed = unicodedata.normalize("NFKD", str(name if name is not None else ""))
    # Combining marks: `café` and `cafe` are the same room.
    no_marks = "".join(ch for ch in decomposed if not unicodedata.combining(ch))
    lowered = no_marks.lower()
    hyphened = re.sub(r"[^a-z0-9]+", "-", lowered)
    return hyphened.strip("-")


def pair_text_channel(
    voice_channel: Dict[str, Any],
    text_channels: List[Dict[str, Any]],
    pairs: Optional[Dict[str, str]] = None,
) -> Optional[Dict[str, str]]:
    """Find the text channel that goes with ``voice_channel``.

    Channels are plain dicts ``{"id": str, "name": str, "parent_id": str|None}``
    so the matcher is testable without a guild. Three passes, most specific
    first — a wrong pairing posts a private conversation into the wrong room,
    so a near-miss must never win over an exact one:

    0. A **declared pairing** — a fact, not an inference, so it beats
       everything below (only if the target still exists; a stale id falls
       through to the matcher rather than sending the transcript into a void).
    1. **Normalised equality** — ``🎙️ Squad Room`` ↔ ``squad-room``; more
       than one match prefers the one in the same category.
    2. **Same-category containment**, for ``squad-room-chat`` — only if
       exactly one candidate qualifies.
    3. ``None``. The caller falls back to the voice channel's own built-in
       text chat, which is always correct and never a guess.
    """
    if pairs is None:
        pairs = DEFAULT_VOICE_PAIRS
    declared = (pairs or {}).get((voice_channel or {}).get("id"))
    if declared:
        if any(c and c.get("id") == declared for c in text_channels):
            return {"id": declared, "how": "declared"}

    target = normalize_channel_name((voice_channel or {}).get("name"))
    if len(target) == 0:
        return None
    usable = [c for c in text_channels if c and c.get("id") != voice_channel.get("id")]

    exact = [c for c in usable if normalize_channel_name(c.get("name")) == target]
    if len(exact) == 1:
        return {"id": exact[0]["id"], "how": "exact"}
    if len(exact) > 1:
        # Two rooms with the same name: prefer the one in the same category,
        # which is what a duplicated name almost always means.
        same_category = next(
            (
                c
                for c in exact
                if c.get("parent_id") and c.get("parent_id") == voice_channel.get("parent_id")
            ),
            None,
        )
        return {"id": (same_category or exact[0])["id"], "how": "exact"}

    # Only inside the same category — a `general` voice channel must not adopt
    # `general-announcements` from the other side of the server.
    if voice_channel.get("parent_id"):
        near = [
            c
            for c in usable
            if c.get("parent_id") == voice_channel.get("parent_id")
            and target in normalize_channel_name(c.get("name"))
        ]
        if len(near) == 1:
            return {"id": near[0]["id"], "how": "category"}
    return None


def should_auto_join(humans: int, channel_id: int, settings: Dict[str, Any]) -> Tuple[bool, str]:
    """Should the bot join this voice channel right now? (port of shouldAutoJoin)"""
    if not settings.get("auto_join"):
        return False, "auto-join-off"
    if not settings.get("enabled"):
        return False, "disabled"
    if humans < (settings.get("auto_join_minimum") or 1):
        return False, "too-quiet"
    scoped = settings.get("voice_channel_ids") or []
    if scoped and channel_id not in scoped:
        return False, "out-of-scope"
    return True, "ok"


def should_auto_leave(humans: int) -> bool:
    """The bot itself never counts — otherwise it would sit alone in an empty
    channel forever, transcribing its own silence."""
    return humans == 0


def humans_in(voice_channel: Any) -> int:
    """Humans (not bots) in a voice channel, from its member list."""
    members = getattr(voice_channel, "members", None) or []
    return sum(1 for m in members if not getattr(m, "bot", False))


def auto_join_diagnosis(
    settings: Dict[str, Any], *, has_key: bool, in_voice: bool, prefix: str = "[p]"
) -> Dict[str, Any]:
    """Why auto-join would or would not fire right now (S117).

    Every refusal in the voice-state handler is a silent return, which is
    right for a background feature and useless for diagnosing one. This turns
    the same conditions into a sentence for the bare ``transcribe`` status.
    """
    if not settings.get("enabled"):
        return {
            "ok": False,
            "reason": "disabled",
            "detail": f"the desk is off — `{prefix}transcribe on`",
        }
    if not settings.get("auto_join"):
        return {
            "ok": False,
            "reason": "auto-join-off",
            "detail": f"auto-join is off — `{prefix}transcribe autojoin true`",
        }
    if not has_key:
        return {
            "ok": False,
            "reason": "no-key",
            "detail": "no Groq key is set — joining would do nothing, so it stays out",
        }
    if in_voice:
        return {
            "ok": False,
            "reason": "busy",
            "detail": "already recording a channel — one at a time",
        }
    scoped = settings.get("voice_channel_ids") or []
    if scoped:
        return {
            "ok": True,
            "reason": "scoped",
            "detail": "armed, but only for " + ", ".join(f"<#{cid}>" for cid in scoped),
        }
    minimum = settings.get("auto_join_minimum") or 1
    who = "person" if minimum == 1 else f"{minimum} people"
    return {
        "ok": True,
        "reason": "ok",
        "detail": f"armed — I follow the first {who} into any voice channel",
    }


def describe_pairings(
    voice_channels: List[Dict[str, Any]],
    text_channels: List[Dict[str, Any]],
    pairs: Optional[Dict[str, str]] = None,
    guild_pairs: Optional[Dict[str, str]] = None,
) -> Dict[str, List[Dict[str, Any]]]:
    """Where EVERY voice channel's transcript would go, and why (S118).

    Walks the voice channels instead of the pairing table, so every room is
    accounted for and each row says WHY it resolves where it does.
    """
    pairs = pairs or {}
    guild_pairs = guild_pairs or {}
    known = {c["id"] for c in voice_channels}
    text_ids = {c["id"] for c in text_channels}

    rows = []
    for voice in voice_channels:
        declared = pairs.get(voice["id"])
        match = pair_text_channel(voice, text_channels, pairs)
        rows.append(
            {
                "voice_id": voice["id"],
                "voice_name": voice["name"],
                "text_id": match["id"] if match else None,
                "how": match["how"] if match else "built-in",
                "overridden": voice["id"] in guild_pairs,
                # A declared target that no longer exists: the matcher
                # silently fell through to a name match, which is right
                # behaviour and confusing to read unless the row says so.
                "stale_target": declared if declared and declared not in text_ids else None,
            }
        )

    # Pairings pointing at a voice channel that is gone. They do no harm, but
    # they are the rows an admin would want to clean up — and `unpair` cannot
    # take a channel argument for a channel that no longer resolves, which is
    # why it accepts a raw id.
    orphans = [
        {
            "voice_id": voice_id,
            "text_id": text_id,
            "from_default": DEFAULT_VOICE_PAIRS.get(voice_id) == text_id,
        }
        for voice_id, text_id in pairs.items()
        if voice_id not in known
    ]
    return {"rows": rows, "orphans": orphans}


#: How a resolved pairing reads in the list.
HOW_LABEL = {
    "declared": "paired",
    "exact": "matched by name",
    "category": "matched by name (same category)",
    "built-in": "its own built-in chat",
}


# ── Discord-side pairing helpers (port of events/voice-state.js) ─────────────


def _as_pure_channel(channel: Any) -> Dict[str, Any]:
    parent = getattr(channel, "category_id", None)
    return {
        "id": str(channel.id),
        "name": channel.name,
        "parent_id": str(parent) if parent else None,
    }


def transcript_channel_for(
    guild: discord.Guild, voice_channel: Any, guild_pairs: Optional[Dict[str, str]]
) -> Tuple[Any, str]:
    """Where the transcript should go for this voice channel.

    When the pairing table and the name match both find nothing, the fallback
    is the voice channel's **own built-in text chat** — always the right room
    by construction, never a guess.
    """
    texts = [c for c in guild.text_channels if c.id != voice_channel.id]
    # A guild's own pairings sit on top of the owner's committed ones, so an
    # admin can correct a default without touching code.
    pairs = {**DEFAULT_VOICE_PAIRS, **(guild_pairs or {})}
    match = pair_text_channel(
        _as_pure_channel(voice_channel), [_as_pure_channel(c) for c in texts], pairs
    )
    if match:
        channel = guild.get_channel(int(match["id"]))
        if channel is not None:
            return channel, match["how"]
    return voice_channel, "built-in"


def can_work(guild: discord.Guild, voice_channel: Any, text_channel: Any) -> bool:
    """Can the bot actually do this here? Checked before joining, not after."""
    me = guild.me
    if me is None:
        return False
    voice_perms = voice_channel.permissions_for(me)
    if not voice_perms.connect:
        return False
    text_perms = text_channel.permissions_for(me)
    return bool(text_perms.send_messages)


# ── Audio conversion ─────────────────────────────────────────────────────────


def pcm_to_wav(pcm: bytes) -> Tuple[bytes, float]:
    """48 kHz s16 stereo PCM → 16 kHz mono WAV bytes, plus the exact duration.

    Whisper resamples everything to 16 kHz mono internally, so shipping it
    48 kHz stereo would upload six times the bytes for identical output.
    """
    if audioop is None:  # pragma: no cover - guarded by live_voice_available
        raise RuntimeError("audioop is unavailable")
    mono = audioop.tomono(pcm, 2, 0.5, 0.5)
    downsampled, _state = audioop.ratecv(mono, 2, 1, 48_000, 16_000, None)
    out = io.BytesIO()
    with wave.open(out, "wb") as writer:
        writer.setnchannels(1)
        writer.setsampwidth(2)
        writer.setframerate(16_000)
        writer.writeframes(downsampled)
    frames = len(downsampled) // 2
    return out.getvalue(), frames / 16_000


# ── The session ──────────────────────────────────────────────────────────────


class _Capture:
    """One speaker's in-progress turn. Touched from the audio thread under the
    session lock; the watchdog reads it under the same lock."""

    __slots__ = ("buf", "started", "last_packet", "silent_ms")

    def __init__(self, now: float):
        self.buf = bytearray()
        self.started = now
        self.last_packet = now
        #: Dead air since the last frame with speech in it.
        self.silent_ms = 0.0


if voice_recv is not None:

    class _CaptureSink(voice_recv.AudioSink):
        """The thinnest possible sink: hand every PCM frame to the session.

        ``write`` runs on voice-recv's decoder thread, NOT the event loop —
        it must never touch discord.py or asyncio. ``feed`` only does a
        lock-protected append and two timestamp updates.
        """

        def __init__(self, session: "LiveSession"):
            super().__init__()
            self._session = session

        def wants_opus(self) -> bool:
            return False  # decoded 48 kHz s16 stereo PCM, 20 ms frames

        def write(self, user, data) -> None:
            if user is None:
                return
            self._session.feed(int(user.id), bool(getattr(user, "bot", False)), data.pcm)

        def cleanup(self) -> None:
            pass

    class _DaveDecryptor:
        """The end-to-end decryption step voice-recv does not have.

        Voice packets carry TWO layers of encryption. voice-recv undoes the
        transport layer and hands what comes out straight to the Opus decoder
        — correct until 2026-03-02, when Discord made DAVE (its E2EE scheme)
        mandatory on every non-stage voice call. Since then the transport
        layer only reveals MLS ciphertext, and Opus dies on it with
        ``OpusError: corrupted stream``, taking the router thread and the
        whole capture with it. voice-recv has been unmaintained since
        2025-06 and knows nothing about any of this.

        Nothing else is missing, though: discord.py runs the entire DAVE
        handshake and owns the MLS session (that is what ``davey`` is for),
        so the only absent piece is the per-frame decrypt. This class is that
        piece, wrapped around voice-recv's own transport decryption.

        Do NOT "fix" this by declining E2EE. Advertising
        ``max_dave_protocol_version: 0`` gets the handshake rejected with
        close code 4017 and discord.py then retries with backoff, which is a
        join/leave storm rather than a session.

        Installed on one reader's decryptor, so nothing is patched globally
        and a session that ends takes its patch with it. ``__call__`` runs on
        voice-recv's socket-listener thread while the event loop drives the
        MLS session — the same split discord.py already relies on for
        sending, where the audio thread encrypts against a session the loop
        maintains.
        """

        #: One log line per 20 ms frame would bury everything else, so a
        #: session complains a few times and then goes quiet.
        LOG_LIMIT = 3

        def __init__(self, voice_client, inner):
            self._vc = voice_client
            self._inner = inner  # voice-recv's transport decryption
            self._complaints = 0

        def __call__(self, packet) -> bytes:
            data = self._inner(packet)

            state = getattr(self._vc, "_connection", None)
            session = getattr(state, "dave_session", None)
            # No E2EE on this connection: the frame is already Opus. True for
            # stage channels, which Discord exempts from the requirement.
            if session is None or not getattr(state, "dave_protocol_version", 0):
                return data

            user_id = self._vc._get_id_from_ssrc(packet.ssrc)
            if user_id is None:
                # The ssrc → user map is filled from a speaking event that can
                # lag the first frames of a turn. Silence is a valid Opus
                # frame and costs one frame of audio; ciphertext is not and
                # costs the whole session.
                return voice_recv_rtp.OPUS_SILENCE

            try:
                # Frames sent in the clear during a protocol transition are
                # passed through by libdave itself, so this one call covers
                # both states.
                plain = session.decrypt(user_id, davey.MediaType.audio, data)
            except Exception as error:
                if DAVE_UNENCRYPTED in str(error):
                    # Not a failure: this frame was never encrypted, so the
                    # bytes in hand ARE the Opus frame. Happens while a
                    # speaker is still joining the group — silencing it would
                    # throw away everything they say until they finish.
                    return data
                self._complain(user_id, error)
                return voice_recv_rtp.OPUS_SILENCE
            return plain or voice_recv_rtp.OPUS_SILENCE

        def _complain(self, user_id: int, error: Exception) -> None:
            self._complaints += 1
            if self._complaints > self.LOG_LIMIT:
                return
            log.warning(
                "Transcribe: could not decrypt a voice frame from %s: %s%s",
                user_id,
                error,
                " — further frames will not be reported" if self._complaints == self.LOG_LIMIT else "",
            )

    class _ResilientDecoder(voice_recv_opus.Decoder):
        """An Opus decoder that loses a frame instead of the whole session.

        This is the fragility underneath every "the bot went quiet" symptom.
        voice-recv lets a decode error escape the router thread, and that
        thread's ``finally`` calls ``stop_listening`` on its way out — so ONE
        malformed 20 ms frame permanently ends the capture for everyone in
        the channel. Nothing about that is exceptional: packets get corrupted
        in flight, speakers send frames mid-transition, and the E2EE layer
        cannot always vouch for what it hands over.

        Twenty milliseconds of silence is the honest substitute. Losing a
        frame is inaudible; losing the session costs the whole conversation.
        """

        #: One 20 ms frame of 48 kHz stereo silence — what the caller expects.
        SILENT_FRAME = b"\x00" * voice_recv_opus.Decoder.FRAME_SIZE

        def __init__(self, *args, **kwargs):
            super().__init__(*args, **kwargs)
            self._undecodable = 0

        def decode(self, data, *, fec: bool = False) -> bytes:
            try:
                return super().decode(data, fec=fec)
            except Exception as error:
                self._undecodable += 1
                if self._undecodable == 1:
                    log.warning(
                        "Transcribe: dropping an undecodable voice frame (%s); the session "
                        "continues and further frames from this speaker stay quiet about it.",
                        error,
                    )
                return self.SILENT_FRAME

    def _install_resilient_decoder() -> None:
        """Make voice-recv build resilient decoders from here on.

        Patched on the module voice-recv itself reads at decoder-construction
        time, because the decoders are made per speaker deep inside the
        router where there is nothing to inject into. Idempotent, and left in
        place afterwards: taking it back out could only reinstate the crash.
        """
        if voice_recv_opus.Decoder is not _ResilientDecoder:
            voice_recv_opus.Decoder = _ResilientDecoder

    def _install_dave_decryption(voice_client) -> None:
        """Slot the E2EE step into one connection's receive path.

        voice-recv builds the decryptor once per reader and only ever swaps
        the key inside it, so wrapping the bound method here holds for the
        life of that reader. A new reader — a fresh ``listen`` — needs this
        again.
        """
        reader = getattr(voice_client, "_reader", None)
        decryptor = getattr(reader, "decryptor", None)
        if decryptor is None:
            raise RuntimeError("voice-recv exposed no packet decryptor to hook")
        if isinstance(decryptor.decrypt_rtp, _DaveDecryptor):
            return  # already wrapped; never stack two of them
        decryptor.decrypt_rtp = _DaveDecryptor(voice_client, decryptor.decrypt_rtp)

else:  # pragma: no cover - environment dependent
    _CaptureSink = None  # type: ignore[assignment]


class LiveSession:
    """One guild's live transcription: a voice connection, per-speaker PCM
    buffers, per-speaker pending batches, and a line buffer for the paired
    text channel. Created by the cog, which keeps guild_id → session."""

    def __init__(self, cog, guild: discord.Guild, voice_channel, text_channel, how: str):
        self.cog = cog
        self.guild = guild
        self.voice_channel = voice_channel
        self.text_channel = text_channel
        self.how = how
        self.vc = None

        self._lock = threading.Lock()
        self._captures: Dict[int, _Capture] = {}
        #: speaker id → {"pcm": bytearray, "since": monotonic} — only touched
        #: on the asyncio side, so no lock needed.
        self._pending: Dict[int, Dict[str, Any]] = {}
        self._lines = LineBuffer()
        self._task: Optional[asyncio.Task] = None
        self._stopping = False
        #: Injected clock so the turn logic is testable with a fake time.
        self._clock = time.monotonic

        #: Batch dispatch bookkeeping. Transcriptions run as tasks so a slow
        #: Whisper call cannot stall turn detection for everyone else; the
        #: sequence numbers put the transcript back into speech order.
        self._seq = 0
        self._inflight: Dict[int, asyncio.Task] = {}
        self._slots = asyncio.Semaphore(MAX_INFLIGHT)

        #: Guild settings, refreshed at most every SETTINGS_TTL_SECS.
        self._settings: Optional[Dict[str, Any]] = None
        self._settings_at = 0.0

        #: Receiver restarts, and when the last one happened.
        self._relistens = 0
        self._relisten_at = 0.0

        #: How much of the tightest Groq window is spent, refreshed with the
        #: settings; drives how hard short turns are batched.
        self._pressure = 0.0
        #: Monotonic deadline: no batch is offered to Groq before this.
        self._rate_hold_until = 0.0
        #: Posts packed but not yet sent, oldest first (see MAX_POSTS_PER_FLUSH).
        self._backlog: List[str] = []
        self._dropped_ms = 0.0
        #: The last few things actually said, fed back to Whisper as context.
        self._context: List[str] = []

        #: Text waiting to be spoken into the channel, and the worker that
        #: does it. One at a time: a voice client plays a single stream, and
        #: two people typing at once should queue, not overlap.
        self._speak_queue: "asyncio.Queue[str]" = asyncio.Queue(maxsize=SPEAK_QUEUE_MAX)
        self._speaker: Optional[asyncio.Task] = None
        #: Set by silence() to abandon whatever is being read right now.
        self._skip = False
        #: Monotonic deadline: Groq's speech budget is spent until then.
        self._speak_hold_until = 0.0

        # Speaker-filter snapshot, refreshed by the watchdog. The sink thread
        # reads these, so they are plain immutable values, swapped atomically.
        self._ignore_bots = True
        self._ignored_ids: frozenset = frozenset()
        #: Who transcript posts may ping — nobody until the settings say so.
        self._allowed = discord.AllowedMentions.none()

    # ── Lifecycle (asyncio side) ────────────────────────────────────────────

    async def start(self) -> None:
        await self._settings_now(self._clock(), force=True)
        # Deafening itself would stop the receiver. Muting is a signal, not a
        # restriction — but it IS a restriction on speaking, so a session that
        # is going to read the chat out loud must not start muted.
        speaking = bool((self._settings or {}).get("tts_enabled"))
        self.vc = await self.voice_channel.connect(
            cls=voice_recv.VoiceRecvClient, self_deaf=False, self_mute=not speaking
        )
        self._listen()
        self._task = asyncio.create_task(self._watchdog())

    def _listen(self) -> None:
        """Put a sink on the connection, E2EE decryption included.

        Both callers go through here: a sink attached without the DAVE step
        receives ciphertext and dies on the first frame anyone speaks.
        """
        # Before listen(): the decoders are built as speakers appear, so the
        # patch has to be in place before the first packet arrives.
        _install_resilient_decoder()
        self.vc.listen(_CaptureSink(self))
        _install_dave_decryption(self.vc)

    async def stop(self, *, post_remaining: bool = True) -> None:
        """Disconnect and clean up. Never raises."""
        self._stopping = True
        speaker, self._speaker = self._speaker, None
        if speaker is not None and speaker is not asyncio.current_task():
            speaker.cancel()
            with contextlib.suppress(asyncio.CancelledError, Exception):
                await speaker
        task, self._task = self._task, None
        if task is not None and task is not asyncio.current_task():
            task.cancel()
            with contextlib.suppress(asyncio.CancelledError, Exception):
                await task
        # Running transcriptions hold the tail of the conversation. Give them a
        # moment to land so the final post is not missing the last thing anyone
        # said — but never block teardown on a request that has hung, so the
        # wait is bounded and whatever is left over is cancelled.
        inflight = [t for t in self._inflight.values() if t is not asyncio.current_task()]
        if inflight:
            with contextlib.suppress(Exception):
                await asyncio.wait(inflight, timeout=STOP_DRAIN_SECS)
            for pending in inflight:
                if not pending.done():
                    pending.cancel()
        if post_remaining:
            with contextlib.suppress(Exception):
                await self._post_lines(final=True)
        vc, self.vc = self.vc, None
        if vc is not None:
            with contextlib.suppress(Exception):
                vc.stop_listening()
            with contextlib.suppress(Exception):
                await vc.disconnect(force=True)

    def _apply_settings(self, settings: Dict[str, Any]) -> None:
        self._ignore_bots = bool(settings.get("ignore_bots", True))
        self._ignored_ids = frozenset(int(i) for i in (settings.get("ignored_user_ids") or []))
        self._allowed = allowed_for(settings.get("replacements"))
        # The rate counters ride along in the guild scope, so how much budget
        # is left costs nothing extra to work out here — and doing it on the
        # settings refresh keeps it off the 5-per-second tick.
        try:
            self._pressure = float(describe_usage(settings.get("rate"))["tightest"])
        except Exception:  # a malformed counter must not stop the session
            self._pressure = 0.0

    async def _settings_now(self, now: float, *, force: bool = False) -> Dict[str, Any]:
        """Guild settings, cached for SETTINGS_TTL_SECS.

        The tick runs five times a second and the settings behind it change by
        hand. Reading Config every beat put an await — and a copy of the whole
        guild scope, rate counters included — between turn detection and
        dispatch, five times a second, for nothing.
        """
        if force or self._settings is None or now - self._settings_at >= SETTINGS_TTL_SECS:
            self._settings = await self.cog.config.guild(self.guild).all()
            self._settings_at = now
            self._apply_settings(self._settings)
        return self._settings

    # ── Audio thread side ───────────────────────────────────────────────────

    def feed(self, user_id: int, is_bot: bool, pcm: bytes) -> None:
        """Called from the voice-recv decoder THREAD for every 20 ms frame.

        Speaker filtering happens here, BEFORE buffering, so an ignored
        member's audio never even sits in memory.
        """
        if not pcm or self._stopping:
            return
        if is_bot and self._ignore_bots:
            return
        if user_id in self._ignored_ids:
            return
        now = self._clock()
        # Cheap and on the decoder thread, but it is a C loop over 3840 bytes
        # and it decides whether this frame is worth carrying at all.
        speech = audioop.rms(pcm, 2) >= SILENCE_RMS if audioop is not None else True
        frame_ms = pcm_ms(len(pcm))
        with self._lock:
            capture = self._captures.get(user_id)
            if capture is None:
                if not speech:
                    return  # a turn does not begin with dead air
                capture = _Capture(now)
                self._captures[user_id] = capture

            if speech:
                capture.silent_ms = 0.0
                # Only speech refreshes the clock. Were silence to refresh it,
                # a stream that keeps sending silence frames would look like
                # somebody talking without pause and the turn would never end.
                capture.last_packet = now
            else:
                capture.silent_ms += frame_ms
                if capture.silent_ms > KEEP_SILENCE_MS:
                    return  # dead air: dropped rather than uploaded

            # Hard cap: stop accepting packets for this turn rather than grow
            # without bound; the turn still ends on real silence.
            if len(capture.buf) < HARD_CAP_BYTES:
                capture.buf += pcm

    # ── Watchdog (asyncio side) ─────────────────────────────────────────────

    def collect_finished(self, now: float) -> List[Tuple[int, bytes]]:
        """Sweep the capture buffers: cut over-long monologues, end turns
        after silence, discard captures too short to be speech. Synchronous
        and pure-ish (state in the session, clock injected) so the turn logic
        is testable without a gateway."""
        finished: List[Tuple[int, bytes]] = []
        with self._lock:
            for user_id, capture in list(self._captures.items()):
                buffered_ms = pcm_ms(len(capture.buf))
                silent_ms = (now - capture.last_packet) * 1000
                action = evaluate_capture(buffered_ms, silent_ms)
                if action == "cut":
                    # A monologue is cut here rather than held until the
                    # speaker stops: hand off what we have, keep collecting.
                    finished.append((user_id, bytes(capture.buf)))
                    capture.buf = bytearray()
                    capture.started = now
                elif action == "end":
                    del self._captures[user_id]
                    if is_worth_transcribing(buffered_ms):
                        finished.append((user_id, bytes(capture.buf)))
        return finished

    async def _watchdog(self) -> None:
        try:
            while not self._stopping:
                await asyncio.sleep(WATCHDOG_TICK_SECS)
                try:
                    if await self._tick():
                        return
                except asyncio.CancelledError:
                    raise
                except Exception:
                    # A transcription failure must never kill the session.
                    log.exception("Transcribe: live-voice tick failed in guild %s", self.guild.id)
        except asyncio.CancelledError:
            pass

    async def _tick(self) -> bool:
        """One 200 ms beat. Returns True when the session ended itself."""
        if self.vc is not None and not self.vc.is_connected():
            # A dropped websocket reconnects on its own inside discord.py; a
            # connection that is genuinely gone must not leave a dead session
            # in the map pretending to listen.
            log.info("Transcribe: voice connection lost in guild %s; ending session.", self.guild.id)
            self.cog.live_sessions.pop(self.guild.id, None)
            await self.stop(post_remaining=False)
            return True

        # A receiver that has stopped is NOT visible in `is_connected` — the
        # websocket is fine, there is simply nothing listening on it any more.
        # Left alone the bot sits in the channel writing nothing, which is the
        # one failure mode nobody in the channel can see.
        if self.vc is not None and not self._stopping and not self.vc.is_listening():
            if not self._restart_listening(self._clock()):
                log.warning(
                    "Transcribe: the voice receiver in guild %s could not be restarted; "
                    "ending the session.",
                    self.guild.id,
                )
                self.cog.live_sessions.pop(self.guild.id, None)
                with contextlib.suppress(Exception):
                    await self.text_channel.send(
                        "⚪ The voice receiver stopped and would not come back, so I left "
                        "the channel. Recording stopped."
                    )
                await self.stop(post_remaining=True)
                return True

        now = self._clock()
        settings = await self._settings_now(now)

        # Finished turns join their speaker's pending batch (S123: batching
        # toward Groq's 10-second billing floor).
        for user_id, pcm in self.collect_finished(now):
            self._hold(user_id, pcm, now)

        # Send every batch that is big enough or has waited long enough. The
        # tick is also what ages out held audio — the difference between
        # "batching" and "losing the last thing anyone said".
        #
        # While Groq's window is full there is nothing to gain by offering
        # batches it will only refuse, so speech keeps collecting instead —
        # which also means it goes out later as ONE bigger batch rather than
        # several small ones, exactly what the billing floor rewards.
        if now >= self._rate_hold_until:
            max_wait = batch_wait_for(self._pressure)
            for user_id, held in list(self._pending.items()):
                send, reason = should_send_batch(
                    pcm_ms(len(held["pcm"])),
                    (now - held["since"]) * 1000,
                    max_wait_ms=max_wait,
                )
                if reason == "drop":
                    # Never enough speech to be worth a request, and no more
                    # is coming. Letting it go is the point.
                    del self._pending[user_id]
                    log.debug(
                        "Transcribe: dropped %.0f ms of thin audio from %s in guild %s",
                        pcm_ms(len(held["pcm"])),
                        user_id,
                        self.guild.id,
                    )
                    continue
                if not send:
                    continue
                del self._pending[user_id]
                self._dispatch_batch(user_id, bytes(held["pcm"]), settings)

        if self._ready_to_post(_now_ms()):
            await self._post_lines()
        return False

    # ── Speaking (the mirror of the transcript) ─────────────────────────────

    def say(self, text: str) -> bool:
        """Queue a line to be read into the voice channel. Never blocks.

        Called from the message listener, so it must not wait: a full queue
        drops the line and says so rather than holding up the event loop.
        """
        if self._stopping or not text:
            return False
        if self._clock() < self._speak_hold_until:
            # Groq's speech budget is gone. Queueing anyway would spend a
            # failed request per line and post an error per line, which is
            # what turned one exhausted budget into forty log entries.
            return False
        try:
            self._speak_queue.put_nowait(text)
        except asyncio.QueueFull:
            log.debug("Transcribe: speech queue full in guild %s; skipped a line", self.guild.id)
            return False
        if self._speaker is None or self._speaker.done():
            self._speaker = asyncio.create_task(self._speak_loop())
        return True

    def silence(self) -> int:
        """Stop talking now and forget what was queued. Returns how many
        waiting lines were dropped."""
        dropped = 0
        while True:
            try:
                self._speak_queue.get_nowait()
            except asyncio.QueueEmpty:
                break
            self._speak_queue.task_done()
            dropped += 1
        self._skip = True
        # stop() fires the after-callback, which is what releases play_wav.
        if self.vc is not None and self.vc.is_playing():
            self.vc.stop()
        return dropped

    async def _speak_loop(self) -> None:
        while not self._stopping:
            try:
                text = await self._speak_queue.get()
            except asyncio.CancelledError:
                return
            self._skip = False  # a fresh line is not covered by an old skip
            try:
                await self._speak(text)
            except asyncio.CancelledError:
                raise
            except Exception:
                # One line that would not speak must not silence the rest.
                log.exception("Transcribe: could not speak a line in guild %s", self.guild.id)
            finally:
                self._speak_queue.task_done()

    async def _speak(self, text: str) -> None:
        api_key = await self.cog._api_key()
        if not api_key or self.vc is None:
            return
        settings = await self._settings_now(self._clock())
        voice = settings.get("tts_voice") or "autumn"
        for chunk in chunk_for_speech(text):
            # Checked between pieces, so a long message can be cut off in the
            # middle instead of only between messages — which is the whole
            # point when one message can now run to twenty pieces.
            if self._stopping or self._skip or self.vc is None:
                return
            try:
                wav = await self.cog._speech(api_key, chunk, voice)
            except RateLimited as error:
                # The day's speech budget is spent. Abandon the rest of this
                # message AND everything queued behind it: by the time the
                # window rolls, minutes later, none of it is worth saying.
                wait = max(1.0, error.retry_after_ms / 1000)
                self._speak_hold_until = self._clock() + wait
                dropped = self.silence()
                self._skip = False  # silence() set it; the hold is the brake now
                log.warning(
                    "Transcribe: Groq's speech budget is spent in guild %s; quiet for %.0f min "
                    "(%d queued message(s) dropped).",
                    self.guild.id,
                    wait / 60,
                    dropped,
                )
                return
            if self._skip:
                return  # asked to stop while that piece was being synthesised
            await self._play(wav)

    async def _play(self, wav: bytes) -> None:
        if self.vc is None:
            return
        await play_wav(self.vc, wav)

    def _remember(self, text: Any) -> None:
        """Keep what was just said, to hand to Whisper with the next fragment.

        Only CLEANED text goes in. A hallucination in the context does not sit
        there quietly — the prompt is a bias, so "Thank you." would make the
        next fragment likelier to come back as "Thank you." too, and the
        transcript would talk itself into a loop.
        """
        clean = clean_transcript(text)
        if not clean:
            return
        self._context.append(clean)
        del self._context[:-CONTEXT_LINES]

    def _context_prompt(self) -> str:
        return " ".join(self._context)

    def _hold(self, user_id: int, pcm: bytes, now: float, *, first: bool = False) -> None:
        """Add audio to a speaker's pending batch, bounded.

        ``first`` puts it in FRONT: a batch Groq refused is older than
        anything said since, and a transcript out of order reads worse than
        one that is late.
        """
        held = self._pending.get(user_id)
        if held is None:
            held = {"pcm": bytearray(), "since": now}
            self._pending[user_id] = held
        # Only between turns, never leading or trailing: padding the edges
        # would just buy silence for Whisper to hallucinate over.
        gap = b"\x00" * (BATCH_GAP_MS * PCM_BYTES_PER_MS) if held["pcm"] else b""
        if first:
            held["pcm"][:0] = pcm + gap
            # Keep the older wait, so requeued speech leaves at the first
            # opportunity rather than serving a fresh sentence out of order.
            held["since"] = min(held["since"], now)
        else:
            held["pcm"] += gap + pcm
        # A long refusal must not turn into unbounded memory. The oldest audio
        # is both the least useful and the most likely to be stale by the time
        # capacity returns.
        if len(held["pcm"]) > HARD_CAP_BYTES:
            excess = len(held["pcm"]) - HARD_CAP_BYTES
            del held["pcm"][:excess]
            self._note_dropped_audio(pcm_ms(excess))

    def _note_dropped_audio(self, ms: float) -> None:
        """Say once, per session, that speech was thrown away."""
        was_silent = self._dropped_ms == 0
        self._dropped_ms += ms
        if was_silent:
            log.warning(
                "Transcribe: dropping buffered speech in guild %s — Groq capacity has been "
                "unavailable long enough that the backlog hit its ceiling.",
                self.guild.id,
            )

    def _handle_refusal(self, user_id: int, pcm: bytes, verdict: Dict[str, Any]) -> None:
        """A batch Groq would not take.

        Keeps the speech when the window rolls soon enough to be worth
        waiting for, and stops offering batches until then — without the hold
        the tick re-offers the same refused audio five times a second.
        """
        reason = verdict.get("reason")
        retry_ms = int(verdict.get("retry_after_ms") or 0)
        if reason not in RATE_REASONS:
            # A precinct's own daily cap, not Groq's: it resets at midnight
            # UTC, which is not a wait — it is a decision already made.
            log.warning('Transcribe: refused a turn in guild %s — "%s".', self.guild.id, reason)
            return

        self._rate_hold_until = self._clock() + min(retry_ms, RATE_HOLD_CAP_MS) / 1000
        if 0 < retry_ms <= REQUEUE_MAX_WAIT_MS:
            self._hold(user_id, pcm, self._clock(), first=True)
            log.warning(
                'Transcribe: Groq limit "%s" reached in guild %s; holding %.1fs and retrying.',
                reason,
                self.guild.id,
                retry_ms / 1000,
            )
        else:
            log.warning(
                'Transcribe: Groq limit "%s" reached in guild %s; a turn was dropped '
                "(the window does not roll for %.0f min).",
                reason,
                self.guild.id,
                retry_ms / 60_000,
            )

    def _restart_listening(self, now: float) -> bool:
        """Put a fresh sink on the connection after the receiver died.

        Returns False when the allowance is spent or the restart itself
        failed, which is the caller's cue to end the session rather than keep
        a deaf bot in the channel.
        """
        if now - self._relisten_at > RELISTEN_WINDOW_SECS:
            self._relistens = 0  # the last restart held; start counting again
        if self._relistens >= MAX_RELISTENS:
            return False
        self._relistens += 1
        self._relisten_at = now
        try:
            self.vc.stop_listening()  # drops the dead reader, if any is left
            self._listen()
        except Exception:
            log.exception(
                "Transcribe: could not restart the voice receiver in guild %s", self.guild.id
            )
            return False
        log.warning(
            "Transcribe: the voice receiver stopped in guild %s; restarted it (%d/%d).",
            self.guild.id,
            self._relistens,
            MAX_RELISTENS,
        )
        return True

    # ── Dispatch ────────────────────────────────────────────────────────────

    def _dispatch_batch(self, user_id: int, pcm: bytes, settings: Dict[str, Any]) -> None:
        """Hand a batch to a background task and return within the same beat.

        Awaiting the call here — as this used to — meant one speaker's request
        blocked the tick for its whole duration (up to WHISPER_TIMEOUT_SECS):
        no other speaker's turn ended, no other batch went out, and nothing was
        posted until it came back. With three people talking the calls queued
        behind each other and the transcript fell steadily further behind.
        """
        self._seq += 1
        seq = self._seq
        # Stamp the line when the audio was captured, not when Groq answers.
        # The old stamp drifted by the round-trip; concurrent batches would
        # make it drift by a different amount per line.
        at_ms = _now_ms()
        task = asyncio.create_task(self._run_batch(seq, user_id, pcm, settings, at_ms))
        self._inflight[seq] = task
        task.add_done_callback(lambda _task, key=seq: self._inflight.pop(key, None))

    async def _run_batch(
        self, seq: int, user_id: int, pcm: bytes, settings: Dict[str, Any], at_ms: int
    ) -> None:
        """Run one batch under the concurrency cap.

        Deliberately does NOT bail out on ``_stopping``: a batch that has been
        dispatched is audio someone already spoke, and teardown sets that flag
        before it drains. Shutdown bounds these with a timeout and a cancel
        instead.
        """
        async with self._slots:
            await self._transcribe_batch(seq, user_id, pcm, settings, at_ms)

    def _ready_to_post(self, now: int) -> bool:
        """Is the line buffer both due and safe to post?

        Due: the usual time/size thresholds. Safe: no batch older than the
        newest buffered line is still running — posting now would put that
        line in the channel ahead of speech that came before it. The hold is
        capped at ORDER_HOLD_MS so one slow request cannot strand the rest.
        """
        # Posts deferred from an earlier flush are already packed and already
        # late; they go before any ordering question about new lines.
        if self._backlog:
            return True
        if not self._lines.should_flush(now):
            return False
        if all(seq > self._lines.max_seq for seq in self._inflight):
            return True
        first_at = self._lines.waiting_since
        return first_at is not None and now - first_at >= ORDER_HOLD_MS

    async def _transcribe_batch(
        self, seq: int, user_id: int, pcm: bytes, settings: Dict[str, Any], at_ms: int
    ) -> None:
        """One batch through the EXISTING pipeline: budget claim → Whisper →
        refund on failure → hallucination filter → line buffer."""
        try:
            api_key = await self.cog._api_key()
            if not api_key:
                log.warning("Transcribe: no Groq key; dropping a live-voice batch.")
                return
            wav, seconds = pcm_to_wav(pcm)
            verdict = await self.cog._claim(self.guild, seconds)
            if not verdict["ok"]:
                # A rate refusal is not a defect: Groq's own ceiling was
                # reached. The speech is put back rather than thrown away.
                self._handle_refusal(user_id, pcm, verdict)
                return
            try:
                text = await self.cog._whisper(
                    api_key,
                    wav,
                    filename="live.wav",
                    content_type="audio/wav",
                    translate=settings["translate_to_english"],
                    language=settings.get("language") or "",
                    prompt=self._context_prompt(),
                )
            except RateLimited as error:
                # Counted by Groq, so no refund — but the speech is still good
                # and goes back in the queue to leave when the window rolls.
                self._handle_refusal(
                    user_id, pcm, {"reason": "rpm", "retry_after_ms": error.retry_after_ms}
                )
                return
            except Exception as error:
                await self.cog._refund(self.guild, verdict["cost"])
                log.warning("Transcribe: voice chunk failed — %s", error)
                return

            self.cog.dump_batch(self.guild, user_id, wav, seconds, text)

            # Member names on the asyncio side only — never on the sink thread.
            member = self.guild.get_member(user_id)
            name = member.display_name if member is not None else f"<@{user_id}>"
            line = format_line(
                name=name,
                text=apply_replacements(text, settings.get("replacements")),
                at_ms=at_ms,
                timestamps=settings["voice_timestamps"],
            )
            self._lines.add(line, _now_ms(), seq)
            # The ORIGINAL goes into the context, not the substituted version:
            # the prompt is there to tell Whisper what was actually said, and
            # feeding it the stand-in would steer the next fragment toward it.
            self._remember(text)
        except Exception:
            log.exception("Transcribe: live-voice batch failed in guild %s", self.guild.id)

    async def _post_lines(self, *, final: bool = False) -> None:
        """Send what is due, a couple of messages at a time.

        ``pack_lines`` already keeps each post inside Discord's 2,000-character
        ceiling; what is bounded here is how MANY go out at once. On teardown
        there is no next beat to defer to, so everything left goes now.
        """
        posts = self._backlog + pack_lines(self._lines.drain())
        self._backlog = []
        if not posts:
            return
        if not final and len(posts) > MAX_POSTS_PER_FLUSH:
            posts, self._backlog = posts[:MAX_POSTS_PER_FLUSH], posts[MAX_POSTS_PER_FLUSH:]
            if len(self._backlog) > MAX_BACKLOG_POSTS:
                lost = len(self._backlog) - MAX_BACKLOG_POSTS
                self._backlog = self._backlog[-MAX_BACKLOG_POSTS:]
                log.warning(
                    "Transcribe: %s transcript post(s) dropped in guild %s — the channel is "
                    "further behind than it can catch up.",
                    lost,
                    self.guild.id,
                )
        for post in posts:
            try:
                await self.text_channel.send(content=post, allowed_mentions=self._allowed)
            except discord.HTTPException as error:
                log.warning("Transcribe: could not post a voice transcript: %s", error)
            except Exception as error:
                log.warning("Transcribe: could not post a voice transcript: %s", error)


def _now_ms() -> int:
    return int(time.time() * 1000)
