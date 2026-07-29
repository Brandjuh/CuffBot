"""CuffTranscribe — speech-to-text for voice memos, audio files and live voice.

Ported from CuffBot's Node.js ``transcribe`` module. Voice memos (Discord's
native voice messages) and attached audio files are sent to the Groq Whisper
API and posted back as a written statement, translated to English by default.

Live voice is supported too (see ``livevoice.py``): the bot joins a voice
channel — on request or automatically — and writes the conversation into the
paired text channel. Live listening and the Audio (music) cog cannot use
voice in the same guild at the same time; whoever holds the connection wins.
"""

from __future__ import annotations

import asyncio
import contextlib
import json
import logging
import re
from pathlib import Path
from typing import Any, Dict, List, Optional, Tuple, Union

import aiohttp
import discord
from redbot.core import Config, checks, commands

from . import livevoice
from .limits import (
    REFUSAL_TEXT,
    check_budget,
    day_key,
    describe_usage,
    now_ms,
    record_spend,
    release_rate,
    spend_budget,
)

log = logging.getLogger("red.cuff-cogs.cufftranscribe")

# ── Detection rules (port of lib/transcribe.js) ─────────────────────────────

#: Discord sets this message flag on its native voice-message feature.
VOICE_MESSAGE_FLAG = 1 << 13  # 8192

#: Groq's audio endpoints cap uploads at 25 MB on the free tier. A Discord
#: voice message is far below this; an uploaded podcast is not, and refusing
#: it with a clear reason beats letting Groq return an opaque 413.
MAX_AUDIO_BYTES = 25 * 1024 * 1024

#: What counts as audio. Discord voice messages are always ``audio/ogg``, but
#: members attach all of these, and content-type is missing often enough that
#: the extension has to be a fallback rather than a nicety.
AUDIO_EXTENSIONS = (
    "ogg",
    "oga",
    "opus",
    "mp3",
    "m4a",
    "mp4",
    "wav",
    "webm",
    "flac",
    "mpga",
    "mpeg",
)

# ── Whisper endpoints (port of lib/audio-provider.js) ───────────────────────

#: Whisper large-v3 for translation — it is the only model Groq's translation
#: endpoint accepts — and the turbo variant when the audio should stay in its
#: spoken language, because it is markedly faster and translation is the only
#: thing it cannot do.
TRANSLATE_MODEL = "whisper-large-v3"
TRANSCRIBE_MODEL = "whisper-large-v3-turbo"

TRANSLATIONS_URL = "https://api.groq.com/openai/v1/audio/translations"
TRANSCRIPTIONS_URL = "https://api.groq.com/openai/v1/audio/transcriptions"

DOWNLOAD_TIMEOUT_SECS = 30
WHISPER_TIMEOUT_SECS = 60

#: Where the legacy Node bot keeps its per-guild JSON, for ``migratecuff``.
CUFFBOT_DATA_DIR = Path("/home/brand/CuffBot/data")

#: Why the bot said no, in the precinct's words.
REFUSALS = {
    "disabled": "Transcription is switched off in this precinct.",
    "bot": "That message is from a bot.",
    "ignored": "That member asked not to be transcribed.",
    "no-audio": "There is no audio attached to that message.",
    "out-of-scope": "That channel is not covered by the transcription desk.",
    "auto-off": "Automatic transcription is off for that kind of attachment.",
    "too-large": (
        f"That file is over the {MAX_AUDIO_BYTES // (1024 * 1024)} MB "
        "the transcription service accepts."
    ),
    "too-long": "That recording is longer than the configured limit.",
    "daily-limit": (
        "The precinct has used its transcription budget for today. It resets at midnight UTC."
    ),
}


def refusal_for(reason: str) -> str:
    return REFUSALS.get(reason, "That recording cannot be transcribed.")


class TranscribeError(RuntimeError):
    """A download or Groq call that did not produce a transcript."""


# ── Pure helpers (ports of lib/transcribe.js, tested without a gateway) ─────


def is_audio_attachment(attachment: Any) -> bool:
    """Does this attachment look like audio? Content-type wins when present;
    otherwise the extension decides."""
    if attachment is None:
        return False
    content_type = (getattr(attachment, "content_type", None) or "").lower()
    if content_type.startswith("audio/"):
        return True
    # ``video/webm`` and ``video/mp4`` carry audio and Whisper accepts both,
    # but a real video is a big upload for one line of speech — leave those to
    # the extension check below so an explicit ``.webm`` audio note still works.
    name = (getattr(attachment, "filename", None) or "").lower()
    dot = name.rfind(".")
    if dot == -1:
        return False
    return name[dot + 1 :] in AUDIO_EXTENSIONS


def audio_attachments_of(message: Any) -> List[Any]:
    """Every audio attachment on a message, in order."""
    attachments = getattr(message, "attachments", None) or []
    return [a for a in attachments if is_audio_attachment(a)]


def is_voice_message(message: Any) -> bool:
    """Is this message one of Discord's native voice messages? The flag is the
    authority; the waveform is the fallback for shapes that do not carry
    flags."""
    flags = getattr(message, "flags", None)
    bits = getattr(flags, "value", None)
    if bits is None:
        bits = flags if isinstance(flags, int) else 0
    if bits & VOICE_MESSAGE_FLAG:
        return True
    return any(getattr(a, "waveform", None) for a in audio_attachments_of(message))


def eligibility(
    message: Any, settings: Dict[str, Any], *, manual: bool = False
) -> Tuple[bool, str, Optional[Any]]:
    """Should the bot transcribe this message?

    Returns ``(ok, reason, attachment)`` rather than a boolean because the
    manual command reuses the same rules and has to explain a refusal.
    """
    if not manual and not settings["enabled"]:
        return False, "disabled", None
    author = getattr(message, "author", None)
    if getattr(author, "bot", False):
        return False, "bot", None
    if author is not None and getattr(author, "id", None) in (settings["ignored_user_ids"] or []):
        return False, "ignored", None

    attachments = audio_attachments_of(message)
    if not attachments:
        return False, "no-audio", None

    if not manual:
        channel_ids = settings["channel_ids"] or []
        channel_id = getattr(getattr(message, "channel", None), "id", None)
        if channel_ids and channel_id not in channel_ids:
            return False, "out-of-scope", None
        voice = is_voice_message(message)
        if voice and not settings["auto_voice_messages"]:
            return False, "auto-off", None
        if not voice and not settings["auto_audio_files"]:
            return False, "auto-off", None

    # The first audio attachment is the memo. Transcribing all of them would
    # multiply the cost of one message by however many files it carried.
    attachment = attachments[0]
    if int(getattr(attachment, "size", 0) or 0) > MAX_AUDIO_BYTES:
        return False, "too-large", attachment
    duration = float(getattr(attachment, "duration", None) or 0)
    if settings["max_duration_secs"] > 0 and duration > settings["max_duration_secs"]:
        return False, "too-long", attachment
    return True, "ok", attachment


