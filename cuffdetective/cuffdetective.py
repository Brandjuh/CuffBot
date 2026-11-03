"""CuffDetective — the precinct's AI detective, ported from the Node CuffBot.

Ask with the detective command or by @mentioning the bot. One shared,
process-global rate budget for the whole precinct; over-budget questions
land on the "desk pile" and are answered automatically.

Admins feed its long-term memory by posting in the case-file channel: posting
adds a fact, editing changes it and deleting forgets it. The channel itself is
the storage, so there is nothing to keep in sync.
"""

import asyncio
import json
import logging
import re
import time
from collections import deque
from pathlib import Path
from typing import Literal, Optional

import aiohttp
import discord
from discord.ext import tasks
from redbot.core import Config, checks, commands
from redbot.core.bot import Red
from redbot.core.utils.chat_formatting import pagify

from .limiter import RateLimiter, estimate_tokens, human_wait

log = logging.getLogger("red.cuffcogs.cuffdetective")

NODE_DATA_DEFAULT = "/home/brand/CuffBot/data/411157175948541954.json"
NODE_ENV_DEFAULT = "/home/brand/CuffBot/.env"

GROQ_URL = "https://api.groq.com/openai/v1/chat/completions"
GROQ_MODEL = "qwen/qwen3.8-27b"
PROVIDER_NAME = "groq"
DAILY_LIMIT = 1_000
TPM = 8_000
TPD = 200_000
REQUEST_TIMEOUT_S = 20

MAX_QUESTION_CHARS = 1000
MAX_HISTORY_ENTRIES = 40
HISTORY_TTL_MS = 86_400_000  # 24 h
DISCORD_MESSAGE_LIMIT = 2000
MAX_REPLY_CHARS = 1900
MAX_HISTORY_TOKENS = 2000
MAX_KNOWLEDGE_TOKENS = 1000  # sent with every question, so it spends the free budget
MAX_KNOWLEDGE_MESSAGES = 200
MAX_OUTPUT_TOKENS = 550  # roughly MAX_REPLY_CHARS; the model overshoots what it is told

QUEUE_CAP = 5
MAX_QUEUE_WAIT_MS = 3_600_000

PERSONA = (
    "You are CuffBot, the wisecracking precinct detective of a police-themed "
    "Discord server called the precinct. Be funny: dry one-liners, mock-serious "
    "case talk and gentle roasts are your style, but the actual answer must "
    "still be right and come through clearly. Always answer in English. Give as "
    "much detail as the question deserves, but never more than 250 words because "
    "Discord cuts off longer messages. No markdown headers. Never invent facts "
    "about this server, its members, rules or commands: if the case file does "
    "not cover it, say you have no intel on it and make a joke of that instead. "
    "If asked for personal data, advice on wrongdoing, or anything hateful, "
    "decline briefly and in character. You cannot moderate, run commands, or "
    "change server settings."
)

WAIT_STORIES = [
    "The detective is mid-interrogation — two suspects, one donut, tensions high.",
    "The detective is on a stakeout and the radio must stay silent. 🍩 binoculars out.",
    "The detective is buried under a mountain of paperwork from the last case.",
    "The detective is walking the K-9 — Rex refuses to fetch clues on an empty stomach.",
    "The detective is in the evidence locker looking for reading glasses… again.",
    "The detective is at the coffee machine. Some cases simply cannot start without it.",
]

KNOWLEDGE_HEADER = (
    "The precinct's case file, written by the server's admins. These are facts "
    "about this server; rely on them when they are relevant:"
)
KNOWLEDGE_ADDED_EMOJI = "🧠"
KNOWLEDGE_FULL_EMOJI = "⚠️"

EVERYONE_RE = re.compile(r"@(everyone|here)")

DEFAULT_GUILD = {
    "enabled": True,
    "channel_id": 412354971170897921,
    "knowledge_channel_id": 1567248111028412426,
}


def normalize_question(text: str) -> Optional[str]:
    text = (text or "").strip()
    if not text:
        return None
    if len(text) > MAX_QUESTION_CHARS:
        return text[: MAX_QUESTION_CHARS - 1] + "…"
    return text


def fit_text(text: str, limit: int) -> str:
    """Cut to ``limit`` on the last finished sentence, if one ends in the second half."""
    if len(text) <= limit:
        return text
    cut = text[: limit - 1]
    end = max(cut.rfind(mark) for mark in (". ", "! ", "? ", ".\n", "!\n", "?\n"))
    if end >= limit // 2:
        return cut[: end + 1] + " …"
    return cut + "…"


