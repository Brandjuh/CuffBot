"""CuffDetective — the precinct's AI detective, ported from the Node CuffBot.

Ask with the detective command or by @mentioning the bot. One shared,
process-global rate budget for the whole precinct; over-budget questions
land on the "desk pile" and are answered automatically.
"""

import asyncio
import json
import logging
import re
import time
from pathlib import Path
from typing import Literal, Optional

import aiohttp
import discord
from discord.ext import tasks
from redbot.core import Config, checks, commands
from redbot.core.bot import Red

from .limiter import RateLimiter, estimate_tokens, human_wait

log = logging.getLogger("red.cuffcogs.cuffdetective")

NODE_DATA_DEFAULT = "/home/brand/CuffBot/data/411157175948541954.json"
NODE_ENV_DEFAULT = "/home/brand/CuffBot/.env"

GROQ_URL = "https://api.groq.com/openai/v1/chat/completions"
GROQ_MODEL = "llama-3.1-8b-instant"
PROVIDER_NAME = "groq"
DAILY_LIMIT = 14_400
TPM = 6_000
TPD = 500_000
REQUEST_TIMEOUT_S = 20

MAX_QUESTION_CHARS = 1000
MAX_HISTORY_ENTRIES = 8
HISTORY_TTL_MS = 1_800_000  # 30 min
MAX_REPLY_CHARS = 1900
MAX_HISTORY_TOKENS = 1200
MAX_OUTPUT_TOKENS = 400

QUEUE_CAP = 5
MAX_QUEUE_WAIT_MS = 3_600_000

PERSONA = (
    "You are CuffBot, the precinct detective of a police-themed Discord server "
    "called the precinct. Stay in light police flavor (detective, dispatch, "
    "precinct) without overdoing it. Answer in the language the user writes in "
    "(often Dutch or English). Be helpful, factual, and concise: a few "
    "sentences, at most ~150 words, no markdown headers. Never invent facts "
    "about server members; if asked for personal data, advice on wrongdoing, "
    "or anything hateful, decline briefly and in character. You cannot "
    "moderate, run commands, or change server settings — if asked, point to "
    "the relevant /command instead."
)

WAIT_STORIES = [
    "The detective is mid-interrogation — two suspects, one donut, tensions high.",
    "The detective is on a stakeout and the radio must stay silent. 🍩 binoculars out.",
    "The detective is buried under a mountain of paperwork from the last case.",
    "The detective is walking the K-9 — Rex refuses to fetch clues on an empty stomach.",
    "The detective is in the evidence locker looking for reading glasses… again.",
    "The detective is at the coffee machine. Some cases simply cannot start without it.",
]

EVERYONE_RE = re.compile(r"@(everyone|here)")

DEFAULT_GUILD = {
    "enabled": True,
    "channel_id": 412354971170897921,
}


def normalize_question(text: str) -> Optional[str]:
    text = (text or "").strip()
    if not text:
        return None
    if len(text) > MAX_QUESTION_CHARS:
        return text[: MAX_QUESTION_CHARS - 1] + "…"
    return text


def normalize_reply(text: str) -> str:
    text = (text or "").strip()
    text = EVERYONE_RE.sub("@​\\1", text)
    if not text:
        return "…the detective stares silently at the case board. (Empty reply — try again.)"
    if len(text) > MAX_REPLY_CHARS:
        return text[: MAX_REPLY_CHARS - 1] + "…"
    return text


