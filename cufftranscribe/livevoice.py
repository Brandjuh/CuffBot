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
does everything else: ends turns after silence, batches them per speaker,
downmixes to 16 kHz mono WAV, and sends them through the cog's existing
budget claim and Whisper client.
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

log = logging.getLogger("red.cuff-cogs.cufftranscribe.livevoice")

# ── Optional dependencies ────────────────────────────────────────────────────
#
# The cog must load (and keep serving voice memos) even when the voice-receive
# stack is missing, so both imports are defensive. Commands check
# ``voice_recv is None`` and explain instead of crashing Red.

try:  # pragma: no cover - environment dependent
    from discord.ext import voice_recv
except Exception:  # ImportError, or PyNaCl/opus loading trouble inside it
    voice_recv = None  # type: ignore[assignment]

try:  # pragma: no cover - stdlib on 3.11/3.12, gone in 3.13
    import audioop
except Exception:
    audioop = None  # type: ignore[assignment]


def live_voice_available() -> Tuple[bool, str]:
    """Can live voice work in this install? Returns ``(ok, why-not)``."""
    if voice_recv is None:
        return False, "the `discord-ext-voice-recv` / `pynacl` packages are not installed"
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
BATCH_TARGET_MS = 10_000  # Groq's minimum billed length
BATCH_MAX_WAIT_MS = 6_000  # never hold a line longer than this

#: The sink delivers 48 kHz, 16-bit, stereo PCM: 48000 × 2 bytes × 2 channels
#: per second = 192 bytes per millisecond. The byte count IS the clock — every
#: 20 ms frame is exactly 3840 bytes — so durations are exact, not estimated.
PCM_BYTES_PER_MS = 48_000 * 2 * 2 // 1000
HARD_CAP_BYTES = HARD_CAP_MS * PCM_BYTES_PER_MS

WATCHDOG_TICK_SECS = 0.2

# Line buffer thresholds (port of createLineBuffer defaults).
FLUSH_AFTER_MS = 5_000
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
    # A single remark in a quiet channel must not sit unsent forever waiting
    # for a second one that is never coming.
    if held_since_ms >= max_wait_ms:
        return True, "waited"
    return False, "hold"


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
]

_TRAILING_NOISE = re.compile(r"[!?.,\s]+$")


def clean_transcript(text: Any) -> str:
    """Strip a transcript that is really just silence. Returns '' when it is."""
    trimmed = str(text if text is not None else "").strip()
    bare = _TRAILING_NOISE.sub("", trimmed.lower()).strip()
    if len(bare) == 0:
        return ""
    if bare in HALLUCINATIONS:
        return ""
    return trimmed