def format_duration(seconds: Any) -> str:
    """Human-readable duration: ``8s``, ``1m 04s``, ``12m 30s``."""
    try:
        number = float(seconds)
    except (TypeError, ValueError):
        number = 0.0
    # int(x + 0.5) matches JS Math.round for the non-negative values we get.
    total = max(0, int(number + 0.5))
    if total < 60:
        return f"{total}s"
    mins, secs = divmod(total, 60)
    return f"{mins}m {secs:02d}s"


def truncate_transcript(text: Any, limit: int = 3900) -> Tuple[str, bool]:
    """Fit a transcript into a Discord embed description, cutting at a word
    boundary and saying so. A silently halved statement is worse than a short
    one — the reader cannot tell which they are looking at."""
    clean = str(text if text is not None else "").strip()
    if len(clean) <= limit:
        return clean, False
    notice = "\n\n… *(transcript truncated)*"
    room = limit - len(notice)
    cut = clean[:room]
    last_space = cut.rfind(" ")
    body = cut[:last_space] if last_space > room * 0.6 else cut
    return body.rstrip() + notice, True


def transcript_embed_data(
    *,
    text: str,
    author_id: int,
    duration_secs: float = 0,
    translated: bool = True,
    filename: Optional[str] = None,
) -> Dict[str, Any]:
    """The reply the precinct sees. Pure: takes the facts, returns the embed
    data, so the wording is testable without a gateway."""
    body, truncated = truncate_transcript(text)
    parts = []
    if duration_secs > 0:
        parts.append(format_duration(duration_secs))
    parts.append("transcribed to English" if translated else "transcribed")
    if filename:
        parts.append(filename)
    return {
        "color": 0x2F6F9F,
        "title": "🎙️ Statement on the record",
        "description": body if body else "*(no speech detected)*",
        "footer": {"text": " · ".join(parts)},
        "fields": [{"name": "Speaker", "value": f"<@{author_id}>", "inline": True}],
        "truncated": truncated,
    }


def embed_from_data(data: Dict[str, Any]) -> discord.Embed:
    embed = discord.Embed(
        color=data["color"], title=data["title"], description=data["description"]
    )
    for field in data["fields"]:
        embed.add_field(name=field["name"], value=field["value"], inline=field["inline"])
    embed.set_footer(text=data["footer"]["text"])
    return embed