class CuffDetective(commands.Cog):
    """Ask the precinct detective (AI) — command or @mention."""

    def __init__(self, bot: Red):
        super().__init__()
        self.bot = bot
        self.config = Config.get_conf(self, identifier=411157175002, force_registration=True)
        self.config.register_guild(**DEFAULT_GUILD)
        self.limiter = RateLimiter()
        self.history: dict[int, list[dict]] = {}  # channel_id -> [{role, content, at}]
        self.queue: list[dict] = []  # desk pile, RAM-only
        self._story_counter = 0
        self._session: Optional[aiohttp.ClientSession] = None
        self.queue_flusher.start()

    async def cog_load(self):
        self._session = aiohttp.ClientSession()

    async def cog_unload(self):
        self.queue_flusher.cancel()
        if self._session:
            await self._session.close()

    async def red_delete_data_for_user(
        self,
        *,
        requester: Literal["discord_deleted_user", "owner", "user", "user_strict"],
        user_id: int,
    ):
        # Only ephemeral RAM history exists; drop queue items for this user.
        self.queue = [q for q in self.queue if q["user_id"] != user_id]

    # --------------------------------------------------------------- #
    # Groq client                                                       #
    # --------------------------------------------------------------- #

    async def _api_key(self) -> Optional[str]:
        tokens = await self.bot.get_shared_api_tokens("groq")
        return tokens.get("api_key")

    async def _complete(self, messages: list[dict]) -> str:
        """Raises RuntimeError('http-429') on quota, other exceptions on failure."""
        key = await self._api_key()
        if not key:
            raise RuntimeError("no-key")
        body = {
            "model": GROQ_MODEL,
            "messages": [{"role": "system", "content": PERSONA}, *messages],
            "max_tokens": MAX_OUTPUT_TOKENS,
            "temperature": 0.7,
        }
        timeout = aiohttp.ClientTimeout(total=REQUEST_TIMEOUT_S)
        async with self._session.post(
            GROQ_URL,
            json=body,
            headers={"Authorization": f"Bearer {key}"},
            timeout=timeout,
        ) as resp:
            if resp.status == 429:
                raise RuntimeError("http-429")
            resp.raise_for_status()
            data = await resp.json()
        return data["choices"][0]["message"]["content"]

    # --------------------------------------------------------------- #
    # Conversation memory (RAM-only)                                    #
    # --------------------------------------------------------------- #

    def _prune_history(self, channel_id: int, now_ms: float):
        entries = self.history.get(channel_id, [])
        cutoff = now_ms - HISTORY_TTL_MS
        entries = [e for e in entries if e["at"] > cutoff][-MAX_HISTORY_ENTRIES:]
        self.history[channel_id] = entries
        return entries

    def _build_messages(self, channel_id: int, asker_name: str, question: str) -> list[dict]:
        now_ms = time.time() * 1000
        entries = list(self._prune_history(channel_id, now_ms))
        while entries and sum(estimate_tokens(e["content"]) for e in entries) > MAX_HISTORY_TOKENS:
            entries.pop(0)
        messages = [{"role": e["role"], "content": e["content"]} for e in entries]
        messages.append({"role": "user", "content": f"{asker_name}: {question}"})
        return messages

    def _remember(self, channel_id: int, asker_name: str, question: str, reply: str):
        now_ms = time.time() * 1000
        entries = self._prune_history(channel_id, now_ms)
        entries.append({"role": "user", "content": f"{asker_name}: {question}", "at": now_ms})
        entries.append({"role": "assistant", "content": reply, "at": now_ms})
        self.history[channel_id] = entries[-MAX_HISTORY_ENTRIES:]

    # --------------------------------------------------------------- #
    # Refusals & queue                                                  #
    # --------------------------------------------------------------- #

    def _refusal_text(self, reason: str, retry_ms: float) -> str:
        wait = human_wait(retry_ms)
        if reason == "cooldown":
            return (
                "📻 The radio is busy — one question per 7 seconds for the whole "
                f"precinct. Try again in {wait}."
            )
        if reason == "hourly":
            return (
                "📻 The precinct's hourly detective budget (62 questions) is spent. "
                f"New slot in ~{wait}."
            )
        if reason == "daily":
            return (
                f"📻 The precinct's DAILY detective budget ({DAILY_LIMIT} questions on "
                f"the free {PROVIDER_NAME} tier) is spent — the desk pile can't bridge "
                "a wait that long. Come back tomorrow, officer."
            )
        if reason == "tokens-minute":
            return (
                f"📻 The radio channel is saturated (the free {PROVIDER_NAME} tier's "
                f"token budget this minute). Try again in ~{wait}."
            )
        if reason == "tokens-day":
            return (
                f"📻 Today's token budget on the free {PROVIDER_NAME} tier is spent — "
                "the detective is out of ink. Come back tomorrow, officer."
            )
        return f"📻 The detective can't take the case right now. Try again in ~{wait}."

    def _should_queue(self, reason: str, retry_ms: float) -> bool:
        return reason not in ("daily", "tokens-day") and retry_ms <= MAX_QUEUE_WAIT_MS

    def _enqueue(self, user_id: int, channel_id: int, asker_name: str, question: str):
        for i, item in enumerate(self.queue):
            if item["user_id"] == user_id:
                # A newer question REPLACES the older; the position is kept.
                self.queue[i] = {**item, "question": question, "asker_name": asker_name}
                return i + 1
        if len(self.queue) >= QUEUE_CAP:
            return None
        self.queue.append(
            {
                "user_id": user_id,
                "channel_id": channel_id,
                "asker_name": asker_name,
                "question": question,
            }
        )
        return len(self.queue)

    def _parked_text(self, position: int, retry_ms: float) -> str:
        story = WAIT_STORIES[self._story_counter % len(WAIT_STORIES)]
        self._story_counter += 1
        return (
            f"🗂️ {story}\n"
            f"Your case is **#{position} on the desk pile** — no need to retype it, "
            f"I'll answer right here in ~{human_wait(retry_ms)}."
        )

    @tasks.loop(seconds=10)
    async def queue_flusher(self):
        """One parked answer per tick, faithful to the Node flusher."""
        if not self.queue:
            return
        item = self.queue[0]
        channel = self.bot.get_channel(item["channel_id"])
        if channel is None:
            self.queue.pop(0)
            return
        conf = await self.config.guild(channel.guild).all()
        if not conf["enabled"]:
            self.queue.pop(0)  # AI got disabled meanwhile: drop silently
            return
        tokens = estimate_tokens(PERSONA) + estimate_tokens(item["question"]) + MAX_OUTPUT_TOKENS
        verdict = self.limiter.take(
            tokens=tokens, max_per_day=DAILY_LIMIT, tpm=TPM, tpd=TPD
        )
        if not verdict.ok:
            return  # still throttled: the item stays at the head
        self.queue.pop(0)
        try:
            messages = self._build_messages(
                item["channel_id"], item["asker_name"], item["question"]
            )
            reply = normalize_reply(await self._complete(messages))
            self._remember(item["channel_id"], item["asker_name"], item["question"], reply)
            q = item["question"]
            q_short = q[:150] + ("…" if len(q) > 150 else "")
            await channel.send(
                f"🕵️ <@{item['user_id']}> Case reopened — you asked: “{q_short}”\n{reply}",
                allowed_mentions=discord.AllowedMentions(
                    users=[discord.Object(item["user_id"])]
                ),
            )
        except Exception:
            log.exception("Queue flush delivery failed")

    @queue_flusher.before_loop
    async def _before_flusher(self):
        await self.bot.wait_until_ready()

    # --------------------------------------------------------------- #
    # Asking                                                            #
    # --------------------------------------------------------------- #

    async def _handle_ask(
        self,
        channel: discord.TextChannel,
        author: discord.Member,
        raw_question: str,
        *,
        reply_to: Optional[discord.Message] = None,
    ):
        conf = await self.config.guild(channel.guild).all()
        if not conf["enabled"]:
            return
        question = normalize_question(raw_question)
        if question is None:
            await channel.send("🕵️ Ask me something, officer — I can't work an empty case file.")
            return
        if conf["channel_id"] and channel.id != conf["channel_id"]:
            await channel.send(
                f"🕵️ The detective only takes questions at his desk: "
                f"<#{conf['channel_id']}>. Ask me there!"
            )
            return
        if not await self._api_key():
            await channel.send(
                "🕵️ The detective has no radio license yet — a bot owner must run "
                "`[p]set api groq api_key,<key>` first."
            )
            return
        tokens = estimate_tokens(PERSONA) + estimate_tokens(question) + MAX_OUTPUT_TOKENS
        verdict = self.limiter.take(tokens=tokens, max_per_day=DAILY_LIMIT, tpm=TPM, tpd=TPD)
        if not verdict.ok:
            if self._should_queue(verdict.reason, verdict.retry_after_ms):
                position = self._enqueue(author.id, channel.id, author.display_name, question)
                if position is None:
                    await channel.send(
                        f"🗂️ The desk pile is FULL ({QUEUE_CAP} cases waiting) — the "
                        f"precinct is popular today. Try again in "
                        f"~{human_wait(verdict.retry_after_ms)}."
                    )
                else:
                    await channel.send(self._parked_text(position, verdict.retry_after_ms))
            else:
                await channel.send(self._refusal_text(verdict.reason, verdict.retry_after_ms))
            return
        try:
            async with channel.typing():
                messages = self._build_messages(channel.id, author.display_name, question)
                reply = normalize_reply(await self._complete(messages))
        except RuntimeError as exc:
            if str(exc) == "http-429":
                await channel.send(
                    f"📻 {PROVIDER_NAME}'s free-tier quota is tapped out for now (their "
                    "side, HTTP 429). It resets automatically — try again later."
                )
                return
            log.exception("Detective request failed")
            await channel.send("🕵️ The case went cold — something broke. Try again in a bit.")
            return
        except Exception:
            log.exception("Detective request failed")
            await channel.send("🕵️ The case went cold — something broke. Try again in a bit.")
            return
        self._remember(channel.id, author.display_name, question, reply)
        text = f"🕵️ {reply}"
        if reply_to is not None:
            await reply_to.reply(text, mention_author=True)
        else:
            await channel.send(text)

    @commands.command(name="detective", aliases=["vraag"])
    @commands.guild_only()
    async def detective(self, ctx: commands.Context, *, question: str):
        """Ask the precinct detective (AI)."""
        await self._handle_ask(ctx.channel, ctx.author, question)

    @commands.Cog.listener()
    async def on_message_without_command(self, message: discord.Message):
        """@mentioning the bot talks to the detective."""
        if message.author.bot or message.guild is None or message.is_system():
            return
        if message.mention_everyone:
            return
        if self.bot.user not in message.mentions:
            return
        # Require a DIRECT mention in the content (not just a reply ping).
        mention_forms = (f"<@{self.bot.user.id}>", f"<@!{self.bot.user.id}>")
        if not any(m in message.content for m in mention_forms):
            return
        ctx = await self.bot.get_context(message)
        if ctx.valid:
            return
        if await self.bot.cog_disabled_in_guild(self, message.guild):
            return
        if not await self.bot.ignored_channel_or_guild(ctx):
            return
        if not await self.bot.allowed_by_whitelist_blacklist(message.author):
            return
        conf = await self.config.guild(message.guild).all()
        if not conf["enabled"]:
            return
        stripped = message.content
        for form in (*mention_forms, f"<@&{self.bot.user.id}>"):
            stripped = stripped.replace(form, " ")
        stripped = re.sub(r"\s+", " ", stripped).strip()
        if conf["channel_id"] and message.channel.id != conf["channel_id"]:
            await message.reply(
                f"🕵️ You’ll find my desk in <#{conf['channel_id']}> — ask me there!",
                mention_author=True,
            )
            return
        await self._handle_ask(message.channel, message.author, stripped, reply_to=message)

    # --------------------------------------------------------------- #
    # Config                                                            #
    # --------------------------------------------------------------- #

    @commands.group(name="ai", aliases=["aiconfig"], invoke_without_command=True)
    @commands.guild_only()
    @checks.admin_or_permissions(manage_guild=True)
    async def ai(self, ctx: commands.Context):
        """AI detective status and configuration."""
        conf = await self.config.guild(ctx.guild).all()
        key_set = bool(await self._api_key())
        channel = f"<#{conf['channel_id']}>" if conf["channel_id"] else "everywhere"
        lines = [
            f"Enabled: **{conf['enabled']}**, desk: {channel}",
            f"Provider: **{PROVIDER_NAME}** (`{GROQ_MODEL}`), key configured: **{key_set}**",
            f"Rate limits: 1/7 s precinct-wide, {self.limiter.max_per_hour}/hour, "
            f"{DAILY_LIMIT}/day, {TPM} tokens/min, {TPD} tokens/day",
            f"Used: **{self.limiter.used_last_hour()}** this hour, "
            f"**{self.limiter.used_last_day()}** today",
            f"Desk pile: **{len(self.queue)}/{QUEUE_CAP}** cases waiting",
            f"Memory: last {MAX_HISTORY_ENTRIES} entries per channel, "
            f"{HISTORY_TTL_MS // 60_000} min TTL",
        ]
        await ctx.send("\n".join(lines))

    @ai.command(name="on")
    async def ai_on(self, ctx: commands.Context):
        """Put the detective on duty."""
        await self.config.guild(ctx.guild).enabled.set(True)
        await ctx.tick()

    @ai.command(name="off")
    async def ai_off(self, ctx: commands.Context):
        """Take the detective off duty."""
        await self.config.guild(ctx.guild).enabled.set(False)
        await ctx.tick()

    @ai.command(name="channel")
    async def ai_channel(self, ctx: commands.Context, channel: discord.TextChannel):
        """The ONLY channel where the detective takes questions."""
        await self.config.guild(ctx.guild).channel_id.set(channel.id)
        await ctx.tick()

    @ai.command(name="everywhere")
    async def ai_everywhere(self, ctx: commands.Context):
        """Lift the channel restriction."""
        await self.config.guild(ctx.guild).channel_id.set(None)
        await ctx.tick()

    @ai.command(name="migratecuff", hidden=True)
    @checks.is_owner()
    async def ai_migratecuff(
        self, ctx: commands.Context, mode: str = "apply", path: str = NODE_DATA_DEFAULT
    ):
        """Migrate AI config from the Node CuffBot; also imports the Groq key from its .env."""
        preview = mode.lower() == "preview"
        try:
            data = json.loads(Path(path).read_text())
        except (OSError, json.JSONDecodeError) as exc:
            await ctx.send(f"Could not read the Node data file: `{exc}`")
            return
        ai_conf = data.get("aiConfig") or {}
        writes = {}
        if "enabled" in ai_conf:
            writes["enabled"] = bool(ai_conf["enabled"])
        if "channelId" in ai_conf:
            writes["channel_id"] = int(ai_conf["channelId"]) if ai_conf["channelId"] else None
        # Groq key from the Node .env (value is never echoed).
        env_key = None
        env_path = Path(NODE_ENV_DEFAULT)
        if env_path.exists():
            for line in env_path.read_text().splitlines():
                if line.strip().startswith("GROQ_API_KEY="):
                    env_key = line.split("=", 1)[1].strip().strip('"').strip("'")
                    break
        already_set = bool(await self._api_key())
        report = [
            f"Config keys to write: {sorted(writes) or 'none (all defaults)'}",
            f"Groq key found in Node .env: {bool(env_key)} "
            f"(Red key already set: {already_set})",
        ]
        if preview:
            await ctx.send("\n".join(f"[preview] {line}" for line in report))
            return
        for key, value in writes.items():
            await self.config.guild(ctx.guild).set_raw(key, value=value)
        if env_key and not already_set:
            await self.bot.set_shared_api_tokens("groq", api_key=env_key)
            report.append("Groq key imported into Red's shared API tokens.")
        await ctx.send("Migrated: " + "; ".join(report))