# ── Transcript lines (port of formatLine / packLines / createLineBuffer) ─────


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
    because enough time has passed or because it is nearly a full post."""

    def __init__(self, *, flush_after_ms: int = FLUSH_AFTER_MS, soft_limit: int = SOFT_LIMIT):
        self._flush_after_ms = flush_after_ms
        self._soft_limit = soft_limit
        self._lines: List[str] = []
        self._first_at: Optional[int] = None

    def add(self, line: Optional[str], now: int) -> None:
        if line is None:
            return
        if not self._lines:
            self._first_at = now
        self._lines.append(line)

    @property
    def size(self) -> int:
        return len(self._lines)

    @property
    def length(self) -> int:
        return sum(len(line) + 1 for line in self._lines)

    def should_flush(self, now: int) -> bool:
        """Time-based OR size-based; a long silence must not strand a line."""
        if not self._lines:
            return False
        assert self._first_at is not None
        return now - self._first_at >= self._flush_after_ms or self.length >= self._soft_limit

    def drain(self) -> List[str]:
        out = self._lines
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

    __slots__ = ("buf", "started", "last_packet")

    def __init__(self, now: float):
        self.buf = bytearray()
        self.started = now
        self.last_packet = now


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

        # Speaker-filter snapshot, refreshed by the watchdog. The sink thread
        # reads these, so they are plain immutable values, swapped atomically.
        self._ignore_bots = True
        self._ignored_ids: frozenset = frozenset()

    # ── Lifecycle (asyncio side) ────────────────────────────────────────────

    async def start(self) -> None:
        settings = await self.cog.config.guild(self.guild).all()
        self._apply_settings(settings)
        # Deafening itself would stop the receiver, but muting costs nothing
        # and tells everyone in the channel that the bot will not talk back.
        self.vc = await self.voice_channel.connect(
            cls=voice_recv.VoiceRecvClient, self_deaf=False, self_mute=True
        )
        self.vc.listen(_CaptureSink(self))
        self._task = asyncio.create_task(self._watchdog())

    async def stop(self, *, post_remaining: bool = True) -> None:
        """Disconnect and clean up. Never raises."""
        self._stopping = True
        task, self._task = self._task, None
        if task is not None and task is not asyncio.current_task():
            task.cancel()
            with contextlib.suppress(asyncio.CancelledError, Exception):
                await task
        if post_remaining:
            with contextlib.suppress(Exception):
                await self._post_lines()
        vc, self.vc = self.vc, None
        if vc is not None:
            with contextlib.suppress(Exception):
                vc.stop_listening()
            with contextlib.suppress(Exception):
                await vc.disconnect(force=True)

    def _apply_settings(self, settings: Dict[str, Any]) -> None:
        self._ignore_bots = bool(settings.get("ignore_bots", True))
        self._ignored_ids = frozenset(int(i) for i in (settings.get("ignored_user_ids") or []))

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
        with self._lock:
            capture = self._captures.get(user_id)
            if capture is None:
                capture = _Capture(now)
                self._captures[user_id] = capture
            # Hard cap: stop accepting packets for this turn rather than grow
            # without bound; the turn still ends on real silence.
            if len(capture.buf) < HARD_CAP_BYTES:
                capture.buf += pcm
            capture.last_packet = now

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

        settings = await self.cog.config.guild(self.guild).all()
        self._apply_settings(settings)
        now = self._clock()

        # Finished turns join their speaker's pending batch (S123: batching
        # toward Groq's 10-second billing floor).
        for user_id, pcm in self.collect_finished(now):
            held = self._pending.get(user_id)
            if held is None:
                held = {"pcm": bytearray(), "since": now}
                self._pending[user_id] = held
            held["pcm"] += pcm

        # Send every batch that is big enough or has waited long enough. The
        # tick is also what ages out held audio — the difference between
        # "batching" and "losing the last thing anyone said".
        for user_id, held in list(self._pending.items()):
            send, _reason = should_send_batch(
                pcm_ms(len(held["pcm"])), (now - held["since"]) * 1000
            )
            if not send:
                continue
            del self._pending[user_id]
            await self._transcribe_batch(user_id, bytes(held["pcm"]), settings)

        if self._lines.should_flush(_now_ms()):
            await self._post_lines()
        return False

    async def _transcribe_batch(self, user_id: int, pcm: bytes, settings: Dict[str, Any]) -> None:
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
                # reached. Say so once rather than dropping the turn silently.
                if verdict["reason"] in ("rpm", "rpd", "audio-hour", "audio-day"):
                    log.warning(
                        'Transcribe: Groq limit "%s" reached; skipping a turn.', verdict["reason"]
                    )
                return
            try:
                text = await self.cog._whisper(
                    api_key,
                    wav,
                    filename="live.wav",
                    content_type="audio/wav",
                    translate=settings["translate_to_english"],
                )
            except Exception as error:
                await self.cog._refund(self.guild, verdict["cost"])
                log.warning("Transcribe: voice chunk failed — %s", error)
                return

            # Member names on the asyncio side only — never on the sink thread.
            member = self.guild.get_member(user_id)
            name = member.display_name if member is not None else f"<@{user_id}>"
            line = format_line(
                name=name,
                text=text,
                at_ms=_now_ms(),
                timestamps=settings["voice_timestamps"],
            )
            self._lines.add(line, _now_ms())
        except Exception:
            log.exception("Transcribe: live-voice batch failed in guild %s", self.guild.id)

    async def _post_lines(self) -> None:
        lines = self._lines.drain()
        if not lines:
            return
        for post in pack_lines(lines):
            try:
                await self.text_channel.send(
                    content=post, allowed_mentions=discord.AllowedMentions.none()
                )
            except discord.HTTPException as error:
                log.warning("Transcribe: could not post a voice transcript: %s", error)
            except Exception as error:
                log.warning("Transcribe: could not post a voice transcript: %s", error)


def _now_ms() -> int:
    return int(time.time() * 1000)
