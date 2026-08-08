"""CuffChatStarter — revive a quiet channel with an open question.

Port of the CuffBot Node module ``src/modules/chat-starter``. When the watched
channel has been silent for long enough, the bot posts an open-ended question
to get the precinct talking again. Questions come from a 40-entry bank, or —
optionally — from the detective's AI provider with the bank as fallback.

Three rules carried over verbatim from the Node module, because each one exists
for a reason:

* **The bot never monologues.** After a starter, at least one *human* message
  must appear before the next one is allowed. Other bots reset the idle clock
  (their messages are visible activity) but do not re-arm the starter.
* **The idle clock survives a restart.** At boot the last message in the
  channel is read, so "12 hours of silence" is measured from the real last
  message rather than from whenever the Pi rebooted.
* **The AI path shares the detective's budget.** Free tiers cap requests per
  day; an unmetered side channel would quietly eat the budget members spend on
  ``[p]ai``. A refused slot just falls back to the list — a member's question
  outranks an ice-breaker.
"""

import asyncio
import json
import logging
import random
import sys
import time
from pathlib import Path
from typing import Any, Dict, Optional

import discord
from discord.ext import tasks
from redbot.core import Config, checks, commands
from redbot.core.bot import Red
from redbot.core.data_manager import bundled_data_path

from .starter import (
    DEFAULT_CHANNEL_ID,
    DEFAULT_IDLE_MINUTES,
    IDLE_MAX,
    IDLE_MIN,
    new_activity,
    pick_question_index,
    remember_index,
    should_post,
    validate_questions,
)

log = logging.getLogger("red.cuff-cogs.cuffchatstarter")

LIVE_NODE_JSON = "/home/brand/CuffBot/data/411157175948541954.json"

EMBED_COLOR = 0x5DADE2
SUCCESS_COLOR = 0x57F287
ERROR_COLOR = 0xED4245

SWEEP_MINUTES = 5
TEST_DELAY_S = 30

#: The posted line. The Node module's wording, kept.
STARTER_TEMPLATE = "💬 **Radio check, precinct!** {question}"

AI_SYSTEM = "You write single ice-breaker questions for community chats."
AI_PROMPT = (
    "Write exactly ONE short, open-ended conversation-starter question for a friendly "
    "police-themed Discord community. English, one sentence, no preamble, no quotes, no "
    "emoji spam. It must be a question anyone can answer regardless of background."
)
#: The tiny prompt plus the detective's reserved output allowance.
AI_TOKEN_ESTIMATE = 550