class CuffTranscribe(commands.Cog):
    """Turn voice memos into written statements, in English.

    Voice memos and audio attachments are transcribed through the Groq
    Whisper API. Live voice is supported too: the bot can join a voice
    channel and write the conversation into the paired text channel. Live
    listening and the Audio (music) cog cannot use voice at the same time.
    """

    def __init__(self, bot):
        self.bot = bot
        self.config = Config.get_conf(self, identifier=411157175003, force_registration=True)
        self.config.register_guild(
            enabled=True,
            channel_ids=[],
            auto_voice_messages=True,
            auto_audio_files=False,
            translate_to_english=True,
            max_duration_secs=600,
            daily_limit=0,
            ignored_user_ids=[],
            rate={"requests": [], "audio": []},
            budget={"day": "", "used": 0},
            # Live voice (port of the Node bot's voice-session settings).
            voice_timestamps=True,
            auto_join=True,
            voice_channel_ids=[],
            auto_join_minimum=1,
            voice_pairs={},
            ignore_bots=True,
        )
        self.session: Optional[aiohttp.ClientSession] = None
        self._has_key = False
        self._locks: Dict[int, asyncio.Lock] = {}
        #: guild id → LiveSession — one live capture per guild at a time.
        self.live_sessions: Dict[int, livevoice.LiveSession] = {}

    # ── Lifecycle ───────────────────────────────────────────────────────────

    async def cog_load(self) -> None:
        self.session = aiohttp.ClientSession()
        tokens = await self.bot.get_shared_api_tokens("groq")
        self._has_key = bool(tokens.get("api_key"))

    async def cog_unload(self) -> None:
        # Voice sessions first: they use the aiohttp session for Whisper, and
        # a dangling VoiceRecvClient would keep its decoder thread alive.
        for guild_id in list(self.live_sessions):
            try:
                await self._stop_live(guild_id, post_remaining=False)
            except Exception:
                log.exception("Transcribe: could not stop the live session in %s", guild_id)
        if self.session is not None:
            await self.session.close()

    @commands.Cog.listener()
    async def on_red_api_tokens_update(self, service_name: str, api_tokens: dict) -> None:
        if service_name == "groq":
            self._has_key = bool(api_tokens.get("api_key"))

    async def red_delete_data_for_user(self, *, requester, user_id: int) -> None:
        """The only user data kept is the per-guild ignore list."""
        all_guilds = await self.config.all_guilds()
        for guild_id, data in all_guilds.items():
            if user_id in (data.get("ignored_user_ids") or []):
                async with self.config.guild_from_id(
                    guild_id
                ).ignored_user_ids() as ignored:
                    while user_id in ignored:
                        ignored.remove(user_id)

    # ── Budget (claim-before-send, port of service.js) ──────────────────────

    def _lock_for(self, guild_id: int) -> asyncio.Lock:
        return self._locks.setdefault(guild_id, asyncio.Lock())

    async def _claim(self, guild: discord.Guild, seconds: float) -> Dict[str, Any]:
        """Claim capacity against Groq's own published limits, then the
        optional precinct cap. Claim-before-send: two memos landing together
        must not both see the last slot free."""
        async with self._lock_for(guild.id):
            now = now_ms()
            group = self.config.guild(guild)
            usage = await group.rate()
            verdict = check_budget(usage, seconds, now=now)
            if not verdict["ok"]:
                await group.rate.set(verdict["usage"])  # persist the pruning
                return verdict
            await group.rate.set(record_spend(verdict["usage"], verdict["cost"], now))

            limit = await group.daily_limit()
            counter, allowed = spend_budget(await group.budget(), limit, now)
            await group.budget.set(counter)
            if not allowed:
                await group.rate.set(release_rate(await group.rate(), verdict["cost"], now))
                return {
                    "ok": False,
                    "reason": "daily-limit",
                    "retry_after_ms": 0,
                    "cost": verdict["cost"],
                }
            return verdict

    async def _refund(self, guild: discord.Guild, cost: int) -> None:
        """Hand a claimed slot back when the work never happened."""
        async with self._lock_for(guild.id):
            now = now_ms()
            group = self.config.guild(guild)
            await group.rate.set(release_rate(await group.rate(), cost, now))
            counter = dict(await group.budget())
            counter["used"] = max(0, int(counter.get("used") or 0) - 1)
            await group.budget.set(counter)

    # ── Groq Whisper client (port of lib/audio-provider.js) ─────────────────

    async def _api_key(self) -> Optional[str]:
        tokens = await self.bot.get_shared_api_tokens("groq")
        return tokens.get("api_key")

    async def _download_audio(self, url: str) -> Tuple[bytes, str]:
        """Download an attachment into memory, enforcing the size ceiling on
        the actual bytes, not only on the size Discord advertised."""
        assert self.session is not None
        timeout = aiohttp.ClientTimeout(total=DOWNLOAD_TIMEOUT_SECS)
        try:
            async with self.session.get(url, timeout=timeout) as response:
                if response.status != 200:
                    raise TranscribeError(f"audio download HTTP {response.status}")
                content_type = response.headers.get("Content-Type") or "application/octet-stream"
                data = await response.read()
        except asyncio.TimeoutError as exc:
            raise TranscribeError("audio download timed out") from exc
        except aiohttp.ClientError as exc:
            raise TranscribeError(f"audio download failed: {exc}") from exc
        if len(data) > MAX_AUDIO_BYTES:
            raise TranscribeError(f"audio is {len(data)} bytes, over the {MAX_AUDIO_BYTES} limit")
        return data, content_type

    async def _whisper(
        self,
        api_key: str,
        data: bytes,
        *,
        filename: str,
        content_type: str,
        translate: bool,
    ) -> str:
        """Speech in, text out. The ORIGINAL filename matters — Whisper infers
        the container from the extension."""
        assert self.session is not None
        form = aiohttp.FormData()
        form.add_field("file", data, filename=filename, content_type=content_type)
        form.add_field("model", TRANSLATE_MODEL if translate else TRANSCRIBE_MODEL)
        form.add_field("response_format", "json")
        # Whisper hallucinates fluent nonsense on silence at higher
        # temperatures; 0 is what the model card recommends.
        form.add_field("temperature", "0")

        url = TRANSLATIONS_URL if translate else TRANSCRIPTIONS_URL
        timeout = aiohttp.ClientTimeout(total=WHISPER_TIMEOUT_SECS)
        try:
            async with self.session.post(
                url,
                data=form,
                # Only Authorization by hand: aiohttp derives the multipart
                # Content-Type (with boundary) from the FormData.
                headers={"Authorization": f"Bearer {api_key}"},
                timeout=timeout,
            ) as response:
                if response.status != 200:
                    try:
                        body = (await response.text())[:300]
                    except Exception:
                        body = "(unreadable body)"
                    raise TranscribeError(f"groq audio HTTP {response.status}: {body}")
                payload = await response.json()
        except asyncio.TimeoutError as exc:
            raise TranscribeError("groq audio request timed out") from exc
        except aiohttp.ClientError as exc:
            raise TranscribeError(f"groq audio request failed: {exc}") from exc
        text = payload.get("text") if isinstance(payload, dict) else None
        if not isinstance(text, str):
            raise TranscribeError("groq audio: no text in response")
        return text.strip()

    # ── Orchestration (port of service.js transcribeMessage) ────────────────

    async def _transcribe_message(
        self, guild: discord.Guild, message: discord.Message, *, manual: bool = False
    ) -> Dict[str, Any]:
        settings = await self.config.guild(guild).all()
        ok, reason, attachment = eligibility(message, settings, manual=manual)
        if not ok:
            return {"ok": False, "reason": reason}

        api_key = await self._api_key()
        if not api_key:
            return {"ok": False, "reason": "no-key"}

        # Discord ships a duration on voice messages; a plain file has none,
        # so it is priced at Groq's 10-second billing floor — the honest
        # assumption when the length is genuinely unknown (no true-up later,
        # matching the Node bot).
        duration = float(getattr(attachment, "duration", None) or 0)
        verdict = await self._claim(guild, duration)
        if not verdict["ok"]:
            return {
                "ok": False,
                "reason": verdict["reason"],
                "retry_after_ms": verdict.get("retry_after_ms", 0),
            }

        try:
            data, downloaded_type = await self._download_audio(attachment.url)
            text = await self._whisper(
                api_key,
                data,
                filename=attachment.filename or "voice-message.ogg",
                content_type=attachment.content_type or downloaded_type,
                translate=settings["translate_to_english"],
            )
        except Exception as error:  # the work never happened; do not charge
            await self._refund(guild, verdict["cost"])
            return {"ok": False, "reason": "failed", "detail": str(error)}

        embed_data = transcript_embed_data(
            text=text,
            author_id=message.author.id,
            duration_secs=duration,
            translated=settings["translate_to_english"],
            filename=None if is_voice_message(message) else attachment.filename,
        )
        return {"ok": True, "text": text, "embed": embed_from_data(embed_data)}

    # ── Auto path (port of events/message.js) ───────────────────────────────

    @commands.Cog.listener()
    async def on_message(self, message: discord.Message) -> None:
        if message.guild is None or message.author.bot:
            return
        # Cheap gate first: the overwhelming majority of messages carry no
        # audio, and this handler runs on every one of them.
        if not audio_attachments_of(message):
            return
        if await self.bot.cog_disabled_in_guild(self, message.guild):
            return

        try:
            result = await self._transcribe_message(message.guild, message, manual=False)
            if not result["ok"]:
                # A refusal on the AUTO path is silent by design: "that
                # channel is not covered" or "no key configured" is a reply to
                # nobody's question. The manual command says all of it out loud.
                if result["reason"] == "failed":
                    log.warning("Transcribe: %s failed — %s", message.id, result.get("detail"))
                return
            await message.reply(
                embed=result["embed"], allowed_mentions=discord.AllowedMentions.none()
            )
        except discord.HTTPException as error:
            log.warning("Transcribe: could not post a transcript: %s", error)

    # ── Live voice (port of voice/session.js + events/voice-state.js) ───────

    async def _start_live(
        self, guild: discord.Guild, voice_channel, text_channel, how: str
    ) -> Dict[str, Any]:
        """Join a voice channel and start writing down what is said."""
        ok, why = livevoice.live_voice_available()
        if not ok:
            return {"ok": False, "reason": "no-deps", "detail": why}
        if guild.id in self.live_sessions:
            return {"ok": False, "reason": "already-listening"}
        session = livevoice.LiveSession(self, guild, voice_channel, text_channel, how)
        self.live_sessions[guild.id] = session
        try:
            await session.start()
        except Exception as error:
            self.live_sessions.pop(guild.id, None)
            with contextlib.suppress(Exception):
                await session.stop(post_remaining=False)
            log.warning("Transcribe: could not join %s: %s", voice_channel.id, error)
            return {"ok": False, "reason": "join-failed"}
        return {"ok": True}

    async def _stop_live(self, guild_id: int, *, post_remaining: bool = True) -> bool:
        """Leave the channel, posting whatever transcript lines are buffered."""
        session = self.live_sessions.pop(guild_id, None)
        if session is None:
            return False
        await session.stop(post_remaining=post_remaining)
        return True

    def _voice_slot_free(self, guild: discord.Guild) -> bool:
        """Is the guild's one voice connection actually free? The Audio
        (Lavalink) cog may own it — refuse rather than fight over the slot."""
        me_voice = guild.me.voice if guild.me else None
        return guild.voice_client is None and me_voice is None

    async def _live_prefix(self, guild: discord.Guild) -> str:
        """A usable text prefix for messages sent outside a command context."""
        try:
            prefixes = await self.bot.get_valid_prefixes(guild)
            for prefix in prefixes:
                if not prefix.startswith("<@"):
                    return prefix
            if prefixes:
                return prefixes[0]
        except Exception:
            pass
        return "[p]"

    @commands.Cog.listener()
    async def on_voice_state_update(
        self,
        member: discord.Member,
        before: discord.VoiceState,
        after: discord.VoiceState,
    ) -> None:
        guild = member.guild
        if guild is None:
            return
        # The bot's own comings and goings must not trigger anything, or
        # joining would immediately re-trigger itself.
        if guild.me and member.id == guild.me.id:
            return
        if not livevoice.live_voice_available()[0]:
            return
        if await self.bot.cog_disabled_in_guild(self, guild):
            return
        try:
            await self._handle_voice_leave(guild, before, after)
            await self._handle_voice_join(guild, before, after)
        except Exception as error:
            log.warning("Transcribe: voice-state handling failed: %s", error)

    async def _handle_voice_leave(
        self, guild: discord.Guild, before: discord.VoiceState, after: discord.VoiceState
    ) -> None:
        """The last human left the channel the bot is sitting in."""
        left = before.channel
        if left is None or (after.channel is not None and after.channel.id == left.id):
            return
        session = self.live_sessions.get(guild.id)
        if session is None or session.voice_channel.id != left.id:
            return
        if not livevoice.should_auto_leave(livevoice.humans_in(left)):
            return
        # Sitting alone in an empty channel would transcribe silence forever.
        text_channel = session.text_channel
        await self._stop_live(guild.id)
        with contextlib.suppress(Exception):
            await text_channel.send("⚪ Everyone left, so I did too. Recording stopped.")

    async def _handle_voice_join(
        self, guild: discord.Guild, before: discord.VoiceState, after: discord.VoiceState
    ) -> None:
        """Somebody arrived in a channel the bot is not already in."""
        channel = after.channel
        if channel is None or (before.channel is not None and before.channel.id == channel.id):
            return
        if guild.id in self.live_sessions:
            return  # one table at a time; already busy

        settings = await self.config.guild(guild).all()
        ok, _reason = livevoice.should_auto_join(
            livevoice.humans_in(channel), channel.id, settings
        )
        if not ok:
            return
        # No key means no transcript, so joining would only make the bot
        # appear in the channel doing nothing. Stay out.
        if not await self._api_key():
            return

        text_channel, how = livevoice.transcript_channel_for(
            guild, channel, settings["voice_pairs"]
        )
        if text_channel is None:
            log.warning("Transcribe: no text channel found for voice channel %s", channel.name)
            return
        if not livevoice.can_work(guild, channel, text_channel):
            return
        # The Audio (music) cog may own the guild's one voice slot. Auto-join
        # backs off silently — barging into the DJ booth is not its call.
        if not self._voice_slot_free(guild):
            return

        result = await self._start_live(guild, channel, text_channel, how)
        if not result["ok"]:
            return

        # Everyone in earshot is told, unprompted — the bot let itself in, so
        # the announcement matters more here than for `transcribe join`.
        prefix = await self._live_prefix(guild)
        content = (
            f"🔴 **Recording {channel.mention}.** I joined automatically; everything said "
            f"there is transcribed here{' in English' if settings['translate_to_english'] else ''}.\n"
            f"`{prefix}transcribe leave` stops it now · "
            f"`{prefix}transcribe autojoin false` stops it for good."
        )
        if how == "built-in":
            content += (
                "\n*(No text channel is paired with that voice channel, so this is its own chat.)*"
            )
        with contextlib.suppress(Exception):
            await text_channel.send(content, allowed_mentions=discord.AllowedMentions.none())

    # ── Commands ────────────────────────────────────────────────────────────

    @commands.guild_only()
    @commands.group(name="transcribe", aliases=["stt", "statement"], invoke_without_command=True)
    async def transcribe(self, ctx: commands.Context) -> None:
        """Turn voice memos into written statements, in English.

        Run without a subcommand for the desk's current status.
        """
        settings = await self.config.guild(ctx.guild).all()
        usage = describe_usage(settings["rate"])
        limits = usage["limits"]
        pct = round(usage["tightest"] * 100)
        budget_line = (
            f"**Groq budget:** {usage['minute']}/{limits['requests_per_minute']} this minute · "
            f"{usage['day']}/{limits['requests_per_day']} today · "
            f"{round(usage['audio_hour'] / 60)}/{limits['audio_seconds_per_hour'] // 60} "
            "audio-min this hour"
        )
        if pct >= 80:
            budget_line += f" · ⚠️ {pct}% of the tightest window used"

        channels = settings["channel_ids"]
        ignored = settings["ignored_user_ids"]
        used_today = (
            settings["budget"]["used"] if settings["budget"].get("day") == day_key() else 0
        )

        lines = [
            "🎙️ **Transcription desk**",
            f"**Enabled:** {'🟢 yes' if settings['enabled'] else '🔴 no'}",
            (
                "**Service:** 🟢 Groq / Whisper"
                if self._has_key
                else (
                    "**Service:** ⚠️ none — the owner must set a key with "
                    f"`{ctx.clean_prefix}set api groq api_key,<key>`"
                )
            ),
            (
                "**Output:** always English"
                if settings["translate_to_english"]
                else "**Output:** the language that was spoken"
            ),
            (
                f"**Automatic:** voice messages {'✅' if settings['auto_voice_messages'] else '❌'}"
                f" · audio files {'✅' if settings['auto_audio_files'] else '❌'}"
            ),
            (
                "**Channels:** everywhere"
                if not channels
                else "**Channels:** " + ", ".join(f"<#{cid}>" for cid in channels)
            ),
            budget_line,
        ]
        if settings["daily_limit"] > 0:
            lines.append(
                f"**Precinct cap:** {used_today} / {settings['daily_limit']} "
                "transcriptions today (on top of Groq's)"
            )
        lines.append(
            "**Longest recording:** "
            + (
                f"{format_duration(settings['max_duration_secs'])} — longer ones are skipped"
                if settings["max_duration_secs"] > 0
                else "no limit"
            )
        )
        deps_ok, deps_why = livevoice.live_voice_available()
        live_session = self.live_sessions.get(ctx.guild.id)
        if not deps_ok:
            lines.append(
                f"**Live voice:** ⚠️ unavailable — {deps_why}; voice memos and audio files still work"
            )
        elif live_session is not None:
            lines.append(f"**Live voice:** 🔴 recording <#{live_session.voice_channel.id}>")
        else:
            lines.append(
                "**Live voice:** not in a voice channel — "
                f"`{ctx.clean_prefix}transcribe join`"
            )
        diagnosis = livevoice.auto_join_diagnosis(
            settings,
            has_key=self._has_key,
            in_voice=live_session is not None,
            prefix=ctx.clean_prefix,
        )
        lines.append(f"**Auto-join:** {'🟢' if diagnosis['ok'] else '⚪'} {diagnosis['detail']}")
        pair_count = len({**livevoice.DEFAULT_VOICE_PAIRS, **(settings["voice_pairs"] or {})})
        lines.append(
            f"**Pairs:** {pair_count} declared — "
            f"`{ctx.clean_prefix}transcribe pairs` shows where every voice channel writes"
        )
        skipping = "**Skipping:** other bots " + (
            "✅ (music is ignored)"
            if settings["ignore_bots"]
            else "❌ (music IS transcribed)"
        )
        if ignored:
            skipping += " · " + ", ".join(f"<@{uid}>" for uid in ignored)
        lines.append(skipping)
        lines.append(
            "-# Live listening and the Audio (music) cog cannot use voice at the same time."
        )
        lines.append("")
        lines.append(
            f"Reply to a recording and run `{ctx.clean_prefix}transcribe now` "
            "to transcribe it on demand."
        )
        await ctx.send("\n".join(lines), allowed_mentions=discord.AllowedMentions.none())

    async def _find_recording(self, ctx: commands.Context) -> Optional[discord.Message]:
        """Find the recording the member means: the message they replied to,
        else the most recent message with audio in this channel."""
        reference = ctx.message.reference
        if reference and reference.message_id:
            try:
                return await ctx.channel.fetch_message(reference.message_id)
            except discord.HTTPException:
                return None
        try:
            async for candidate in ctx.channel.history(limit=25):
                if audio_attachments_of(candidate):
                    return candidate
        except discord.HTTPException:
            return None
        return None

    @transcribe.command(name="now", aliases=["this", "it"])
    async def transcribe_now(self, ctx: commands.Context) -> None:
        """Transcribe the recording you replied to (or the last one posted here)."""
        target = await self._find_recording(ctx)
        if target is None:
            await ctx.send(
                "🎙️ No recording found. Reply to the message with the audio and try again."
            )
            return
        async with ctx.typing():
            result = await self._transcribe_message(ctx.guild, target, manual=True)
        if not result["ok"]:
            reason = result["reason"]
            if reason == "failed":
                await ctx.send(
                    "🎙️ The transcription desk could not read that recording. "
                    f"({result.get('detail')})"
                )
            elif reason == "no-key":
                await ctx.send(
                    "🎙️ No transcription service is configured. The owner must set a "
                    f"Groq key with `{ctx.clean_prefix}set api groq api_key,<key>`."
                )
            elif reason in REFUSAL_TEXT:
                await ctx.send(f"🎙️ {REFUSAL_TEXT[reason](result.get('retry_after_ms', 0))}")
            else:
                await ctx.send(f"🎙️ {refusal_for(reason)}")
            return
        await ctx.reply(embed=result["embed"], allowed_mentions=discord.AllowedMentions.none())

    @transcribe.command(name="on")
    @checks.admin_or_permissions(manage_guild=True)
    async def transcribe_on(self, ctx: commands.Context) -> None:
        """Start transcribing voice memos automatically."""
        await self.config.guild(ctx.guild).enabled.set(True)
        await ctx.send("🎙️ The transcription desk is open.")

    @transcribe.command(name="off")
    @checks.admin_or_permissions(manage_guild=True)
    async def transcribe_off(self, ctx: commands.Context) -> None:
        """Stop transcribing automatically (the command still works)."""
        await self.config.guild(ctx.guild).enabled.set(False)
        await ctx.send(
            "🎙️ Automatic transcription is off. "
            f"`{ctx.clean_prefix}transcribe now` still works on request."
        )

    @transcribe.command(name="auto")
    @checks.admin_or_permissions(manage_guild=True)
    async def transcribe_auto(self, ctx: commands.Context, kind: str, state: bool) -> None:
        """Which attachments are transcribed without being asked.

        `kind` is `voice` (Discord voice messages) or `files` (attached audio).
        """
        kind = kind.lower()
        if kind not in ("voice", "files"):
            await ctx.send("🎙️ Pick one of `voice` or `files`.")
            return
        if kind == "voice":
            await self.config.guild(ctx.guild).auto_voice_messages.set(state)
            what = "Voice messages"
        else:
            await self.config.guild(ctx.guild).auto_audio_files.set(state)
            what = "Attached audio files"
        await ctx.send(
            f"🎙️ {what} are {'now' if state else 'no longer'} transcribed automatically."
        )

    @transcribe.command(name="english")
    @checks.admin_or_permissions(manage_guild=True)
    async def transcribe_english(self, ctx: commands.Context, state: bool) -> None:
        """Always translate to English, or keep the spoken language."""
        await self.config.guild(ctx.guild).translate_to_english.set(state)
        await ctx.send(
            "🎙️ Statements are written in **English**, whatever was spoken."
            if state
            else "🎙️ Statements are written in the **language that was spoken**."
        )

    @transcribe.command(name="channel")
    @checks.admin_or_permissions(manage_guild=True)
    async def transcribe_channel(
        self, ctx: commands.Context, channel: discord.TextChannel
    ) -> None:
        """Transcribe only in these channels — run it per channel to add or remove."""
        async with self.config.guild(ctx.guild).channel_ids() as channel_ids:
            removed = channel.id in channel_ids
            if removed:
                channel_ids.remove(channel.id)
            else:
                channel_ids.append(channel.id)
            remaining = list(channel_ids)
        if removed:
            note = (
                " The list is empty, so the desk covers **every** channel again."
                if not remaining
                else ""
            )
            content = f"🎙️ {channel.mention} is no longer covered.{note}"
        else:
            mentions = ", ".join(f"<#{cid}>" for cid in remaining)
            content = f"🎙️ {channel.mention} added — the desk now covers **only** {mentions}."
        await ctx.send(content, allowed_mentions=discord.AllowedMentions.none())

    @transcribe.command(name="everywhere")
    @checks.admin_or_permissions(manage_guild=True)
    async def transcribe_everywhere(self, ctx: commands.Context) -> None:
        """Cover every channel again (clears the channel list)."""
        await self.config.guild(ctx.guild).channel_ids.set([])
        await ctx.send("🎙️ The desk covers **every** channel again.")

    @transcribe.command(name="limit")
    @checks.admin_or_permissions(manage_guild=True)
    async def transcribe_limit(
        self, ctx: commands.Context, what: str, value: commands.Range[int, 0, 10_000]
    ) -> None:
        """Caps: `duration` in SECONDS per recording, `daily` a COUNT of transcriptions."""
        what = what.lower()
        if what == "duration":
            await self.config.guild(ctx.guild).max_duration_secs.set(value)
            await ctx.send(
                "🎙️ Recordings of any length are accepted."
                if value == 0
                else (
                    f"🎙️ Recordings longer than **{format_duration(value)}** ({value} seconds) "
                    "are skipped. Everything shorter is transcribed as usual."
                )
            )
        elif what == "daily":
            await self.config.guild(ctx.guild).daily_limit.set(value)
            await ctx.send(
                "🎙️ No daily transcription limit."
                if value == 0
                else (
                    f"🎙️ At most **{value} transcriptions per day** — not minutes, not "
                    f"messages: {value} pieces of audio actually turned into text, counted "
                    "across the whole server and reset at midnight UTC."
                )
            )
        else:
            await ctx.send("🎙️ Pick one of `duration` or `daily`.")

    @transcribe.command(name="ignore")
    @checks.admin_or_permissions(manage_guild=True)
    async def transcribe_ignore(self, ctx: commands.Context, member: discord.Member) -> None:
        """Never transcribe this member. Run it again to undo."""
        async with self.config.guild(ctx.guild).ignored_user_ids() as ignored:
            removed = member.id in ignored
            if removed:
                ignored.remove(member.id)
            else:
                ignored.append(member.id)
        await ctx.send(
            f"🎙️ {member.mention} is transcribed again."
            if removed
            else f"🎙️ {member.mention} is never transcribed. Run it again to undo.",
            allowed_mentions=discord.AllowedMentions.none(),
        )

    # ── Live-voice commands (port of the Node subcommands) ──────────────────

    async def _live_deps_ok(self, ctx: commands.Context) -> bool:
        ok, why = livevoice.live_voice_available()
        if not ok:
            await ctx.send(
                f"🎙️ Live voice is unavailable: {why}. "
                "Voice memos and audio files still work."
            )
        return ok

    @transcribe.command(name="join", aliases=["listen"])
    @checks.admin_or_permissions(manage_guild=True)
    async def transcribe_join(self, ctx: commands.Context) -> None:
        """Join your voice channel and write down what is said."""
        if not await self._live_deps_ok(ctx):
            return
        voice_state = ctx.author.voice
        voice_channel = voice_state.channel if voice_state else None
        if voice_channel is None:
            await ctx.send("🎙️ Join a voice channel first, then run this there.")
            return
        session = self.live_sessions.get(ctx.guild.id)
        if session is not None:
            await ctx.send(
                f"🎙️ Already recording <#{session.voice_channel.id}>. "
                f"`{ctx.clean_prefix}transcribe leave` first."
            )
            return
        if not await self._api_key():
            await ctx.send(
                "🎙️ No transcription service is configured. The owner must set a "
                f"Groq key with `{ctx.clean_prefix}set api groq api_key,<key>`."
            )
            return
        perms = voice_channel.permissions_for(ctx.guild.me)
        if not perms.connect:
            await ctx.send(
                f"🎙️ I am not allowed to connect to {voice_channel.mention}.",
                allowed_mentions=discord.AllowedMentions.none(),
            )
            return
        if not self._voice_slot_free(ctx.guild):
            await ctx.send(
                "🎙️ The DJ booth is occupied — another cog (probably Audio) is using "
                "this server's voice connection. Live listening and music cannot use "
                "voice at the same time; stop the music first."
            )
            return

        async with ctx.typing():
            result = await self._start_live(ctx.guild, voice_channel, ctx.channel, "declared")
        if not result["ok"]:
            await ctx.send(
                "🎙️ I could not connect to that voice channel."
                if result["reason"] == "join-failed"
                else "🎙️ I am already listening somewhere."
            )
            return
        # Say it out loud, in the channel, unprompted: the bot is recording
        # people, and everyone within earshot is entitled to know that
        # without having to run a command to find out.
        translate = await self.config.guild(ctx.guild).translate_to_english()
        await ctx.send(
            f"🔴 **Recording {voice_channel.mention}.** Everything said there will be "
            f"transcribed into this channel{' in English' if translate else ''}. "
            f"`{ctx.clean_prefix}transcribe leave` stops it.",
            allowed_mentions=discord.AllowedMentions.none(),
        )

    @transcribe.command(name="leave", aliases=["stop"])
    @checks.admin_or_permissions(manage_guild=True)
    async def transcribe_leave(self, ctx: commands.Context) -> None:
        """Leave the voice channel and stop transcribing it."""
        if not await self._stop_live(ctx.guild.id):
            await ctx.send("🎙️ I am not in a voice channel here.")
            return
        await ctx.send("🎙️ Left the channel. Recording stopped.")

    @transcribe.command(name="autojoin", aliases=["follow"])
    @checks.admin_or_permissions(manage_guild=True)
    async def transcribe_autojoin(self, ctx: commands.Context, state: bool) -> None:
        """Join a voice channel by myself when somebody is in it."""
        await self.config.guild(ctx.guild).auto_join.set(state)
        await ctx.send(
            "🎙️ I will join a voice channel on my own and write into the text channel "
            "with the same name."
            if state
            else (
                "🎙️ I will stay out unless somebody runs "
                f"`{ctx.clean_prefix}transcribe join`."
            )
        )

    @transcribe.command(name="voicechannel", aliases=["vc"])
    @checks.admin_or_permissions(manage_guild=True)
    async def transcribe_voicechannel(
        self,
        ctx: commands.Context,
        channel: Union[discord.VoiceChannel, discord.StageChannel],
    ) -> None:
        """Auto-join only these voice channels — run it per channel to add or remove."""
        async with self.config.guild(ctx.guild).voice_channel_ids() as channel_ids:
            removed = channel.id in channel_ids
            if removed:
                channel_ids.remove(channel.id)
            else:
                channel_ids.append(channel.id)
            remaining = list(channel_ids)
        if removed:
            note = (
                " The list is empty, so I auto-join **every** voice channel again."
                if not remaining
                else ""
            )
            content = f"🎙️ {channel.mention} dropped.{note}"
        else:
            mentions = ", ".join(f"<#{cid}>" for cid in remaining)
            content = f"🎙️ {channel.mention} added — I now auto-join **only** {mentions}."
        await ctx.send(content, allowed_mentions=discord.AllowedMentions.none())

    @transcribe.command(name="pair")
    @checks.admin_or_permissions(manage_guild=True)
    async def transcribe_pair(
        self,
        ctx: commands.Context,
        voice: Union[discord.VoiceChannel, discord.StageChannel],
        text: Optional[discord.TextChannel] = None,
    ) -> None:
        """Say which text channel goes with a voice channel (omit text to unpair)."""
        async with self.config.guild(ctx.guild).voice_pairs() as pairs:
            if text is None:
                # Unpairing restores the DEFAULT for that channel rather than
                # nothing — an explicit blank would be a third state nobody wants.
                pairs.pop(str(voice.id), None)
            else:
                pairs[str(voice.id)] = str(text.id)
        if text is None:
            await ctx.send(
                f"🎙️ {voice.mention} is back to the built-in pairing (or the name match).",
                allowed_mentions=discord.AllowedMentions.none(),
            )
        else:
            await ctx.send(
                f"🎙️ {voice.mention} → {text.mention}. That beats any name match.",
                allowed_mentions=discord.AllowedMentions.none(),
            )

    @transcribe.command(name="unpair")
    @checks.admin_or_permissions(manage_guild=True)
    async def transcribe_unpair(self, ctx: commands.Context, voice: str) -> None:
        """Remove a voice → text pairing (accepts a deleted channel's id too)."""
        # A STRING, not a channel: a pairing whose voice channel has been
        # deleted is exactly the one you most want to remove, and a channel
        # arg cannot resolve a channel that is gone.
        match = re.match(r"^<#(\d+)>$", voice) or re.match(r"^(\d{15,21})$", voice)
        if not match:
            await ctx.send("🎙️ Give me a voice channel (#mention) or its raw id.")
            return
        channel_id = match.group(1)

        async with self.config.guild(ctx.guild).voice_pairs() as pairs:
            had_override = channel_id in pairs
            pairs.pop(channel_id, None)

        # Removing a guild override falls back to the committed default, so
        # saying "removed" without that caveat would be wrong for the four
        # pairings the owner gave in S111.
        falls_back_to = livevoice.DEFAULT_VOICE_PAIRS.get(channel_id)
        where = (
            f"back to its built-in pairing with <#{falls_back_to}>"
            if falls_back_to
            else "back to matching by name"
        )
        if had_override:
            content = f"🎙️ Override removed — <#{channel_id}> goes {where}."
        elif falls_back_to:
            content = (
                f"🎙️ <#{channel_id}> has no override to remove; it uses the built-in "
                f"pairing with <#{falls_back_to}>. Point it somewhere else with "
                f"`{ctx.clean_prefix}transcribe pair`."
            )
        else:
            content = f"🎙️ Nothing stored for `{channel_id}` — it was already matched by name."
        await ctx.send(content, allowed_mentions=discord.AllowedMentions.none())

    @transcribe.command(name="pairs", aliases=["list", "where"])
    async def transcribe_pairs(self, ctx: commands.Context) -> None:
        """Where every voice channel's transcript goes, and why."""
        # S118: this used to list only the STORED pairings, which answers
        # "what is configured" and not "where does each channel write".
        guild_pairs = await self.config.guild(ctx.guild).voice_pairs()
        pairs = {**livevoice.DEFAULT_VOICE_PAIRS, **(guild_pairs or {})}
        voices = [
            {"id": str(c.id), "name": c.name, "parent_id": str(c.category_id) if c.category_id else None}
            for c in list(ctx.guild.voice_channels) + list(ctx.guild.stage_channels)
        ]
        texts = [
            {"id": str(c.id), "name": c.name, "parent_id": str(c.category_id) if c.category_id else None}
            for c in ctx.guild.text_channels
        ]

        described = livevoice.describe_pairings(voices, texts, pairs, guild_pairs or {})
        rows, orphans = described["rows"], described["orphans"]

        lines = []
        for row in rows:
            target = (
                f"<#{row['text_id']}>"
                if row["text_id"]
                else f"🔊 {row['voice_name']}'s own chat"
            )
            marks = [livevoice.HOW_LABEL[row["how"]]]
            if row["overridden"]:
                marks.append("this server")
            if row["stale_target"]:
                marks.append(f"⚠️ paired to `{row['stale_target']}`, which no longer exists")
            lines.append(f"<#{row['voice_id']}> → {target}\n-# {' · '.join(marks)}")

        if orphans:
            lines.append(
                "\n⚠️ **Pairings for voice channels that no longer exist** — "
                f"`{ctx.clean_prefix}transcribe unpair <id>` clears one:"
            )
            lines.extend(
                f"-# `{o['voice_id']}` → <#{o['text_id']}>"
                + (" *(built-in default)*" if o["from_default"] else "")
                for o in orphans
            )

        if not rows:
            await ctx.send("🎙️ This server has no voice channels.")
            return
        header = "🎙️ **Where each voice channel writes**\n"
        for post in livevoice.pack_lines([header] + lines):
            await ctx.send(post, allowed_mentions=discord.AllowedMentions.none())

    @transcribe.command(name="timestamps")
    @checks.admin_or_permissions(manage_guild=True)
    async def transcribe_timestamps(self, ctx: commands.Context, state: bool) -> None:
        """Prefix each live-voice line with the time it was said."""
        await self.config.guild(ctx.guild).voice_timestamps.set(state)
        await ctx.send(
            "🎙️ Live transcript lines carry a time stamp (shown in each reader's own timezone)."
            if state
            else "🎙️ Live transcript lines are just **name:** and the words."
        )

    @transcribe.command(name="bots")
    @checks.admin_or_permissions(manage_guild=True)
    async def transcribe_bots(self, ctx: commands.Context, state: bool) -> None:
        """Transcribe other bots too — off by default, which is what skips music."""
        await self.config.guild(ctx.guild).ignore_bots.set(not state)
        await ctx.send(
            "🎙️ Other bots **are** transcribed now — a music bot in the channel will be "
            "written down as lyrics, and it spends the daily budget."
            if state
            else "🎙️ Other bots are skipped. Music playing through a bot is ignored."
        )

    @transcribe.command(name="migratecuff")
    @checks.is_owner()
    async def transcribe_migratecuff(
        self, ctx: commands.Context, mode: str = "preview"
    ) -> None:
        """Migrate settings from the legacy CuffBot data file.

        `preview` (default) shows what would change; `apply` writes it.
        Live-voice settings (auto-join, pairings, timestamps, bot skipping)
        migrate too.
        """
        mode = mode.lower()
        if mode not in ("preview", "apply"):
            await ctx.send("🎙️ Pick one of `preview` or `apply`.")
            return

        path = CUFFBOT_DATA_DIR / f"{ctx.guild.id}.json"
        if not path.is_file():
            await ctx.send(f"🎙️ No legacy data file found at `{path}`.")
            return
        try:
            legacy = json.loads(path.read_text(encoding="utf-8"))
        except (OSError, json.JSONDecodeError) as error:
            await ctx.send(f"🎙️ Could not read the legacy data file: {error}")
            return

        stored = legacy.get("transcribeConfig") or {}
        if not isinstance(stored, dict) or not stored:
            await ctx.send("🎙️ The legacy file has no stored `transcribeConfig` to migrate.")
            return

        key_map = {
            "enabled": ("enabled", bool),
            "channelIds": ("channel_ids", lambda v: [int(x) for x in v]),
            "autoVoiceMessages": ("auto_voice_messages", bool),
            "autoAudioFiles": ("auto_audio_files", bool),
            "translateToEnglish": ("translate_to_english", bool),
            "maxDurationSecs": ("max_duration_secs", int),
            "dailyLimit": ("daily_limit", int),
            "ignoredUserIds": ("ignored_user_ids", lambda v: [int(x) for x in v]),
            # Live voice migrates too, now that Red supports it.
            "voiceTimestamps": ("voice_timestamps", bool),
            "autoJoin": ("auto_join", bool),
            "voiceChannelIds": ("voice_channel_ids", lambda v: [int(x) for x in v]),
            "autoJoinMinimum": ("auto_join_minimum", int),
            "voicePairs": (
                "voice_pairs",
                lambda v: {str(key): str(val) for key, val in dict(v).items()},
            ),
            "ignoreBots": ("ignore_bots", bool),
        }
        changes: Dict[str, Any] = {}
        skipped: List[str] = []
        for legacy_key, value in stored.items():
            if legacy_key in key_map:
                red_key, convert = key_map[legacy_key]
                try:
                    changes[red_key] = convert(value)
                except (TypeError, ValueError):
                    skipped.append(f"`{legacy_key}` (unreadable value)")
            else:
                skipped.append(f"`{legacy_key}` (no matching setting on Red)")

        lines = ["🎙️ **Legacy CuffBot migration**"]
        if changes:
            lines.append("Will set:" if mode == "preview" else "Set:")
            lines.extend(f"- `{key}` → `{value}`" for key, value in changes.items())
        else:
            lines.append("Nothing to migrate — no stored keys map to this cog.")
        if skipped:
            lines.append("Skipped: " + ", ".join(skipped))

        if mode == "apply" and changes:
            group = self.config.guild(ctx.guild)
            for red_key, value in changes.items():
                await group.get_attr(red_key).set(value)
        elif changes:
            lines.append(f"Run `{ctx.clean_prefix}transcribe migratecuff apply` to write these.")

        await ctx.send("\n".join(lines), allowed_mentions=discord.AllowedMentions.none())