def normalize_reply(text: str) -> str:
    text = (text or "").strip()
    text = EVERYONE_RE.sub("@​\\1", text)
    if not text:
        return "…the detective stares silently at the case board. (Empty reply — try again.)"
    return fit_text(text, MAX_REPLY_CHARS)


class CuffDetective(commands.Cog):
    """Ask the precinct detective (AI) — command or @mention."""

    def __init__(self, bot: Red):
        super().__init__()
        self.bot = bot
        self.config = Config.get_conf(self, identifier=411157175002, force_registration=True)
        self.config.register_guild(**DEFAULT_GUILD)
        self.limiter = RateLimiter()
        self.history: dict[int, list[dict]] = {}  # channel_id -> [{role, content, at}]
        #: Message ids of answers we posted, so replying to one is recognised
        #: as a follow-up. RAM-only and bounded; after a restart the emoji
        #: fallback in _is_followup takes over.
        self._answer_ids: deque = deque(maxlen=500)
        self.queue: list[dict] = []  # desk pile, RAM-only
        #: guild_id -> {"entries": [(message_id, text)], "skipped": [message_id],
        #: "tokens": int, "error": Optional[str]}. A copy of the case-file
        #: channel, re-read after any change there.
        self._knowledge: dict[int, dict] = {}
        self._knowledge_dirty: set[int] = set()
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
    # Case file (admin-fed long-term memory)                            #
    # --------------------------------------------------------------- #

    async def _is_knowledge_admin(self, member: discord.Member) -> bool:
        """Same bar as the ``ai`` config commands."""
        return member.guild_permissions.manage_guild or await self.bot.is_admin(member)

    async def _knowledge_author(
        self, guild: discord.Guild, message: discord.Message
    ) -> Optional[discord.Member]:
        member = guild.get_member(message.author.id)
        if member is not None:
            return member
        try:
            return await guild.fetch_member(message.author.id)
        except discord.HTTPException:
            return None  # left the server: their entries lapse with them

    async def _is_knowledge_entry(self, guild: discord.Guild, message: discord.Message) -> bool:
        if message.author.bot or message.is_system() or not message.clean_content.strip():
            return False
        member = await self._knowledge_author(guild, message)
        if member is None or not await self._is_knowledge_admin(member):
            return False
        return not (await self.bot.get_context(message)).valid

    async def _refresh_knowledge(self, guild: discord.Guild) -> dict:
        """Re-read the case-file channel if it changed since the last read.

        Oldest entries win when the file is full, so a new post can never
        silently push out an established fact: it gets the warning reaction.
        """
        current = self._knowledge.get(guild.id)
        if current is not None and guild.id not in self._knowledge_dirty:
            return current
        # Cleared first: a change that lands during the read marks it dirty again.
        self._knowledge_dirty.discard(guild.id)
        state = {"entries": [], "skipped": [], "tokens": 0, "error": None}
        channel_id = await self.config.guild(guild).knowledge_channel_id()
        if channel_id:
            channel = guild.get_channel(channel_id)
            try:
                if channel is None:
                    raise LookupError(f"channel {channel_id} is not visible to the bot")
                async for message in channel.history(
                    limit=MAX_KNOWLEDGE_MESSAGES, oldest_first=True
                ):
                    if not await self._is_knowledge_entry(guild, message):
                        continue
                    text = message.clean_content.strip()
                    cost = estimate_tokens(text)
                    if state["tokens"] + cost > MAX_KNOWLEDGE_TOKENS:
                        state["skipped"].append(message.id)
                        continue
                    state["entries"].append((message.id, text))
                    state["tokens"] += cost
            except (discord.HTTPException, LookupError) as exc:
                log.warning("Could not read the case file: %s", exc)
                # Keep what we know, and try again on the next question.
                self._knowledge_dirty.add(guild.id)
                state = {**(current or state), "error": str(exc)}
        self._knowledge[guild.id] = state
        return state

    def _knowledge_message(self, guild_id: int) -> list[dict]:
        state = self._knowledge.get(guild_id)
        if not state or not state["entries"]:
            return []
        lines = "\n".join(f"- {text}" for _, text in state["entries"])
        return [{"role": "system", "content": f"{KNOWLEDGE_HEADER}\n{lines}"}]

    async def _mark_knowledge_changed(self, guild_id: Optional[int], channel_id: int) -> None:
        if guild_id is None:
            return
        if channel_id == await self.config.guild_from_id(guild_id).knowledge_channel_id():
            self._knowledge_dirty.add(guild_id)

    @commands.Cog.listener("on_message_without_command")
    async def _on_knowledge_post(self, message: discord.Message):
        if message.guild is None:
            return
        guild = message.guild
        if message.channel.id != await self.config.guild(guild).knowledge_channel_id():
            return
        self._knowledge_dirty.add(guild.id)
        state = await self._refresh_knowledge(guild)
        if any(entry_id == message.id for entry_id, _ in state["entries"]):
            emoji = KNOWLEDGE_ADDED_EMOJI
        elif message.id in state["skipped"]:
            emoji = KNOWLEDGE_FULL_EMOJI
        else:
            return
        try:
            await message.add_reaction(emoji)
        except discord.HTTPException:
            pass

    @commands.Cog.listener()
    async def on_raw_message_edit(self, payload: discord.RawMessageUpdateEvent):
        await self._mark_knowledge_changed(payload.guild_id, payload.channel_id)

    @commands.Cog.listener()
    async def on_raw_message_delete(self, payload: discord.RawMessageDeleteEvent):
        await self._mark_knowledge_changed(payload.guild_id, payload.channel_id)

    @commands.Cog.listener()
    async def on_raw_bulk_message_delete(self, payload: discord.RawBulkMessageDeleteEvent):
        await self._mark_knowledge_changed(payload.guild_id, payload.channel_id)

    # --------------------------------------------------------------- #
    # Conversation memory (RAM-only)                                    #
    # --------------------------------------------------------------- #

    def _prune_history(self, channel_id: int, now_ms: float):
        entries = self.history.get(channel_id, [])
        cutoff = now_ms - HISTORY_TTL_MS
        entries = [e for e in entries if e["at"] > cutoff][-MAX_HISTORY_ENTRIES:]
        self.history[channel_id] = entries
        return entries

    def _build_messages(
        self, guild_id: int, channel_id: int, asker_name: str, question: str
    ) -> list[dict]:
        now_ms = time.time() * 1000
        entries = list(self._prune_history(channel_id, now_ms))
        while entries and sum(estimate_tokens(e["content"]) for e in entries) > MAX_HISTORY_TOKENS:
            entries.pop(0)
        messages = self._knowledge_message(guild_id)
        messages.extend({"role": e["role"], "content": e["content"]} for e in entries)
        messages.append({"role": "user", "content": f"{asker_name}: {question}"})
        return messages

    def _request_tokens(self, guild_id: int, channel_id: int, question: str) -> int:
        """Prompt, case file, remembered conversation and the reserved reply, as Groq counts them."""
        messages = self._build_messages(guild_id, channel_id, "", question)
        return (
            estimate_tokens(PERSONA)
            + sum(estimate_tokens(m["content"]) for m in messages)
            + MAX_OUTPUT_TOKENS
        )

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
        await self._refresh_knowledge(channel.guild)
        tokens = self._request_tokens(channel.guild.id, item["channel_id"], item["question"])
        verdict = self.limiter.take(
            tokens=tokens, max_per_day=DAILY_LIMIT, tpm=TPM, tpd=TPD
        )
        if not verdict.ok:
            return  # still throttled: the item stays at the head
        self.queue.pop(0)
        try:
            messages = self._build_messages(
                channel.guild.id, item["channel_id"], item["asker_name"], item["question"]
            )
            reply = normalize_reply(await self._complete(messages))
            self._remember(item["channel_id"], item["asker_name"], item["question"], reply)
            q = item["question"]
            q_short = q[:150] + ("…" if len(q) > 150 else "")
            header = f"🕵️ <@{item['user_id']}> Case reopened — you asked: “{q_short}”\n"
            sent = await channel.send(
                header + fit_text(reply, DISCORD_MESSAGE_LIMIT - len(header)),
                allowed_mentions=discord.AllowedMentions(
                    users=[discord.Object(item["user_id"])]
                ),
            )
            # A parked answer is an answer: replying to it continues the case.
            self._track_answer(sent)
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
        await self._refresh_knowledge(channel.guild)
        tokens = self._request_tokens(channel.guild.id, channel.id, question)
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
                messages = self._build_messages(
                    channel.guild.id, channel.id, author.display_name, question
                )
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
            sent = await reply_to.reply(text, mention_author=True)
        else:
            sent = await channel.send(text)
        # Remember it so a reply to this answer continues the conversation.
        self._track_answer(sent)

    @commands.command(name="detective", aliases=["vraag"])
    @commands.guild_only()
    async def detective(self, ctx: commands.Context, *, question: str):
        """Ask the precinct detective (AI)."""
        await self._handle_ask(ctx.channel, ctx.author, question)

    def _track_answer(self, message: Optional[discord.Message]) -> None:
        if message is not None:
            self._answer_ids.append(message.id)

    def _is_followup(self, message: discord.Message) -> bool:
        """Is this a reply to one of the detective's own answers?

        Checked by message id first, which needs no cache and no API call.
        After a restart that list is empty, so fall back to "the bot wrote it
        and it opens with the detective's badge" — which is every answer this
        cog posts, and none of the birthday or starter messages.
        """
        reference = message.reference
        if reference is None or self.bot.user is None:
            return False
        if reference.message_id and reference.message_id in self._answer_ids:
            return True
        target = (
            reference.resolved
            if isinstance(reference.resolved, discord.Message)
            else reference.cached_message
        )
        if target is None:
            return False
        return target.author.id == self.bot.user.id and target.content.startswith("🕵️")

    @commands.Cog.listener()
    async def on_message_without_command(self, message: discord.Message):
        """@mentioning the bot — or replying to its answer — talks to the detective."""
        if message.author.bot or message.guild is None or message.is_system():
            return
        if message.mention_everyone:
            return

        mention_forms = (f"<@{self.bot.user.id}>", f"<@!{self.bot.user.id}>")
        # A DIRECT mention means the id appears in the text. Discord does not
        # put it there for a reply, and a reply with the ping switched off does
        # not even land in message.mentions — so replies need their own check
        # or the conversation dies after the detective's first answer.
        direct_mention = self.bot.user in message.mentions and any(
            form in message.content for form in mention_forms
        )
        followup = self._is_followup(message)
        if not (direct_mention or followup):
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
        if not conf["enabled"] or message.channel.id == conf["knowledge_channel_id"]:
            return
        stripped = message.content
        for form in (*mention_forms, f"<@&{self.bot.user.id}>"):
            stripped = stripped.replace(form, " ")
        stripped = re.sub(r"\s+", " ", stripped).strip()
        # An empty follow-up is a sticker, an image or a "lol" reply — not a
        # question. Say nothing rather than nag; a bare @mention still gets the
        # "ask me something" prompt, because that one was aimed at the desk.
        if followup and not direct_mention and not stripped:
            return
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
        case_file = await self._refresh_knowledge(ctx.guild)
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
            f"Case file: **{len(case_file['entries'])}** entries, "
            f"~{case_file['tokens']}/{MAX_KNOWLEDGE_TOKENS} tokens — details: `{ctx.clean_prefix}ai memory`",
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

    @ai.command(name="memory")
    async def ai_memory(self, ctx: commands.Context):
        """Show what the detective has in its case file."""
        channel_id = await self.config.guild(ctx.guild).knowledge_channel_id()
        if not channel_id:
            await ctx.send(f"No case-file channel set. Use `{ctx.clean_prefix}ai memorychannel`.")
            return
        self._knowledge_dirty.add(ctx.guild.id)
        state = await self._refresh_knowledge(ctx.guild)
        link = f"https://discord.com/channels/{ctx.guild.id}/{channel_id}"
        lines = [
            f"Case file: <#{channel_id}> — **{len(state['entries'])}** entries, "
            f"~{state['tokens']}/{MAX_KNOWLEDGE_TOKENS} tokens"
        ]
        if state["error"]:
            lines.append(f"⚠️ Could not read the channel: {state['error']}")
        for entry_id, text in state["entries"]:
            short = " ".join(text.split())
            short = short[:80] + ("…" if len(short) > 80 else "")
            lines.append(f"{KNOWLEDGE_ADDED_EMOJI} {link}/{entry_id} {short}")
        for entry_id in state["skipped"]:
            lines.append(f"{KNOWLEDGE_FULL_EMOJI} did not fit: {link}/{entry_id}")
        for page in pagify("\n".join(lines)):
            await ctx.send(page, allowed_mentions=discord.AllowedMentions.none())

    @ai.command(name="memorychannel")
    async def ai_memorychannel(self, ctx: commands.Context, channel: discord.TextChannel):
        """The channel whose admin posts feed the detective's case file."""
        await self.config.guild(ctx.guild).knowledge_channel_id.set(channel.id)
        self._knowledge_dirty.add(ctx.guild.id)
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