class CuffChatStarter(commands.Cog):
    """Revives a quiet channel with an open-ended question."""

    __version__ = "1.1.0"
    __author__ = "Brandjuh"

    def format_help_for_context(self, ctx: commands.Context) -> str:
        pre_processed = super().format_help_for_context(ctx)
        return f"{pre_processed}\nCog Version: {self.__version__}\nAuthor: {self.__author__}"

    def __init__(self, bot: Red):
        self.bot = bot
        self.config = Config.get_conf(self, identifier=411157175015, force_registration=True)
        self.config.register_guild(
            enabled=True,
            channel_id=DEFAULT_CHANNEL_ID,
            idle_minutes=DEFAULT_IDLE_MINUTES,
            #: True in the live Node config — the AI writes the question, with
            #: the bank as fallback whenever there is no provider or no budget.
            use_ai=True,
            #: Indexes of the last few questions, so they do not repeat.
            recent_indexes=[],
        )
        #: channel id -> {last_activity_at, human_since_starter}. RAM only: a
        #: restart re-seeds from the channel's real history instead.
        self.activity: Dict[int, Dict[str, Any]] = {}
        self._bank: Optional[list] = None
        self._test_tasks: set = set()
        #: guild id -> why the last sweep posted nothing. Every bail below is a
        #: plain `return False`, which made "it just never posts" impossible to
        #: tell apart from "the channel is simply busy". Kept for the status
        #: embed, and logged once whenever the reason changes.
        self._last_reason: Dict[int, str] = {}
        self._startup = asyncio.create_task(self._start())

    async def _start(self):
        await self.bot.wait_until_red_ready()
        for guild in self.bot.guilds:
            try:
                await self.seed_from_history(guild)
            except Exception:
                log.warning("Chat starter: boot seed failed for %s", guild.id, exc_info=True)
        self.sweep_loop.start()

    def cog_unload(self):
        self.sweep_loop.cancel()
        if self._startup is not None:
            self._startup.cancel()
        for task in list(self._test_tasks):
            task.cancel()

    async def red_delete_data_for_user(self, **kwargs):
        """Nothing to delete — only channel activity timestamps, in RAM."""
        return

    # ------------------------------------------------------------------
    # Question bank
    # ------------------------------------------------------------------

    def question_bank(self, force: bool = False) -> list:
        """The bundled bank, validated. An unusable bank yields [] loudly."""
        if self._bank is not None and not force:
            return self._bank
        try:
            path = Path(bundled_data_path(self)) / "questions.json"
            doc = json.loads(path.read_text(encoding="utf-8"))
            ok, error = validate_questions(doc)
            if not ok:
                raise ValueError(error)
            self._bank = list(doc["questions"])
        except Exception as error:
            log.warning("Chat starter: question bank unusable (%s)", error)
            self._bank = []
        return self._bank

    async def ai_question(self) -> Optional[str]:
        """A question from the detective's provider, or None on any trouble.

        Deliberately borrows the CuffDetective cog rather than opening its own
        connection: sharing one rate limiter is the point — see the module
        docstring. Any missing piece just means the list is used.
        """
        detective = self.bot.get_cog("CuffDetective")
        if detective is None:
            return None
        limiter = getattr(detective, "limiter", None)
        complete = getattr(detective, "_complete", None)
        if limiter is None or complete is None:
            log.debug("Chat starter: detective present but has no usable AI seam")
            return None
        # Read the caps off the detective's own module so this stays in step
        # with whatever provider it is configured for, instead of hard-coding
        # a second copy of the numbers here.
        detective_module = sys.modules.get(type(detective).__module__)
        try:
            verdict = limiter.take(
                tokens=AI_TOKEN_ESTIMATE,
                max_per_day=getattr(detective_module, "DAILY_LIMIT", 14_400),
                tpm=getattr(detective_module, "TPM", None),
                tpd=getattr(detective_module, "TPD", None),
            )
            if not getattr(verdict, "ok", False):
                return None
            raw = await complete(
                [
                    {"role": "system", "content": AI_SYSTEM},
                    {"role": "user", "content": AI_PROMPT},
                ]
            )
        except Exception as error:
            log.warning("Chat starter: AI question failed (%s) — using the list", error)
            return None
        line = str(raw or "").strip().split("\n")[0].strip()
        # A one-word answer or an essay is a failed generation, not a question.
        if not line or len(line) < 10 or len(line) > 300:
            return None
        return line

    async def next_question(self, guild: discord.Guild) -> Optional[str]:
        """The question to post: AI when configured and available, else the list."""
        conf = await self.config.guild(guild).all()
        if conf["use_ai"]:
            generated = await self.ai_question()
            if generated:
                return generated
        bank = self.question_bank()
        if not bank:
            return None
        index = pick_question_index(len(bank), conf["recent_indexes"], random)
        await self.config.guild(guild).recent_indexes.set(
            remember_index(conf["recent_indexes"], index)
        )
        return bank[index]

    # ------------------------------------------------------------------
    # Activity tracking
    # ------------------------------------------------------------------

    @staticmethod
    def now_ms() -> float:
        return time.time() * 1000

    def note_activity(self, channel_id: int, *, human: bool) -> None:
        entry = self.activity.get(channel_id) or new_activity(self.now_ms())
        entry["last_activity_at"] = self.now_ms()
        if human:
            entry["human_since_starter"] = True
        self.activity[channel_id] = entry

    def activity_for(self, channel_id: int) -> Dict[str, Any]:
        """The record for this channel, created on first sight.

        A missing record means we have only just started watching, so "now" is
        treated as the last activity and the first starter is allowed.
        """
        if channel_id not in self.activity:
            self.activity[channel_id] = new_activity(self.now_ms())
        return self.activity[channel_id]

    def mark_posted(self, channel_id: int) -> None:
        self.activity[channel_id] = {
            "last_activity_at": self.now_ms(),
            "human_since_starter": False,
        }

    async def seed_from_history(self, guild: discord.Guild) -> bool:
        """Seed the idle clock from the channel's real last message.

        Without this, every restart resets the silence counter and a channel
        that has been dead all night would need another 12 hours.
        """
        conf = await self.config.guild(guild).all()
        channel_id = conf["channel_id"]
        if not channel_id:
            return False
        channel = guild.get_channel(int(channel_id))
        if not isinstance(channel, (discord.TextChannel, discord.Thread)):
            return False
        if not channel.permissions_for(guild.me).read_message_history:
            return False
        try:
            last = await anext(aiter(channel.history(limit=1)), None)
        except (discord.Forbidden, discord.HTTPException):
            return False
        if last is None:
            return False
        self.activity[int(channel_id)] = {
            "last_activity_at": last.created_at.timestamp() * 1000,
            # Our own starter as the last message keeps the guard armed-off.
            "human_since_starter": last.author.id != self.bot.user.id,
        }
        return True

    @commands.Cog.listener()
    async def on_message(self, message: discord.Message):
        if message.guild is None:
            return
        try:
            conf = await self.config.guild(message.guild).all()
            if not conf["channel_id"] or message.channel.id != int(conf["channel_id"]):
                return
            # Our own starter must not count as fresh conversation.
            if self.bot.user is not None and message.author.id == self.bot.user.id:
                return
            self.note_activity(message.channel.id, human=not message.author.bot)
        except Exception:
            log.warning("Chat starter: activity tracking failed", exc_info=True)

    # ------------------------------------------------------------------
    # Posting
    # ------------------------------------------------------------------

    def note_reason(self, guild_id: int, reason: str) -> None:
        """Remember why nothing was posted, and log it the first time.

        The sweep runs every few minutes; logging every pass would bury the
        rest of the log, so only a *change* of reason is worth a line.
        """
        if self._last_reason.get(guild_id) != reason:
            self._last_reason[guild_id] = reason
            if reason not in ("", "not-idle-enough", "no-human-since-last-starter"):
                log.warning("Chat starter: nothing posted in %s — %s", guild_id, reason)

    async def post_starter(self, guild: discord.Guild) -> bool:
        """Post one starter right now — no idle or guard checks, callers decide."""
        conf = await self.config.guild(guild).all()
        channel = guild.get_channel(int(conf["channel_id"])) if conf["channel_id"] else None
        if not isinstance(channel, (discord.TextChannel, discord.Thread)):
            # The usual cause of a starter that never appears: the configured
            # channel was deleted, or the bot cannot see it.
            self.note_reason(guild.id, f"channel {conf['channel_id']} not found")
            return False
        if not channel.permissions_for(guild.me).send_messages:
            self.note_reason(guild.id, f"no Send Messages in #{channel.name}")
            return False
        question = await self.next_question(guild)
        if not question:
            self.note_reason(guild.id, "no question available (AI and bank both empty)")
            return False
        try:
            await channel.send(
                STARTER_TEMPLATE.format(question=question),
                allowed_mentions=discord.AllowedMentions.none(),
            )
        except discord.HTTPException as error:
            log.warning("Chat starter: post failed: %s", error)
            self.note_reason(guild.id, f"send refused: {error}")
            return False
        self.note_reason(guild.id, "")
        self.mark_posted(channel.id)
        return True

    async def sweep(self, guild: discord.Guild) -> bool:
        conf = await self.config.guild(guild).all()
        if not conf["enabled"]:
            self.note_reason(guild.id, "disabled")
            return False
        if not conf["channel_id"]:
            self.note_reason(guild.id, "no channel set")
            return False
        if await self.bot.cog_disabled_in_guild(self, guild):
            self.note_reason(guild.id, "cog disabled in this guild")
            return False
        entry = self.activity_for(int(conf["channel_id"]))
        post, reason = should_post(
            enabled=conf["enabled"],
            channel_id=int(conf["channel_id"]),
            idle_minutes=int(conf["idle_minutes"]),
            idle_ms=self.now_ms() - entry["last_activity_at"],
            human_since_starter=entry["human_since_starter"],
        )
        if not post:
            self.note_reason(guild.id, reason)
            return False
        return await self.post_starter(guild)

    @tasks.loop(minutes=SWEEP_MINUTES)
    async def sweep_loop(self):
        for guild in list(self.bot.guilds):
            try:
                await self.sweep(guild)
            except Exception:
                log.warning("Chat starter: sweep failed in %s", guild.id, exc_info=True)

    @sweep_loop.before_loop
    async def _before_sweep(self):
        await self.bot.wait_until_red_ready()

    # ------------------------------------------------------------------
    # Commands
    # ------------------------------------------------------------------

    def embed(self, title: str, description: str = "", color: int = EMBED_COLOR) -> discord.Embed:
        return discord.Embed(color=color, title=title, description=description)

    async def ok(self, ctx: commands.Context, description: str, *, title: str = "✅ Done"):
        await ctx.send(
            embed=self.embed(title, description, SUCCESS_COLOR),
            allowed_mentions=discord.AllowedMentions.none(),
        )

    async def nope(self, ctx: commands.Context, description: str, *, title: str = "🚫 No"):
        await ctx.send(
            embed=self.embed(title, description, ERROR_COLOR),
            allowed_mentions=discord.AllowedMentions.none(),
        )

    @commands.guild_only()
    @checks.admin_or_permissions(manage_guild=True)
    @commands.group(
        name="chatstarter",
        aliases=["chat-starter", "chat-starter-config", "starter"],
        invoke_without_command=True,
    )
    async def chatstarter(self, ctx: commands.Context):
        """The chat starter: revives a quiet channel with an open question."""
        conf = await self.config.guild(ctx.guild).all()
        detective = self.bot.get_cog("CuffDetective")
        ai_ready = detective is not None and bool(await self.bot.get_shared_api_tokens("groq"))

        if conf["use_ai"]:
            source = (
                "AI (detective provider), list fallback"
                if ai_ready
                else "⚠️ AI requested but no provider — using the list"
            )
        else:
            source = f"list ({len(self.question_bank())} questions)"

        embed = self.embed(
            "💬 Chat Starter",
            "When the watched channel goes quiet for long enough, the precinct gets an "
            "open-ended question to talk about.",
        )
        embed.add_field(
            name="Enabled", value="🟢 yes" if conf["enabled"] else "🔴 no", inline=True
        )
        # A mention renders for any id, existing or not — resolve it, so a
        # channel that was deleted shows up as deleted instead of as a link.
        watched = ctx.guild.get_channel(int(conf["channel_id"])) if conf["channel_id"] else None
        if not conf["channel_id"]:
            channel_value = "⚠️ not set"
        elif watched is None:
            channel_value = f"⚠️ `{conf['channel_id']}` — no such channel here"
        elif not watched.permissions_for(ctx.guild.me).send_messages:
            channel_value = f"{watched.mention} ⚠️ I cannot send there"
        else:
            channel_value = watched.mention
        embed.add_field(name="Channel", value=channel_value, inline=True)
        hours = int(conf["idle_minutes"]) / 60
        embed.add_field(
            name="Idle threshold",
            value=f"**{conf['idle_minutes']}** min ({hours:g} h) of silence",
            inline=True,
        )
        embed.add_field(name="Question source", value=source, inline=False)

        if conf["channel_id"]:
            entry = self.activity_for(int(conf["channel_id"]))
            quiet_min = int((self.now_ms() - entry["last_activity_at"]) / 60_000)
            waiting = "✅ a human has spoken" if entry["human_since_starter"] else (
                "⏸️ waiting for a human — the bot never posts twice in a row"
            )
            blocked = self._last_reason.get(ctx.guild.id, "")
            explained = {
                "not-idle-enough": (
                    f"⏳ waiting — needs **{conf['idle_minutes']}** min of silence"
                ),
                "no-human-since-last-starter": (
                    "⏸️ waiting for a human — the bot never posts twice in a row"
                ),
                "disabled": "🔴 switched off",
                "no-channel": "⚠️ no channel set",
            }.get(blocked, f"⚠️ {blocked}" if blocked else "✅ ready to post")
            embed.add_field(
                name="Right now",
                value=f"Quiet for **{quiet_min}** min\n{waiting}\nLast sweep: {explained}",
                inline=False,
            )
        embed.add_field(
            name="Commands",
            value=(
                f"`{ctx.clean_prefix}chatstarter on` / `off`\n"
                f"`{ctx.clean_prefix}chatstarter channel #chan`\n"
                f"`{ctx.clean_prefix}chatstarter idle <{IDLE_MIN}-{IDLE_MAX}>`\n"
                f"`{ctx.clean_prefix}chatstarter ai <on|off>`\n"
                f"`{ctx.clean_prefix}chatstarter preview` — sample, posts nothing\n"
                f"`{ctx.clean_prefix}chatstarter test` — a real starter in ~{TEST_DELAY_S}s"
            ),
            inline=False,
        )
        await ctx.send(embed=embed)

    @chatstarter.command(name="on")
    async def chatstarter_on(self, ctx: commands.Context):
        """Turn the chat starter on."""
        await self.config.guild(ctx.guild).enabled.set(True)
        await self.ok(ctx, "The chat starter is **on**.", title="🟢 Chat starter on")

    @chatstarter.command(name="off")
    async def chatstarter_off(self, ctx: commands.Context):
        """Turn the chat starter off."""
        await self.config.guild(ctx.guild).enabled.set(False)
        await ctx.send(
            embed=self.embed("📴 Chat starter off", "No more ice-breakers will be posted.")
        )

    @chatstarter.command(name="channel")
    async def chatstarter_channel(self, ctx: commands.Context, channel: discord.TextChannel):
        """Channel to revive when it goes quiet."""
        await self.config.guild(ctx.guild).channel_id.set(channel.id)
        # The idle clock belongs to the channel, so start the new one fresh.
        self.activity.pop(channel.id, None)
        await self.seed_from_history(ctx.guild)
        note = ""
        if not channel.permissions_for(ctx.guild.me).send_messages:
            note = "\n\n⚠️ I cannot send messages there — nothing will be posted."
        await self.ok(
            ctx, f"The chat starter watches {channel.mention}.{note}", title="✅ Channel set"
        )

    @chatstarter.command(name="idle")
    async def chatstarter_idle(self, ctx: commands.Context, minutes: int):
        """Minutes of silence before a starter (15–1440)."""
        if not IDLE_MIN <= minutes <= IDLE_MAX:
            return await self.nope(
                ctx,
                f"The idle threshold must be **{IDLE_MIN}–{IDLE_MAX}** minutes.",
                title="🚫 Out of range",
            )
        await self.config.guild(ctx.guild).idle_minutes.set(minutes)
        await self.ok(
            ctx,
            f"A starter fires after **{minutes} minutes** ({minutes / 60:g} h) of silence.",
            title="✅ Idle threshold set",
        )

    @chatstarter.command(name="ai")
    async def chatstarter_ai(self, ctx: commands.Context, state: bool):
        """Generate questions via the detective (falls back to the list)."""
        await self.config.guild(ctx.guild).use_ai.set(state)
        if not state:
            return await self.ok(
                ctx,
                f"Questions come from the **list** ({len(self.question_bank())} of them).",
                title="✅ Source set",
            )
        detective = self.bot.get_cog("CuffDetective")
        note = ""
        if detective is None:
            note = "\n\n⚠️ CuffDetective is not loaded, so the list is used until it is."
        elif not await self.bot.get_shared_api_tokens("groq"):
            note = (
                "\n\n⚠️ No Groq key set (`"
                + ctx.clean_prefix
                + "set api groq api_key,<key>`), so the list is used until there is one."
            )
        await self.ok(
            ctx,
            "Questions come from the **AI**, with the list as fallback. It draws on the "
            "detective's shared daily budget, so a member's `" + ctx.clean_prefix + "ai` "
            "question always outranks an ice-breaker." + note,
            title="✅ Source set",
        )

    @chatstarter.command(name="preview")
    async def chatstarter_preview(self, ctx: commands.Context):
        """Show a sample question. Nothing is posted to the channel."""
        async with ctx.typing():
            sample = await self.next_question(ctx.guild)
        if not sample:
            return await self.nope(
                ctx, "The question bank is unavailable and the AI gave nothing.",
                title="🚫 No question",
            )
        await ctx.send(
            embed=self.embed("💬 Sample starter", STARTER_TEMPLATE.format(question=sample)),
            allowed_mentions=discord.AllowedMentions.none(),
        )

    @chatstarter.command(name="test")
    async def chatstarter_test(self, ctx: commands.Context):
        """Post a REAL starter in the configured channel in ~30 seconds."""
        conf = await self.config.guild(ctx.guild).all()
        if not conf["channel_id"]:
            return await self.nope(ctx, "No channel configured — nothing to arm.",
                                   title="⚠️ Not armed")

        async def shot():
            # The test bypasses the idle window and the monologue guard on
            # purpose: the owner sees the real thing without waiting 12 hours.
            try:
                await asyncio.sleep(TEST_DELAY_S)
                if not await self.post_starter(ctx.guild):
                    # Silence here used to look identical to success from where
                    # the owner was standing. Say what stopped it.
                    await self.nope(
                        ctx,
                        self._last_reason.get(ctx.guild.id) or "unknown reason",
                        title="🚫 Test starter not posted",
                    )
            except asyncio.CancelledError:
                raise
            except Exception:
                log.warning("Chat starter: test shot failed", exc_info=True)

        task = asyncio.create_task(shot())
        self._test_tasks.add(task)
        task.add_done_callback(self._test_tasks.discard)
        await ctx.send(
            embed=self.embed(
                "🧪 Test armed",
                f"A real starter hits <#{conf['channel_id']}> in ~**{TEST_DELAY_S} seconds**.",
            )
        )

    @chatstarter.command(name="migratecuff")
    @checks.is_owner()
    async def chatstarter_migratecuff(
        self, ctx: commands.Context, mode: str = "apply", path: str = LIVE_NODE_JSON
    ):
        """Migrate settings from the CuffBot Node data file (`preview` or `apply`)."""
        mode = mode.lower()
        if mode not in ("preview", "apply"):
            return await self.nope(
                ctx,
                f"Unknown mode `{mode}`. Use `preview` or `apply`.",
                title="🚫 Unknown mode",
            )
        try:
            data = json.loads(Path(path).read_text(encoding="utf-8"))
        except (OSError, ValueError) as error:
            return await self.nope(
                ctx, f"Could not read `{path}`:\n```\n{error}\n```", title="🚫 Migration failed"
            )

        node = data.get("chatStarterConfig")
        if not isinstance(node, dict):
            return await ctx.send(
                embed=self.embed("ℹ️ Nothing to migrate", "No `chatStarterConfig` in that file.")
            )

        changes: Dict[str, Any] = {}
        if "enabled" in node:
            changes["enabled"] = bool(node["enabled"])
        if node.get("channelId"):
            changes["channel_id"] = int(node["channelId"])
        if "idleMinutes" in node:
            changes["idle_minutes"] = max(IDLE_MIN, min(IDLE_MAX, int(node["idleMinutes"])))
        if "useAi" in node:
            changes["use_ai"] = bool(node["useAi"])

        summary = "\n".join(f"{key} = {value}" for key, value in changes.items())
        if mode == "preview":
            return await ctx.send(
                embed=self.embed(
                    "🔍 Chat starter migration preview",
                    f"Nothing written. Run with `apply` to commit.\n```\n{summary}\n```",
                )
            )
        group = self.config.guild(ctx.guild)
        for key, value in changes.items():
            await group.get_attr(key).set(value)
        await self.seed_from_history(ctx.guild)
        await self.ok(
            ctx, f"Migrated from `{path}`:\n```\n{summary}\n```", title="✅ Migration applied"
        )
