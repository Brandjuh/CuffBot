"""The Enigmic cog: Discord commands, views wiring, and persistence.

Gameplay logic lives in the pure modules (:mod:`.game`, :mod:`.solver`,
:mod:`.validator`, :mod:`.renderer`); this module glues them to Red's
command framework, Config storage, and Discord interactions.
"""

from __future__ import annotations

import asyncio
import io
import json
import logging
import random
import uuid
from datetime import datetime, timedelta, timezone
from typing import Callable, Iterable
from zoneinfo import ZoneInfo, ZoneInfoNotFoundError

import discord
from redbot.core import Config, commands
from redbot.core.bot import Red
from redbot.core.data_manager import bundled_data_path
from redbot.core.utils.chat_formatting import box, humanize_timedelta, pagify

from . import game as game_logic
from .constants import (
    CLEANUP_INTERVAL_SECONDS,
    CONFIG_IDENTIFIER,
    DEFAULT_HINT_LIMIT,
    DEFAULT_TIMEOUT_MINUTES,
    DEFAULT_TIMEZONE,
    GAME_SCHEMA_VERSION,
    MAX_IMPORT_FILE_SIZE,
    SUBMIT_COOLDOWN_SECONDS,
    Difficulty,
    FeedbackMode,
    GameMode,
    GameStatus,
    Role,
)
from .constraints import CaseGeometry
from .converters import resolve_character
from .coordinates import format_coordinate, parse_coordinate
from .errors import (
    AmbiguousCharacter,
    CaseNotFound,
    EnigmicError,
    InvalidCoordinate,
    InvalidMove,
)
from .models import ActiveGame, Case, iter_case_files, load_case_file
from .renderer import clear_background_cache, render_board_png
from .validator import validate_case_dict
from .views import (
    ConfirmView,
    CoordinateModal,
    EnigmicGameView,
    NextCaseView,
)

log = logging.getLogger("red.cuffbotred.enigmic")

RULES_TEXT = (
    "**How to play Enigmic**\n"
    "1. Place every suspect and the victim on the board.\n"
    "2. Every character is used exactly once.\n"
    "3. Every row contains exactly one character.\n"
    "4. Every column contains exactly one character.\n"
    "5. Characters cannot stand on blocked furniture or objects.\n"
    "6. Every clue must be true.\n"
    "7. \"Beside\" means directly up, down, left, or right.\n"
    "8. Diagonal positions are not beside each other.\n"
    "9. A wall blocks \"beside\".\n"
    "10. Rooms may contain any number of characters.\n"
    "11. After solving the board, the only suspect alone with the victim in "
    "the same room is the murderer.\n"
    "12. X marks and character notes are optional player notes - they never "
    "affect the real rules.\n"
    "13. Submit checks the complete arrangement.\n\n"
    "**Coordinates**: the column letter comes first, then the row number. "
    "`A1` is the top-left cell; on a 4x4 board `D4` is the bottom-right cell."
)


def _now() -> datetime:
    return datetime.now(timezone.utc)


def _now_iso() -> str:
    return _now().isoformat()


def _parse_iso(text: str) -> datetime | None:
    try:
        parsed = datetime.fromisoformat(text)
    except (TypeError, ValueError):
        return None
    if parsed.tzinfo is None:
        parsed = parsed.replace(tzinfo=timezone.utc)
    return parsed


def _format_seconds(seconds: float) -> str:
    return humanize_timedelta(seconds=max(0, int(seconds))) or "0 seconds"


class Enigmic(commands.Cog):
    """An original murder-mystery deduction puzzle.

    Place every suspect and the victim on the crime-scene grid so that all
    clues hold, then unmask the murderer - the only suspect alone with the
    victim in the same room.
    """

    def __init__(self, bot: Red) -> None:
        self.bot = bot
        self.config = Config.get_conf(
            self, identifier=CONFIG_IDENTIFIER, force_registration=True
        )
        self.config.register_global(schema_version=GAME_SCHEMA_VERSION)
        self.config.register_guild(
            enabled=True,
            allowed_channels=[],
            hints_enabled=True,
            hint_limit=DEFAULT_HINT_LIMIT,
            hint_autoplace=False,
            hint_details=False,
            feedback_mode=FeedbackMode.COUNT.value,
            game_timeout_minutes=DEFAULT_TIMEOUT_MINUTES,
            timezone=DEFAULT_TIMEZONE,
            daily_enabled=True,
            custom_cases={},
            disabled_case_ids=[],
            daily_records={},
        )
        self.config.register_member(
            active_game=None,
            completed_cases={},
            recent_case_ids=[],
        )
        self.config.register_user(
            total_started=0,
            total_completed=0,
            total_abandoned=0,
            total_hints=0,
            total_wrong_submissions=0,
            total_time_seconds=0.0,
            best_times={},
            daily_records={},
            daily_current_streak=0,
            daily_longest_streak=0,
            daily_last_date="",
        )

        self._bundled_cases: dict[str, Case] = {}
        self._custom_case_cache: dict[tuple[int, str], Case] = {}
        self._geometries: dict[str, CaseGeometry] = {}
        self._games: dict[tuple[int, int], ActiveGame] = {}
        self._locks: dict[tuple[int, int], asyncio.Lock] = {}
        self._registered_views: dict[str, EnigmicGameView] = {}
        self._cleanup_task: asyncio.Task | None = None

    # ------------------------------------------------------------------ #
    # Lifecycle
    # ------------------------------------------------------------------ #

    async def cog_load(self) -> None:
        await self._load_bundled_cases()
        await self._run_migrations()
        await self._hydrate_active_games()
        self._cleanup_task = asyncio.create_task(self._cleanup_loop())

    async def cog_unload(self) -> None:
        if self._cleanup_task is not None:
            self._cleanup_task.cancel()
            self._cleanup_task = None
        for view in self._registered_views.values():
            view.stop()
        self._registered_views.clear()

    async def _load_bundled_cases(self) -> None:
        cases_dir = bundled_data_path(self) / "cases"
        loaded: dict[str, Case] = {}
        for path in iter_case_files(cases_dir):
            try:
                case = await asyncio.to_thread(load_case_file, path)
            except EnigmicError as exc:
                log.error("Skipping bundled case %s: %s", path.name, exc)
                continue
            loaded[case.id] = case
        self._bundled_cases = loaded
        log.info("Loaded %d bundled cases.", len(loaded))

    async def _run_migrations(self) -> None:
        try:
            version = int(await self.config.schema_version() or 0)
        except (TypeError, ValueError):
            log.warning("Stored schema_version is unreadable; treating it as 0.")
            version = 0
        if version > GAME_SCHEMA_VERSION:
            log.warning(
                "Stored schema version %s is newer than this cog understands "
                "(%s); data is left untouched.",
                version,
                GAME_SCHEMA_VERSION,
            )
            return
        # Future migrations chain from `version` to GAME_SCHEMA_VERSION here.
        if version != GAME_SCHEMA_VERSION:
            await self.config.schema_version.set(GAME_SCHEMA_VERSION)

    async def _hydrate_active_games(self) -> None:
        all_members = await self.config.all_members()
        restored = 0
        for guild_id, members in all_members.items():
            for user_id, data in members.items():
                raw = data.get("active_game")
                if not raw:
                    continue
                try:
                    game = ActiveGame.from_dict(raw)
                except Exception as exc:
                    # Any corruption shape must be survivable: one bad row
                    # must never stop the cog from loading for everyone else.
                    log.warning(
                        "Dropping unreadable game for user %s in guild %s: %s",
                        user_id, guild_id, exc,
                    )
                    await self.config.member_from_ids(
                        guild_id, user_id
                    ).active_game.set(None)
                    continue
                if game.status is not GameStatus.ACTIVE:
                    await self.config.member_from_ids(
                        guild_id, user_id
                    ).active_game.set(None)
                    continue
                try:
                    case = await self._get_case(guild_id, game.case_id)
                except CaseNotFound:
                    log.warning(
                        "Active game for user %s references missing case %s; "
                        "clearing it.", user_id, game.case_id,
                    )
                    await self.config.member_from_ids(
                        guild_id, user_id
                    ).active_game.set(None)
                    continue
                self._games[(guild_id, user_id)] = game
                self._register_view(game, case)
                restored += 1
        if restored:
            log.info("Restored %d active games.", restored)

    async def _cleanup_loop(self) -> None:
        try:
            await self.bot.wait_until_red_ready()
            while True:
                try:
                    await self._cleanup_once()
                except asyncio.CancelledError:
                    raise
                except Exception:
                    log.exception("Error during the periodic game cleanup.")
                await asyncio.sleep(CLEANUP_INTERVAL_SECONDS)
        except asyncio.CancelledError:
            pass

    async def _cleanup_once(self) -> None:
        now = _now()
        for key, game in list(self._games.items()):
            guild_id, user_id = key
            timeout_minutes = await self.config.guild_from_id(
                guild_id
            ).game_timeout_minutes()
            if timeout_minutes <= 0:
                continue
            last = _parse_iso(game.last_action_at) or _parse_iso(game.started_at)
            # A game whose timestamps are unreadable falls through to the
            # locked branch below, which repairs them instead of skipping.
            if last is not None and now - last < timedelta(minutes=timeout_minutes):
                continue
            async with self._lock_for(key):
                # Re-verify under the lock: the player may have acted (or the
                # game may have ended / been replaced) while we waited.
                if self._games.get(key) is not game:
                    continue
                if game.status is not GameStatus.ACTIVE:
                    continue
                last = _parse_iso(game.last_action_at) or _parse_iso(game.started_at)
                if last is None:
                    # Unreadable timestamps would otherwise make a game
                    # immortal; stamp it now so the normal timeout applies.
                    game.last_action_at = _now_iso()
                    await self._save_game(game)
                    continue
                if now - last < timedelta(minutes=timeout_minutes):
                    continue
                log.info(
                    "Expiring inactive game %s (player %s, guild %s).",
                    game.game_id, user_id, guild_id,
                )
                game.status = GameStatus.EXPIRED
                await self._record_game_end(game, completed=False)
                await self._discard_game(game, note="This case expired due to inactivity.")

    # ------------------------------------------------------------------ #
    # Data deletion (Red user-data API)
    # ------------------------------------------------------------------ #

    async def red_delete_data_for_user(
        self, *, requester: str, user_id: int
    ) -> None:
        """Delete all stored data for a user."""
        await self.config.user_from_id(user_id).clear()
        all_members = await self.config.all_members()
        for guild_id, members in all_members.items():
            if user_id in members:
                key = (guild_id, user_id)
                # Serialize against in-flight game writes so a concurrent
                # action cannot re-create the record we just deleted.
                async with self._lock_for(key):
                    game = self._games.pop(key, None)
                    if game is not None:
                        view = self._registered_views.pop(game.game_id, None)
                        if view is not None:
                            view.stop()
                    await self.config.member_from_ids(guild_id, user_id).clear()
        all_guilds = await self.config.all_guilds()
        for guild_id, data in all_guilds.items():
            records = data.get("daily_records") or {}
            user_key = str(user_id)
            if any(user_key in day for day in records.values()):
                async with self.config.guild_from_id(
                    guild_id
                ).daily_records() as stored:
                    for day in list(stored):
                        stored[day].pop(user_key, None)

    async def red_get_data_for_user(self, *, user_id: int) -> dict[str, io.BytesIO]:
        """Export the user's stored statistics as JSON."""
        data = {
            "user": await self.config.user_from_id(user_id).all(),
            "guilds": {},
        }
        all_members = await self.config.all_members()
        for guild_id, members in all_members.items():
            if user_id in members:
                data["guilds"][str(guild_id)] = members[user_id]
        payload = json.dumps(data, indent=2).encode("utf-8")
        return {"enigmic.json": io.BytesIO(payload)}

    # ------------------------------------------------------------------ #
    # Case access
    # ------------------------------------------------------------------ #

    async def _get_case(self, guild_id: int, case_id: str) -> Case:
        case = self._bundled_cases.get(case_id)
        if case is not None:
            return case
        cached = self._custom_case_cache.get((guild_id, case_id))
        if cached is not None:
            return cached
        custom = await self.config.guild_from_id(guild_id).custom_cases()
        raw = custom.get(case_id)
        if raw is None:
            raise CaseNotFound(f"No case with ID '{case_id}' exists in this server.")
        try:
            case = Case.from_dict(raw)
        except EnigmicError as exc:
            raise CaseNotFound(
                f"The stored custom case '{case_id}' could not be loaded: {exc}"
            ) from exc
        self._custom_case_cache[(guild_id, case_id)] = case
        return case

    def _geometry(self, case: Case) -> CaseGeometry:
        # Keyed on content, not id: two guilds may define different custom
        # cases under the same ID, and a re-import may not bump the version.
        key = case.fingerprint
        geometry = self._geometries.get(key)
        if geometry is None:
            geometry = CaseGeometry.from_case(case)
            if len(self._geometries) > 64:
                self._geometries.pop(next(iter(self._geometries)))
            self._geometries[key] = geometry
        return geometry

    async def _available_case_ids(self, guild_id: int) -> list[str]:
        guild_conf = await self.config.guild_from_id(guild_id).all()
        disabled = set(guild_conf.get("disabled_case_ids") or [])
        ids = [cid for cid in self._bundled_cases if cid not in disabled]
        ids += [
            cid for cid in (guild_conf.get("custom_cases") or {})
            if cid not in disabled
        ]
        return ids

    async def _pick_case_for_player(
        self,
        guild_id: int,
        user_id: int,
        selector: str | None,
    ) -> Case:
        """Resolve a start argument: difficulty name, case ID, or automatic."""
        available = await self._available_case_ids(guild_id)
        if not available:
            raise CaseNotFound("No cases are available on this server.")

        if selector:
            difficulty = Difficulty.from_str(selector)
            if difficulty is not None:
                pool = []
                for cid in available:
                    case = await self._get_case(guild_id, cid)
                    if case.difficulty is difficulty:
                        pool.append(cid)
                if not pool:
                    raise CaseNotFound(
                        f"No {difficulty.value} cases are available on this server."
                    )
                return await self._pick_from_pool(guild_id, user_id, pool)
            if selector in available:
                return await self._get_case(guild_id, selector)
            raise CaseNotFound(
                f"'{selector}' is neither a difficulty (beginner/easy/normal/"
                f"hard/expert) nor an available case ID. "
                f"Use `enigmic cases` to list cases."
            )
        return await self._pick_from_pool(guild_id, user_id, available)

    async def _pick_from_pool(
        self, guild_id: int, user_id: int, pool: list[str]
    ) -> Case:
        # Read the leaves rather than the whole member group: `active_game`
        # is registered with a scalar default but stored as a dict, and Red's
        # default merging raises TypeError on such a group while a game exists.
        member_conf = self.config.member_from_ids(guild_id, user_id)
        completed = set(await member_conf.completed_cases() or {})
        recent = await member_conf.recent_case_ids() or []
        last_case = recent[-1] if recent else None

        unsolved = [cid for cid in pool if cid not in completed]
        candidates = unsolved or list(pool)

        # Prefer cases near the player's most recent difficulty.
        if recent:
            try:
                recent_case = await self._get_case(guild_id, last_case)
            except CaseNotFound:
                recent_case = None
            if recent_case is not None:
                same_difficulty = []
                for cid in candidates:
                    case = await self._get_case(guild_id, cid)
                    if case.difficulty is recent_case.difficulty:
                        same_difficulty.append(cid)
                if same_difficulty:
                    candidates = same_difficulty

        if last_case in candidates and len(candidates) > 1:
            candidates = [cid for cid in candidates if cid != last_case]
        return await self._get_case(guild_id, random.choice(candidates))

    # ------------------------------------------------------------------ #
    # Game storage helpers
    # ------------------------------------------------------------------ #

    def _lock_for(self, key: tuple[int, int]) -> asyncio.Lock:
        return self._locks.setdefault(key, asyncio.Lock())

    def _game_for(self, guild_id: int, user_id: int) -> ActiveGame | None:
        return self._games.get((guild_id, user_id))

    def _game_by_id(self, game_id: str) -> ActiveGame | None:
        for game in self._games.values():
            if game.game_id == game_id:
                return game
        return None

    async def _save_game(self, game: ActiveGame) -> None:
        await self.config.member_from_ids(
            game.guild_id, game.player_id
        ).active_game.set(game.to_dict())

    def _register_view(self, game: ActiveGame, case: Case) -> EnigmicGameView:
        old = self._registered_views.pop(game.game_id, None)
        if old is not None:
            old.stop()
        view = EnigmicGameView(self, game, case)
        if game.message_id is not None:
            self.bot.add_view(view, message_id=game.message_id)
        self._registered_views[game.game_id] = view
        return view

    async def _discard_game(self, game: ActiveGame, *, note: str | None = None) -> None:
        """Drop a finished game from cache/storage and neutralize its message."""
        key = (game.guild_id, game.player_id)
        self._games.pop(key, None)
        view = self._registered_views.pop(game.game_id, None)
        if view is not None:
            view.stop()
        # The lock entry is deliberately kept: popping it while another
        # coroutine still waits on the old Lock object would let two critical
        # sections run concurrently.  Locks are tiny and bounded by the
        # number of distinct players, and the dict is dropped on cog unload.
        await self.config.member_from_ids(*key).active_game.set(None)
        if note and game.message_id:
            channel = self.bot.get_channel(game.channel_id)
            if channel is not None:
                try:
                    await channel.get_partial_message(game.message_id).edit(
                        content=note, view=None
                    )
                except discord.HTTPException:
                    pass

    # ------------------------------------------------------------------ #
    # Rendering and the game message
    # ------------------------------------------------------------------ #

    async def _render_file(
        self, game: ActiveGame, case: Case
    ) -> tuple[discord.File, str]:
        geometry = self._geometry(case)
        selected = game.selected_character_id
        selected_symbol = None
        note_cells: Iterable = ()
        if selected is not None:
            character = case.characters_by_id.get(selected)
            if character is not None:
                selected_symbol = character.symbol
                note_cells = game.character_exclusions.get(selected, set())
        png = await asyncio.to_thread(
            render_board_png,
            case,
            geometry,
            placements=game.placements,
            global_exclusions=game.global_exclusions,
            character_exclusions=note_cells,
            selected_symbol=selected_symbol,
        )
        game.board_sequence += 1
        filename = f"enigmic_{game.game_id[:8]}_{game.board_sequence}.png"
        return discord.File(io.BytesIO(png), filename=filename), filename

    def _character_lines(self, game: ActiveGame, case: Case) -> list[str]:
        lines = []
        for character in case.characters:
            role = "victim" if character.role is Role.VICTIM else "suspect"
            cell = game.placements.get(character.id)
            where = format_coordinate(cell) if cell is not None else "not placed"
            marker = "➤ " if character.id == game.selected_character_id else ""
            lines.append(
                f"{marker}`{character.symbol}` **{character.short_name}** "
                f"({role}) - {where}"
            )
        return lines

    def _clue_lines(self, case: Case) -> list[str]:
        lines = []
        for index, clue in enumerate(case.clues, start=1):
            text = clue.text or f"({clue.kind.value})"
            lines.append(f"{index}. {text}")
        return lines

    def _add_chunked_field(
        self, embed: discord.Embed, name: str, lines: list[str],
        *, max_fields: int = 3
    ) -> None:
        """Add ``lines`` as one or more fields, respecting Discord's limits.

        Individual lines are hard-sliced below the 1024-character field cap
        and at most ``max_fields`` fields are emitted (custom cases can carry
        arbitrarily long content; the full text is always available through
        the ``enigmic board`` text fallback).
        """
        lines = [line[:997] + "..." if len(line) > 1000 else line for line in lines]
        chunk: list[str] = []
        length = 0
        part = 1
        truncated = False
        for line in lines:
            if length + len(line) + 1 > 1000 and chunk:
                if part >= max_fields:
                    truncated = True
                    break
                embed.add_field(
                    name=name if part == 1 else f"{name} (cont.)",
                    value="\n".join(chunk),
                    inline=False,
                )
                part += 1
                chunk, length = [], 0
            chunk.append(line)
            length += len(line) + 1
        if chunk:
            value = "\n".join(chunk)
            if truncated:
                value = value[:950] + "\n... (use the board command for the rest)"
            embed.add_field(
                name=name if part == 1 else f"{name} (cont.)",
                value=value,
                inline=False,
            )

    def _build_embed(
        self, game: ActiveGame, case: Case, image_filename: str
    ) -> discord.Embed:
        started = _parse_iso(game.started_at)
        elapsed = (
            _format_seconds((_now() - started).total_seconds())
            if started
            else "unknown"
        )
        story = case.story if len(case.story) <= 1200 else case.story[:1197] + "..."
        title = f"{case.title} ({case.difficulty.value}, {case.size}x{case.size})"
        embed = discord.Embed(
            title=title[:256],
            description=story,
            color=discord.Color.dark_teal(),
        )
        placed = len(game.placements)
        embed.add_field(
            name="Progress",
            value=(
                f"Placed: {placed}/{len(case.characters)}\n"
                f"Elapsed: {elapsed}\n"
                f"Hints used: {game.hints_used}\n"
                f"Wrong submissions: {game.wrong_submissions}"
            ),
            inline=False,
        )
        self._add_chunked_field(embed, "Characters", self._character_lines(game, case))
        self._add_chunked_field(embed, "Clues", self._clue_lines(case))
        if game.global_exclusions:
            marks = ", ".join(
                format_coordinate(cell) for cell in sorted(game.global_exclusions)
            )
            embed.add_field(name="X marks", value=marks[:1000], inline=False)
        embed.set_image(url=f"attachment://{image_filename}")
        embed.set_footer(
            text="Select a character, then use the buttons. "
                 "Every action also has an enigmic subcommand."
        )
        # Final safety net for the 6000-character total embed limit.
        while len(embed) > 5900 and len(embed.fields) > 1:
            embed.remove_field(len(embed.fields) - 1)
        if len(embed) > 5900 and embed.description:
            overshoot = len(embed) - 5900
            embed.description = embed.description[: max(0, len(embed.description) - overshoot - 3)] + "..."
        return embed

    async def _edit_game_message(
        self,
        game: ActiveGame,
        case: Case,
        *,
        view: discord.ui.View | None = None,
        content: str | None = None,
    ) -> bool:
        """Refresh the persistent game message; returns False when missing."""
        if game.message_id is None:
            return False
        channel = self.bot.get_channel(game.channel_id)
        if channel is None:
            return False
        file, filename = await self._render_file(game, case)
        embed = self._build_embed(game, case, filename)
        if view is None:
            view = self._register_view(game, case)
        try:
            await channel.get_partial_message(game.message_id).edit(
                content=content,
                embed=embed,
                attachments=[file],
                view=view,
            )
        except discord.NotFound:
            return False
        except discord.HTTPException:
            log.exception("Failed to edit the game message for %s.", game.game_id)
            return False
        return True

    async def _post_game_message(
        self, game: ActiveGame, case: Case, channel: discord.abc.Messageable
    ) -> discord.Message:
        file, filename = await self._render_file(game, case)
        embed = self._build_embed(game, case, filename)
        old = self._registered_views.pop(game.game_id, None)
        if old is not None:
            old.stop()
        view = EnigmicGameView(self, game, case)
        message = await channel.send(embed=embed, file=file, view=view)
        game.message_id = message.id
        self._registered_views[game.game_id] = view
        return message

    # ------------------------------------------------------------------ #
    # Guards
    # ------------------------------------------------------------------ #

    async def _guild_ready(self, guild: discord.Guild, channel_id: int) -> str | None:
        """Return an error string when the cog may not run here."""
        conf = await self.config.guild(guild).all()
        if not conf["enabled"]:
            return "Enigmic is disabled on this server."
        allowed = conf.get("allowed_channels") or []
        if allowed and channel_id not in allowed:
            mentions = ", ".join(f"<#{cid}>" for cid in allowed)
            return f"Enigmic can only be played in: {mentions}."
        return None

    async def _require_game(
        self, ctx: commands.Context
    ) -> tuple[ActiveGame, Case, CaseGeometry]:
        game = self._game_for(ctx.guild.id, ctx.author.id)
        if game is None or game.status is not GameStatus.ACTIVE:
            raise InvalidMove(
                "You have no active case. Start one with "
                f"`{ctx.clean_prefix}enigmic start`."
            )
        case = await self._get_case(ctx.guild.id, game.case_id)
        return game, case, self._geometry(case)

    # ------------------------------------------------------------------ #
    # Shared gameplay actions
    # ------------------------------------------------------------------ #

    async def _apply_mutation(
        self,
        game: ActiveGame,
        case: Case,
        mutator: Callable[[], str],
        *,
        refresh_message: bool = True,
    ) -> str:
        """Run a state mutation under the player's lock and persist it."""
        key = (game.guild_id, game.player_id)
        async with self._lock_for(key):
            if self._games.get(key) is not game or game.status is not GameStatus.ACTIVE:
                raise InvalidMove("This case is no longer active.")
            result = mutator()
            game.last_action_at = _now_iso()
            await self._save_game(game)
            if refresh_message:
                await self._edit_game_message(game, case)
        return result

    async def _do_start(
        self,
        ctx: commands.Context,
        selector: str | None,
        *,
        mode: GameMode = GameMode.STANDARD,
        daily_date: str | None = None,
        case: Case | None = None,
    ) -> None:
        # A slash invocation must be answered within Discord's response
        # window; rendering the board can take longer, so defer first.
        if ctx.interaction is not None and not ctx.interaction.response.is_done():
            await ctx.defer()
        await self._start_flow(
            guild=ctx.guild,
            channel=ctx.channel,
            user=ctx.author,
            send=ctx.send,
            selector=selector,
            mode=mode,
            daily_date=daily_date,
            case=case,
        )

    async def _start_flow(
        self,
        *,
        guild: discord.Guild,
        channel: discord.abc.Messageable,
        user: discord.abc.User,
        send,
        selector: str | None,
        mode: GameMode = GameMode.STANDARD,
        daily_date: str | None = None,
        case: Case | None = None,
    ) -> None:
        """Start a new game.  ``send`` is either ``ctx.send`` or
        ``interaction.followup.send`` so buttons and commands share the flow."""
        channel_id = getattr(channel, "id", 0)
        error = await self._guild_ready(guild, channel_id)
        if error:
            await send(error, ephemeral=True)
            return

        key = (guild.id, user.id)
        existing = self._games.get(key)
        if existing is not None and existing.status is GameStatus.ACTIVE:
            view = ConfirmView(user.id)
            prompt = await send(
                "You already have an active case "
                f"(**{existing.case_id}**). Abandon it and start a new one?",
                view=view,
            )
            await view.wait()
            try:
                await prompt.edit(view=None)
            except discord.HTTPException:
                pass
            if not view.value:
                await send("Keeping your current case.", ephemeral=True)
                return
            async with self._lock_for(key):
                # Re-check under the lock: the game may have ended while the
                # confirmation prompt was open.
                if self._games.get(key) is existing and (
                    existing.status is GameStatus.ACTIVE
                ):
                    existing.status = GameStatus.ABANDONED
                    await self._record_game_end(existing, completed=False)
                    await self._discard_game(
                        existing, note="This case was abandoned for a new one."
                    )

        if case is None:
            case = await self._pick_case_for_player(guild.id, user.id, selector)

        game = ActiveGame(
            guild_id=guild.id,
            channel_id=channel_id,
            player_id=user.id,
            case_id=case.id,
            game_id=uuid.uuid4().hex,
            mode=mode,
            daily_date=daily_date,
            started_at=_now_iso(),
            last_action_at=_now_iso(),
        )
        async with self._lock_for(key):
            self._games[key] = game
            await self._save_game(game)
        user_conf = self.config.user(user)
        await user_conf.total_started.set(await user_conf.total_started() + 1)
        async with self.config.member_from_ids(
            guild.id, user.id
        ).recent_case_ids() as recent:
            recent.append(case.id)
            del recent[:-10]

        await self._post_game_message(game, case, channel)
        # Persisting the message id spans a render plus an upload, so take the
        # lock and re-check identity: the game may have been abandoned, or the
        # player's data deleted, while the board was being produced.
        async with self._lock_for(key):
            if self._games.get(key) is game:
                await self._save_game(game)
        await send(
            f"Case started: **{case.title[:100]}** - good luck, detective!"
        )

    async def _complete_game(self, game: ActiveGame, case: Case) -> discord.Embed:
        """Mark a game solved, record statistics, and build the result embed."""
        geometry = self._geometry(case)
        game.status = GameStatus.COMPLETED
        started = _parse_iso(game.started_at)
        elapsed = (_now() - started).total_seconds() if started else 0.0
        murderer_id = game_logic.derive_murderer(case, geometry) or case.killer_id
        murderer = case.characters_by_id[murderer_id]
        victim = case.victim
        victim_room_id = geometry.room_of.get(case.solution[case.victim_id])
        victim_room = case.rooms_by_id.get(victim_room_id)

        await self._record_game_end(game, completed=True, elapsed=elapsed)

        positions = ", ".join(
            f"{case.characters_by_id[cid].short_name} {format_coordinate(cell)}"
            for cid, cell in sorted(case.solution.items())
        )
        # Names come from case data, which may be arbitrarily long in an
        # imported case; slice every interpolation so the reveal always sends.
        description = (
            f"**{murderer.name[:64]}** murdered "
            f"**{victim.name[:64] if victim else '?'}**.\n\n"
            f"{victim.short_name[:32] if victim else 'The victim'} and "
            f"{murderer.short_name[:32]} were the only two people in the "
            f"**{victim_room.name[:64] if victim_room else 'same room'}**. Every clue "
            f"and every row/column restriction confirms the final arrangement."
        )
        embed = discord.Embed(
            title="Case Solved",
            description=description[:4000],
            color=discord.Color.green(),
        )
        embed.add_field(name="Final positions", value=positions[:1000], inline=False)
        embed.add_field(
            name="Your investigation",
            value=(
                f"Time: {_format_seconds(elapsed)}\n"
                f"Hints used: {game.hints_used}\n"
                f"Wrong submissions: {game.wrong_submissions}"
            ),
            inline=False,
        )
        return embed

    async def _record_game_end(
        self, game: ActiveGame, *, completed: bool, elapsed: float = 0.0
    ) -> None:
        user_conf = self.config.user_from_id(game.player_id)
        stats = await user_conf.all()
        if not completed:
            await user_conf.total_abandoned.set(stats["total_abandoned"] + 1)
            return

        await user_conf.total_completed.set(stats["total_completed"] + 1)
        await user_conf.total_hints.set(stats["total_hints"] + game.hints_used)
        await user_conf.total_wrong_submissions.set(
            stats["total_wrong_submissions"] + game.wrong_submissions
        )
        await user_conf.total_time_seconds.set(
            stats["total_time_seconds"] + elapsed
        )
        try:
            case = await self._get_case(game.guild_id, game.case_id)
        except CaseNotFound:
            case = None
        if case is not None:
            best = dict(stats.get("best_times") or {})
            key = case.difficulty.value
            if key not in best or elapsed < best[key]:
                best[key] = elapsed
                await user_conf.best_times.set(best)

        member_conf = self.config.member_from_ids(game.guild_id, game.player_id)
        async with member_conf.completed_cases() as completed_cases:
            completed_cases[game.case_id] = {
                "at": _now_iso(),
                "seconds": elapsed,
                "hints": game.hints_used,
                "wrong_submissions": game.wrong_submissions,
                "difficulty": case.difficulty.value if case else "unknown",
                "daily": game.mode is GameMode.DAILY,
            }

        if game.mode is GameMode.DAILY and game.daily_date:
            await self._record_daily_completion(game, elapsed)

    async def _record_daily_completion(self, game: ActiveGame, elapsed: float) -> None:
        date_key = game.daily_date
        user_key = str(game.player_id)
        user_conf = self.config.user_from_id(game.player_id)
        records = await user_conf.daily_records()

        record = {
            "completed": True,
            "hints": game.hints_used,
            "wrong_submissions": game.wrong_submissions,
            "seconds": elapsed,
            "finished_at": _now_iso(),
            "case_id": game.case_id,
        }

        # The guild leaderboard is written first and independently of the
        # user-global record: each guild runs its own daily pool, so a player
        # who solves today's case in a second server still belongs on that
        # server's board.  The block is idempotent per (date, user).
        async with self.config.guild_from_id(
            game.guild_id
        ).daily_records() as guild_records:
            day = guild_records.setdefault(date_key, {})
            if user_key not in day:
                day[user_key] = record

        if date_key in records:
            # Already counted globally today: replays never create another
            # personal record and never advance the streak.
            return

        async with user_conf.daily_records() as stored:
            stored[date_key] = record

        # Streaks.
        last = await user_conf.daily_last_date()
        current = await user_conf.daily_current_streak()
        try:
            previous_day = (
                datetime.strptime(date_key, "%Y-%m-%d").date()
                - timedelta(days=1)
            ).isoformat()
        except ValueError:
            previous_day = ""
        current = current + 1 if last == previous_day else 1
        await user_conf.daily_current_streak.set(current)
        await user_conf.daily_last_date.set(date_key)
        longest = await user_conf.daily_longest_streak()
        if current > longest:
            await user_conf.daily_longest_streak.set(current)

    async def _guild_date_key(self, guild_id: int) -> str:
        tz_name = await self.config.guild_from_id(guild_id).timezone()
        try:
            tz = ZoneInfo(tz_name)
        except (ZoneInfoNotFoundError, ValueError):
            tz = timezone.utc
        return datetime.now(tz).date().isoformat()

    # ------------------------------------------------------------------ #
    # Hint / submit internals
    # ------------------------------------------------------------------ #

    async def _do_hint(
        self, game: ActiveGame, case: Case
    ) -> str:
        guild_conf = await self.config.guild_from_id(game.guild_id).all()
        if not guild_conf["hints_enabled"]:
            raise InvalidMove("Hints are disabled on this server.")
        limit = guild_conf["hint_limit"]
        if limit > 0 and game.hints_used >= limit:
            raise InvalidMove(
                f"You have used all {limit} hints for this case."
            )
        geometry = self._geometry(case)
        key = (game.guild_id, game.player_id)
        # Snapshot the game under the lock so the solver thread never reads
        # state that a concurrent action is mutating.
        async with self._lock_for(key):
            snapshot = ActiveGame.from_dict(game.to_dict())
        hint = await asyncio.to_thread(
            game_logic.compute_hint,
            snapshot,
            case,
            geometry,
            show_contradiction_details=guild_conf["hint_details"],
        )
        extra = ""
        if hint.kind in ("elimination", "forced", "reveal"):
            async with self._lock_for(key):
                if (
                    self._games.get(key) is not game
                    or game.status is not GameStatus.ACTIVE
                ):
                    raise InvalidMove("This case is no longer active.")
                game.hints_used += 1
                game.hint_history.append(
                    {"kind": hint.kind, "at": _now_iso(),
                     "character": hint.character_id}
                )
                if (
                    guild_conf["hint_autoplace"]
                    and hint.kind in ("forced", "reveal")
                    and hint.character_id
                    and hint.cell is not None
                ):
                    try:
                        extra = " " + game_logic.place_character(
                            game, case, geometry, hint.character_id, hint.cell
                        )
                    except InvalidMove:
                        extra = ""
                game.last_action_at = _now_iso()
                await self._save_game(game)
                await self._edit_game_message(game, case)
        return hint.message + extra

    async def _do_submit(self, game: ActiveGame, case: Case) -> tuple[bool, str]:
        """Returns (solved, feedback message)."""
        last = _parse_iso(game.last_submission_at or "")
        if last is not None:
            wait = SUBMIT_COOLDOWN_SECONDS - (_now() - last).total_seconds()
            if wait > 0:
                raise InvalidMove(
                    f"Please wait {int(wait) + 1} more second(s) before "
                    f"submitting again."
                )

        result = game_logic.check_submission(game, case)
        if not result.complete:
            names = ", ".join(
                case.characters_by_id[cid].short_name
                for cid in result.missing_character_ids
            )
            placed = result.total - len(result.missing_character_ids)
            return False, (
                f"The board is not complete: {placed} of {result.total} "
                f"characters placed, {len(result.missing_character_ids)} "
                f"remaining ({names})."
            )

        game.last_submission_at = _now_iso()
        if result.is_correct:
            return True, ""

        game.wrong_submissions += 1
        await self._save_game(game)
        mode = FeedbackMode(
            await self.config.guild_from_id(game.guild_id).feedback_mode()
        )
        if mode is FeedbackMode.GENERIC:
            return False, "That arrangement is not correct. Keep deducing!"
        if mode is FeedbackMode.DETAILED:
            names = ", ".join(
                case.characters_by_id[cid].short_name
                for cid in result.incorrect_character_ids
            )
            return False, (
                f"{result.correct_count} of {result.total} characters are in "
                f"the correct position. Misplaced: {names}."
            )
        return False, (
            f"{result.correct_count} of {result.total} characters are in the "
            f"correct position."
        )

    async def _send_solved(
        self,
        send,
        embed: discord.Embed,
        view: "NextCaseView",
        case: Case,
    ) -> None:
        """Deliver the solved-case reveal, falling back to plain text.

        By the time this runs the game is already recorded and torn down, so
        losing the message would leave the player with no way to see the
        solution they earned.
        """
        try:
            view.message = await send(embed=embed, view=view)
            return
        except discord.HTTPException:
            log.exception("Could not send the completion embed for %s", case.id)
        murderer = case.characters_by_id.get(case.killer_id)
        name = murderer.short_name[:32] if murderer else "the murderer"
        try:
            await send(content=f"Case solved! The murderer was {name}.")
        except discord.HTTPException:
            log.exception("Could not send the completion fallback for %s", case.id)

    async def _finish_submission(
        self, game: ActiveGame, case: Case
    ) -> discord.Embed:
        embed = await self._complete_game(game, case)
        key = (game.guild_id, game.player_id)
        self._games.pop(key, None)
        view = self._registered_views.pop(game.game_id, None)
        if view is not None:
            view.stop()
        await self.config.member_from_ids(*key).active_game.set(None)
        # Replace the board message controls with the completion embed.
        channel = self.bot.get_channel(game.channel_id)
        if channel is not None and game.message_id is not None:
            try:
                await channel.get_partial_message(game.message_id).edit(
                    view=None
                )
            except discord.HTTPException:
                pass
        return embed

    # ------------------------------------------------------------------ #
    # View interaction handling
    # ------------------------------------------------------------------ #

    async def _interaction_game(
        self, interaction: discord.Interaction, game_id: str
    ) -> tuple[ActiveGame, Case] | None:
        """Common guard for every component interaction; None means handled."""
        game = self._game_by_id(game_id)
        if game is None or game.status is not GameStatus.ACTIVE:
            await interaction.response.send_message(
                "This board belongs to a finished or expired case. Start a "
                "new one with /enigmic start.",
                ephemeral=True,
            )
            return None
        if interaction.user.id != game.player_id:
            await interaction.response.send_message(
                "This puzzle belongs to another player. Start your own game "
                "with /enigmic start.",
                ephemeral=True,
            )
            return None
        if interaction.guild_id != game.guild_id:
            await interaction.response.send_message(
                "This board belongs to a different server.", ephemeral=True
            )
            return None
        if (
            interaction.message is not None
            and game.message_id is not None
            and interaction.message.id != game.message_id
        ):
            await interaction.response.send_message(
                "This board message is outdated. Use /enigmic resume to get "
                "a fresh one.",
                ephemeral=True,
            )
            return None
        error = await self._guild_ready(
            interaction.guild, game.channel_id
        )
        if error:
            await interaction.response.send_message(error, ephemeral=True)
            return None
        try:
            case = await self._get_case(game.guild_id, game.case_id)
        except CaseNotFound:
            await interaction.response.send_message(
                "The case behind this board no longer exists.", ephemeral=True
            )
            return None
        return game, case

    async def handle_character_select(
        self, interaction: discord.Interaction, game_id: str, character_id: str
    ) -> None:
        resolved = await self._interaction_game(interaction, game_id)
        if resolved is None:
            return
        game, case = resolved
        await interaction.response.defer()
        try:
            await self._apply_mutation(
                game, case, lambda: self._select_character(game, case, character_id)
            )
        except InvalidMove as exc:
            await interaction.followup.send(str(exc), ephemeral=True)

    def _select_character(
        self, game: ActiveGame, case: Case, character_id: str
    ) -> str:
        if character_id not in case.characters_by_id:
            raise InvalidMove("That character is not part of this case.")
        game.selected_character_id = character_id
        return f"Selected {case.characters_by_id[character_id].short_name}."

    async def handle_view_action(
        self, interaction: discord.Interaction, game_id: str, action: str
    ) -> None:
        resolved = await self._interaction_game(interaction, game_id)
        if resolved is None:
            return
        game, case = resolved
        try:
            if action == "place":
                await self._ui_place(interaction, game, case)
            elif action == "remove":
                await self._ui_simple(
                    interaction, game, case,
                    lambda: self._require_selected_and(game, case, "remove"),
                )
            elif action == "mark":
                await self._ui_coordinate_modal(
                    interaction, game, case, "Mark a cell with X", "mark"
                )
            elif action == "note":
                if game.selected_character_id is None:
                    await interaction.response.send_message(
                        "Select a character first - notes belong to a specific "
                        "character.",
                        ephemeral=True,
                    )
                    return
                await self._ui_coordinate_modal(
                    interaction, game, case, "Toggle a character note", "note"
                )
            elif action == "clear":
                await self._ui_coordinate_modal(
                    interaction, game, case, "Clear a mark", "clear"
                )
            elif action == "undo":
                await self._ui_simple(
                    interaction, game, case,
                    lambda: game_logic.undo_last_action(game),
                )
            elif action == "hint":
                await interaction.response.defer(ephemeral=True, thinking=True)
                message = await self._do_hint(game, case)
                await interaction.followup.send(message, ephemeral=True)
            elif action == "refresh":
                await interaction.response.defer(ephemeral=True)
                async with self._lock_for((game.guild_id, game.player_id)):
                    updated = await self._edit_game_message(game, case)
                await interaction.followup.send(
                    "Board refreshed." if updated
                    else "The board message is missing - use /enigmic resume.",
                    ephemeral=True,
                )
            elif action == "submit":
                await self._ui_submit(interaction, game, case)
            elif action == "rules":
                await interaction.response.send_message(RULES_TEXT, ephemeral=True)
            elif action == "abandon":
                await self._ui_abandon(interaction, game, case)
            else:
                await interaction.response.send_message(
                    "Unknown action.", ephemeral=True
                )
        except (InvalidMove, InvalidCoordinate, AmbiguousCharacter) as exc:
            await self._respond(interaction, str(exc))
        except Exception:
            log.exception("Unhandled error in view action '%s'.", action)
            await self._respond(
                interaction,
                "Something went wrong while handling that action. "
                "Please try again.",
            )

    async def _respond(self, interaction: discord.Interaction, message: str) -> None:
        if interaction.response.is_done():
            await interaction.followup.send(message, ephemeral=True)
        else:
            await interaction.response.send_message(message, ephemeral=True)

    def _require_selected_and(
        self, game: ActiveGame, case: Case, action: str
    ) -> str:
        selected = game.selected_character_id
        if selected is None:
            raise InvalidMove("Select a character first.")
        if action == "remove":
            return game_logic.remove_character(game, case, selected)
        raise InvalidMove("Unknown action.")

    async def _ui_simple(
        self,
        interaction: discord.Interaction,
        game: ActiveGame,
        case: Case,
        mutator: Callable[[], str],
    ) -> None:
        await interaction.response.defer(ephemeral=True)
        message = await self._apply_mutation(game, case, mutator)
        await interaction.followup.send(message, ephemeral=True)

    async def _ui_place(
        self, interaction: discord.Interaction, game: ActiveGame, case: Case
    ) -> None:
        selected = game.selected_character_id
        if selected is None:
            await interaction.response.send_message(
                "Select a character first, then press Place.", ephemeral=True
            )
            return
        character = case.characters_by_id.get(selected)
        if character is None:
            await interaction.response.send_message(
                "The selected character no longer exists in this case.",
                ephemeral=True,
            )
            return
        geometry = self._geometry(case)

        async def on_submit(modal_interaction: discord.Interaction, raw: str) -> None:
            await modal_interaction.response.defer(ephemeral=True)
            try:
                cell = parse_coordinate(raw, case.size)
                message = await self._apply_mutation(
                    game,
                    case,
                    lambda: game_logic.place_character(
                        game, case, geometry, selected, cell
                    ),
                )
            except (InvalidMove, InvalidCoordinate) as exc:
                await modal_interaction.followup.send(str(exc), ephemeral=True)
                return
            except Exception:
                # Modal.on_submit swallows anything else: the move would be
                # committed while the player is told nothing at all.
                log.exception("Placement modal failed for game %s", game.game_id)
                await modal_interaction.followup.send(
                    "Something went wrong while applying that. Please try again.",
                    ephemeral=True,
                )
                return
            await modal_interaction.followup.send(message, ephemeral=True)

        await interaction.response.send_modal(
            CoordinateModal(f"Place {character.short_name}", case.size, on_submit)
        )

    async def _ui_coordinate_modal(
        self,
        interaction: discord.Interaction,
        game: ActiveGame,
        case: Case,
        title: str,
        action: str,
    ) -> None:
        geometry = self._geometry(case)
        selected = game.selected_character_id

        async def on_submit(modal_interaction: discord.Interaction, raw: str) -> None:
            await modal_interaction.response.defer(ephemeral=True)
            try:
                cell = parse_coordinate(raw, case.size)
                if action == "mark":
                    mutator = lambda: game_logic.mark_global_x(game, geometry, cell)
                elif action == "note":
                    mutator = lambda: game_logic.toggle_character_note(
                        game, case, selected, cell
                    )
                else:
                    mutator = lambda: game_logic.clear_mark(game, cell)
                message = await self._apply_mutation(game, case, mutator)
            except (InvalidMove, InvalidCoordinate) as exc:
                await modal_interaction.followup.send(str(exc), ephemeral=True)
                return
            except Exception:
                log.exception("Mark modal failed for game %s", game.game_id)
                await modal_interaction.followup.send(
                    "Something went wrong while applying that. Please try again.",
                    ephemeral=True,
                )
                return
            await modal_interaction.followup.send(message, ephemeral=True)

        await interaction.response.send_modal(
            CoordinateModal(title, case.size, on_submit)
        )

    async def _ui_submit(
        self, interaction: discord.Interaction, game: ActiveGame, case: Case
    ) -> None:
        await interaction.response.defer(ephemeral=True)
        key = (game.guild_id, game.player_id)
        async with self._lock_for(key):
            if (
                self._games.get(key) is not game
                or game.status is not GameStatus.ACTIVE
            ):
                await interaction.followup.send(
                    "This case is no longer active.", ephemeral=True
                )
                return
            solved, feedback = await self._do_submit(game, case)
            if not solved:
                await interaction.followup.send(feedback, ephemeral=True)
                return
            embed = await self._finish_submission(game, case)
        view = NextCaseView(self, game.player_id)
        # wait=True so the followup returns the Message; without it the view
        # never learns which message to disable when it times out.
        await self._send_solved(
            lambda **kwargs: interaction.followup.send(wait=True, **kwargs),
            embed,
            view,
            case,
        )

    async def _ui_abandon(
        self, interaction: discord.Interaction, game: ActiveGame, case: Case
    ) -> None:
        view = ConfirmView(interaction.user.id)
        await interaction.response.send_message(
            "Abandon this case? Your progress will be lost.",
            view=view,
            ephemeral=True,
        )
        await view.wait()
        # The prompt's buttons stop responding once the view stops, so clear
        # them and always tell the player what happened.
        try:
            await interaction.edit_original_response(view=None)
        except discord.HTTPException:
            pass
        if not view.value:
            await interaction.followup.send(
                "Keeping your case open.", ephemeral=True
            )
            return
        key = (game.guild_id, game.player_id)
        async with self._lock_for(key):
            if self._games.get(key) is not game:
                await interaction.followup.send(
                    "This case is no longer active.", ephemeral=True
                )
                return
            game.status = GameStatus.ABANDONED
            await self._record_game_end(game, completed=False)
            await self._discard_game(game, note="This case was abandoned.")
        await interaction.followup.send(
            "Case abandoned. Start a new one any time!", ephemeral=True
        )

    async def handle_next_case(self, interaction: discord.Interaction) -> None:
        # Component interactions have no command, so Context.from_interaction
        # is unusable here; drive the shared start flow directly.
        await interaction.response.defer()
        try:
            await self._start_flow(
                guild=interaction.guild,
                channel=interaction.channel,
                user=interaction.user,
                send=interaction.followup.send,
                selector=None,
            )
        except EnigmicError as exc:
            await interaction.followup.send(str(exc), ephemeral=True)
        except Exception:
            log.exception("Failed to start the next case.")
            await interaction.followup.send(
                "Something went wrong starting the next case. Please try "
                "again with the start command.",
                ephemeral=True,
            )

    async def handle_view_error(
        self, interaction: discord.Interaction, error: Exception
    ) -> None:
        log.exception("View interaction error", exc_info=error)
        try:
            await self._respond(
                interaction,
                "Something went wrong while handling that action. "
                "Please try again.",
            )
        except discord.HTTPException:
            pass

    # ------------------------------------------------------------------ #
    # Player commands
    # ------------------------------------------------------------------ #

    @commands.hybrid_group(
        name="enigmic",
        aliases=["enigma", "crimepuzzle"],
        invoke_without_command=True,
        fallback="help",
    )
    @commands.guild_only()
    async def enigmic(self, ctx: commands.Context) -> None:
        """Enigmic - a murder-mystery deduction puzzle."""
        prefix = ctx.clean_prefix
        embed = discord.Embed(
            title="Enigmic - Murder-Mystery Deduction",
            description=(
                "Place every suspect and the victim on the crime-scene grid, "
                "satisfy every clue, and unmask the murderer.\n\n"
                f"`{prefix}enigmic start [difficulty|case]` - start a case\n"
                f"`{prefix}enigmic daily` - play today's daily case\n"
                f"`{prefix}enigmic resume` - repost your active board\n"
                f"`{prefix}enigmic rules` - how to play\n"
                f"`{prefix}enigmic cases` - list available cases\n"
                f"`{prefix}enigmic stats` - your statistics\n"
                f"`{prefix}enigmic leaderboard` - server leaderboard\n\n"
                f"During a game: `place`, `remove`, `mark`, `note`, `clear`, "
                f"`undo`, `hint`, `submit`, `board`, `abandon` - or just use "
                f"the buttons under the board."
            ),
            color=discord.Color.dark_teal(),
        )
        await ctx.send(embed=embed)

    @enigmic.command(name="start")
    @commands.guild_only()
    @commands.cooldown(1, 10, commands.BucketType.user)
    async def enigmic_start(
        self, ctx: commands.Context, difficulty_or_case: str | None = None
    ) -> None:
        """Start a new case.

        Optionally pass a difficulty (beginner, easy, normal, hard, expert)
        or a specific case ID.
        """
        try:
            await self._do_start(ctx, difficulty_or_case)
        except CaseNotFound as exc:
            await ctx.send(str(exc), ephemeral=True)

    @enigmic.group(name="daily", invoke_without_command=True, fallback="play")
    @commands.guild_only()
    @commands.cooldown(1, 10, commands.BucketType.user)
    async def enigmic_daily(self, ctx: commands.Context) -> None:
        """Play today's daily case."""
        if not await self.config.guild(ctx.guild).daily_enabled():
            await ctx.send("Daily cases are disabled on this server.", ephemeral=True)
            return
        date_key = await self._guild_date_key(ctx.guild.id)
        pool = await self._available_case_ids(ctx.guild.id)
        case_id = game_logic.pick_daily_case(pool, date_key)
        if case_id is None:
            await ctx.send("No cases are available for the daily puzzle.",
                           ephemeral=True)
            return
        try:
            case = await self._get_case(ctx.guild.id, case_id)
        except CaseNotFound as exc:
            await ctx.send(str(exc), ephemeral=True)
            return
        records = await self.config.user(ctx.author).daily_records()
        note = ""
        if date_key in records:
            note = (
                " You already completed a daily today - this replay will not "
                "create another leaderboard record."
            )
        await ctx.send(f"Daily case for **{date_key}**: {case.title[:100]}.{note}")
        try:
            await self._do_start(
                ctx, None, mode=GameMode.DAILY, daily_date=date_key, case=case
            )
        except CaseNotFound as exc:
            await ctx.send(str(exc), ephemeral=True)

    @enigmic_daily.command(name="leaderboard")
    @commands.guild_only()
    async def enigmic_daily_leaderboard(self, ctx: commands.Context) -> None:
        """Show today's daily leaderboard."""
        date_key = await self._guild_date_key(ctx.guild.id)
        records = await self.config.guild(ctx.guild).daily_records()
        day = records.get(date_key) or {}
        if not day:
            await ctx.send(f"Nobody has completed the daily case for {date_key} yet.")
            return

        def sort_key(item: tuple[str, dict]) -> tuple:
            record = item[1]
            return (
                0 if record.get("completed") else 1,
                record.get("hints", 0),
                record.get("wrong_submissions", 0),
                record.get("seconds", float("inf")),
                record.get("finished_at", ""),
            )

        lines = []
        for rank, (user_id, record) in enumerate(
            sorted(day.items(), key=sort_key)[:10], start=1
        ):
            member = ctx.guild.get_member(int(user_id))
            name = member.display_name if member else f"User {user_id}"
            lines.append(
                f"{rank}. **{name}** - {_format_seconds(record.get('seconds', 0))}, "
                f"{record.get('hints', 0)} hint(s), "
                f"{record.get('wrong_submissions', 0)} wrong"
            )
        embed = discord.Embed(
            title=f"Daily leaderboard - {date_key}",
            description="\n".join(lines),
            color=discord.Color.gold(),
        )
        await ctx.send(embed=embed)

    @enigmic_daily.command(name="status")
    @commands.guild_only()
    async def enigmic_daily_status(self, ctx: commands.Context) -> None:
        """Show your daily-case status and streaks."""
        date_key = await self._guild_date_key(ctx.guild.id)
        user_conf = self.config.user(ctx.author)
        records = await user_conf.daily_records()
        today = records.get(date_key)
        lines = [
            f"Today ({date_key}): "
            + ("completed ✅" if today else "not completed yet"),
            f"Current streak: {await user_conf.daily_current_streak()} day(s)",
            f"Longest streak: {await user_conf.daily_longest_streak()} day(s)",
            f"Total dailies completed: {len(records)}",
        ]
        await ctx.send("\n".join(lines))

    @enigmic.command(name="resume")
    @commands.guild_only()
    @commands.cooldown(1, 10, commands.BucketType.user)
    async def enigmic_resume(self, ctx: commands.Context) -> None:
        """Repost your active game board (for example after it was deleted)."""
        try:
            game, case, _geo = await self._require_game(ctx)
        except InvalidMove as exc:
            await ctx.send(str(exc), ephemeral=True)
            return
        error = await self._guild_ready(ctx.guild, ctx.channel.id)
        if error:
            await ctx.send(error, ephemeral=True)
            return
        if ctx.interaction is not None and not ctx.interaction.response.is_done():
            await ctx.defer()
        key = (game.guild_id, game.player_id)
        async with self._lock_for(key):
            if (
                self._games.get(key) is not game
                or game.status is not GameStatus.ACTIVE
            ):
                await ctx.send("This case is no longer active.", ephemeral=True)
                return
            # Remove the old message if it still exists.
            if game.message_id is not None:
                channel = self.bot.get_channel(game.channel_id)
                if channel is not None:
                    try:
                        await channel.get_partial_message(game.message_id).delete()
                    except discord.HTTPException:
                        pass
            game.channel_id = ctx.channel.id
            await self._post_game_message(game, case, ctx.channel)
            game.last_action_at = _now_iso()
            await self._save_game(game)
        await ctx.send("Your board has been reposted above.")

    @enigmic.command(name="board")
    @commands.guild_only()
    @commands.cooldown(1, 5, commands.BucketType.user)
    async def enigmic_board(self, ctx: commands.Context) -> None:
        """Show your current board with a text summary (works without embeds)."""
        try:
            game, case, _geo = await self._require_game(ctx)
        except InvalidMove as exc:
            await ctx.send(str(exc), ephemeral=True)
            return
        if ctx.interaction is not None and not ctx.interaction.response.is_done():
            await ctx.defer()
        async with self._lock_for((game.guild_id, game.player_id)):
            file, _filename = await self._render_file(game, case)
        lines = [f"**{case.title[:100]}** ({case.difficulty.value}, "
                 f"{case.size}x{case.size})", "", "Characters:"]
        for character in case.characters:
            cell = game.placements.get(character.id)
            where = format_coordinate(cell) if cell else "not placed"
            role = "victim" if character.role is Role.VICTIM else "suspect"
            room = ""
            if cell is not None:
                room_id = self._geometry(case).room_of.get(cell)
                room_obj = case.rooms_by_id.get(room_id)
                if room_obj:
                    room = f" ({room_obj.name})"
            lines.append(
                f"  {character.symbol} {character.short_name} [{role}]: "
                f"{where}{room}"
            )
        if game.global_exclusions:
            lines.append(
                "X marks: "
                + ", ".join(format_coordinate(c)
                            for c in sorted(game.global_exclusions))
            )
        lines.append("")
        lines.append("Clues:")
        lines.extend(f"  {line}" for line in self._clue_lines(case))
        text = "\n".join(lines)
        if len(text) > 1900:
            text = text[:1897] + "..."
        await ctx.send(content=text, file=file)

    @enigmic.command(name="place")
    @commands.guild_only()
    async def enigmic_place(
        self, ctx: commands.Context, character: str, coordinate: str
    ) -> None:
        """Place a character on a cell, for example: place Alma B2."""
        await self._command_action(
            ctx,
            lambda game, case, geo: game_logic.place_character(
                game, case, geo,
                resolve_character(case, character).id,
                parse_coordinate(coordinate, case.size),
            ),
        )

    @enigmic.command(name="remove")
    @commands.guild_only()
    async def enigmic_remove(self, ctx: commands.Context, character: str) -> None:
        """Remove a character's placement from the board."""
        await self._command_action(
            ctx,
            lambda game, case, geo: game_logic.remove_character(
                game, case, resolve_character(case, character).id
            ),
        )

    @enigmic.command(name="mark")
    @commands.guild_only()
    async def enigmic_mark(self, ctx: commands.Context, coordinate: str) -> None:
        """Mark a cell with an X (your note that nobody stands there)."""
        await self._command_action(
            ctx,
            lambda game, case, geo: game_logic.mark_global_x(
                game, geo, parse_coordinate(coordinate, case.size)
            ),
        )

    @enigmic.command(name="note")
    @commands.guild_only()
    async def enigmic_note(
        self, ctx: commands.Context, character: str, coordinate: str
    ) -> None:
        """Toggle a per-character exclusion note on a cell."""
        await self._command_action(
            ctx,
            lambda game, case, geo: game_logic.toggle_character_note(
                game, case,
                resolve_character(case, character).id,
                parse_coordinate(coordinate, case.size),
            ),
        )

    @enigmic.command(name="clear")
    @commands.guild_only()
    async def enigmic_clear(self, ctx: commands.Context, coordinate: str) -> None:
        """Clear a mark at a cell (selected character's note first, then X)."""
        await self._command_action(
            ctx,
            lambda game, case, geo: game_logic.clear_mark(
                game, parse_coordinate(coordinate, case.size)
            ),
        )

    @enigmic.command(name="undo")
    @commands.guild_only()
    async def enigmic_undo(self, ctx: commands.Context) -> None:
        """Undo your last board action."""
        await self._command_action(
            ctx, lambda game, case, geo: game_logic.undo_last_action(game)
        )

    @enigmic.command(name="hint")
    @commands.guild_only()
    @commands.cooldown(1, 5, commands.BucketType.user)
    async def enigmic_hint(self, ctx: commands.Context) -> None:
        """Get a logical hint based on your current placements."""
        try:
            game, case, _geo = await self._require_game(ctx)
            async with ctx.typing():
                message = await self._do_hint(game, case)
            await ctx.send(message)
        except (InvalidMove, EnigmicError) as exc:
            await ctx.send(str(exc), ephemeral=True)

    @enigmic.command(name="submit")
    @commands.guild_only()
    async def enigmic_submit(self, ctx: commands.Context) -> None:
        """Submit your complete arrangement for checking."""
        try:
            game, case, _geo = await self._require_game(ctx)
        except InvalidMove as exc:
            await ctx.send(str(exc), ephemeral=True)
            return
        key = (game.guild_id, game.player_id)
        try:
            async with self._lock_for(key):
                if (
                    self._games.get(key) is not game
                    or game.status is not GameStatus.ACTIVE
                ):
                    await ctx.send("This case is no longer active.", ephemeral=True)
                    return
                solved, feedback = await self._do_submit(game, case)
                if not solved:
                    await ctx.send(feedback)
                    return
                embed = await self._finish_submission(game, case)
            view = NextCaseView(self, game.player_id)
            await self._send_solved(
                lambda **kwargs: ctx.send(**kwargs), embed, view, case
            )
        except InvalidMove as exc:
            await ctx.send(str(exc), ephemeral=True)

    @enigmic.command(name="abandon")
    @commands.guild_only()
    async def enigmic_abandon(self, ctx: commands.Context) -> None:
        """Abandon your active case."""
        try:
            game, _case, _geo = await self._require_game(ctx)
        except InvalidMove as exc:
            await ctx.send(str(exc), ephemeral=True)
            return
        view = ConfirmView(ctx.author.id)
        prompt = await ctx.send(
            "Abandon this case? Your progress will be lost.", view=view
        )
        await view.wait()
        try:
            await prompt.edit(view=None)
        except discord.HTTPException:
            pass
        if not view.value:
            await ctx.send("Keeping your case open.")
            return
        key = (game.guild_id, game.player_id)
        async with self._lock_for(key):
            if self._games.get(key) is not game:
                return
            game.status = GameStatus.ABANDONED
            await self._record_game_end(game, completed=False)
            await self._discard_game(game, note="This case was abandoned.")
        await ctx.send("Case abandoned. Start a new one any time!")

    @enigmic.command(name="rules")
    async def enigmic_rules(self, ctx: commands.Context) -> None:
        """Explain the rules of the game."""
        await ctx.send(RULES_TEXT)

    @enigmic.command(name="cases")
    @commands.guild_only()
    async def enigmic_cases(
        self, ctx: commands.Context, difficulty: str | None = None
    ) -> None:
        """List available cases, optionally filtered by difficulty."""
        wanted = Difficulty.from_str(difficulty) if difficulty else None
        if difficulty and wanted is None:
            await ctx.send(
                "Unknown difficulty. Use beginner, easy, normal, hard, or expert.",
                ephemeral=True,
            )
            return
        completed = set(
            await self.config.member(ctx.author).completed_cases()
        )
        lines = []
        for case_id in sorted(await self._available_case_ids(ctx.guild.id)):
            try:
                case = await self._get_case(ctx.guild.id, case_id)
            except CaseNotFound:
                continue
            if wanted is not None and case.difficulty is not wanted:
                continue
            check = " ✅" if case_id in completed else ""
            lines.append(
                f"`{case_id}` - **{case.title[:100]}** "
                f"({case.difficulty.value}, {case.size}x{case.size}){check}"
            )
        if not lines:
            await ctx.send("No cases match that filter.")
            return
        for page in pagify("\n".join(lines), page_length=1900):
            await ctx.send(page)

    @enigmic.command(name="stats")
    @commands.guild_only()
    async def enigmic_stats(
        self, ctx: commands.Context, member: discord.Member | None = None
    ) -> None:
        """Show puzzle statistics for you or another member."""
        target = member or ctx.author
        stats = await self.config.user(target).all()
        # Only the leaf is read: the member group cannot be fetched wholesale
        # while a game is stored (see _pick_from_pool).
        member_completed = await self.config.member_from_ids(
            ctx.guild.id, target.id
        ).completed_cases()
        started = stats["total_started"]
        completed = stats["total_completed"]
        rate = f"{completed / started * 100:.0f}%" if started else "n/a"
        average = (
            _format_seconds(stats["total_time_seconds"] / completed)
            if completed
            else "n/a"
        )
        best_lines = [
            f"{difficulty}: {_format_seconds(seconds)}"
            for difficulty, seconds in sorted(
                (stats.get("best_times") or {}).items()
            )
        ] or ["none yet"]
        embed = discord.Embed(
            title=f"Enigmic statistics - {target.display_name}",
            color=discord.Color.dark_teal(),
        )
        embed.add_field(
            name="Cases",
            value=(
                f"Started: {started}\n"
                f"Completed: {completed}\n"
                f"Abandoned: {stats['total_abandoned']}\n"
                f"Completion rate: {rate}\n"
                f"Solved in this server: {len(member_completed or {})}"
            ),
            inline=False,
        )
        embed.add_field(
            name="Investigation",
            value=(
                f"Hints used: {stats['total_hints']}\n"
                f"Wrong submissions: {stats['total_wrong_submissions']}\n"
                f"Average solve time: {average}"
            ),
            inline=False,
        )
        embed.add_field(name="Best times", value="\n".join(best_lines), inline=False)
        embed.add_field(
            name="Daily",
            value=(
                f"Dailies completed: {len(stats.get('daily_records') or {})}\n"
                f"Current streak: {stats['daily_current_streak']}\n"
                f"Longest streak: {stats['daily_longest_streak']}"
            ),
            inline=False,
        )
        await ctx.send(embed=embed)

    @enigmic.command(name="leaderboard")
    @commands.guild_only()
    @commands.cooldown(1, 10, commands.BucketType.guild)
    async def enigmic_leaderboard(
        self, ctx: commands.Context, difficulty: str | None = None
    ) -> None:
        """Show the server leaderboard, optionally for one difficulty."""
        wanted = Difficulty.from_str(difficulty) if difficulty else None
        if difficulty and wanted is None:
            await ctx.send(
                "Unknown difficulty. Use beginner, easy, normal, hard, or expert.",
                ephemeral=True,
            )
            return
        members = await self.config.all_members(ctx.guild)
        rows = []
        for user_id, data in members.items():
            completed = data.get("completed_cases") or {}
            if wanted is not None:
                completed = {
                    cid: record
                    for cid, record in completed.items()
                    if record.get("difficulty") == wanted.value
                }
            if not completed:
                continue
            best = min(record.get("seconds", float("inf"))
                       for record in completed.values())
            rows.append((user_id, len(completed), best))
        if not rows:
            await ctx.send("Nobody has solved a matching case here yet.")
            return
        rows.sort(key=lambda row: (-row[1], row[2]))
        lines = []
        for rank, (user_id, count, best) in enumerate(rows[:10], start=1):
            member = ctx.guild.get_member(user_id)
            name = member.display_name if member else f"User {user_id}"
            lines.append(
                f"{rank}. **{name}** - {count} solved, "
                f"best {_format_seconds(best)}"
            )
        title = "Enigmic leaderboard"
        if wanted is not None:
            title += f" ({wanted.value})"
        embed = discord.Embed(
            title=title,
            description="\n".join(lines),
            color=discord.Color.gold(),
        )
        if len(rows) > 10:
            embed.set_footer(text=f"{len(rows)} players ranked in total.")
        await ctx.send(embed=embed)

    async def _command_action(
        self,
        ctx: commands.Context,
        mutator: Callable[[ActiveGame, Case, CaseGeometry], str],
    ) -> None:
        """Shared wrapper for the prefix/hybrid gameplay commands."""
        try:
            game, case, geometry = await self._require_game(ctx)
            error = await self._guild_ready(ctx.guild, ctx.channel.id)
            if error:
                await ctx.send(error, ephemeral=True)
                return
            message = await self._apply_mutation(
                game, case, lambda: mutator(game, case, geometry)
            )
            await ctx.send(message)
        except (InvalidMove, InvalidCoordinate, AmbiguousCharacter, CaseNotFound) as exc:
            await ctx.send(str(exc), ephemeral=True)

    # ------------------------------------------------------------------ #
    # Administrator commands
    # ------------------------------------------------------------------ #

    @commands.hybrid_group(name="enigmicset")
    @commands.guild_only()
    @commands.admin_or_permissions(manage_guild=True)
    async def enigmicset(self, ctx: commands.Context) -> None:
        """Configure the Enigmic cog for this server."""
        if ctx.invoked_subcommand is None:
            await ctx.send_help(ctx.command)

    @enigmicset.command(name="enabled")
    @commands.admin_or_permissions(manage_guild=True)
    async def enigmicset_enabled(self, ctx: commands.Context, enabled: bool) -> None:
        """Enable or disable Enigmic on this server."""
        await self.config.guild(ctx.guild).enabled.set(enabled)
        await ctx.send(f"Enigmic is now {'enabled' if enabled else 'disabled'}.")

    @enigmicset.group(name="channel")
    @commands.admin_or_permissions(manage_guild=True)
    async def enigmicset_channel(self, ctx: commands.Context) -> None:
        """Manage the channels where Enigmic may be played."""
        if ctx.invoked_subcommand is None:
            await ctx.send_help(ctx.command)

    @enigmicset_channel.command(name="add")
    @commands.admin_or_permissions(manage_guild=True)
    async def enigmicset_channel_add(
        self, ctx: commands.Context, channel: discord.TextChannel
    ) -> None:
        """Allow Enigmic in a channel (empty list = everywhere)."""
        async with self.config.guild(ctx.guild).allowed_channels() as channels:
            if channel.id in channels:
                await ctx.send(f"{channel.mention} is already on the list.")
                return
            channels.append(channel.id)
        await ctx.send(f"Enigmic is now allowed in {channel.mention}.")

    @enigmicset_channel.command(name="remove")
    @commands.admin_or_permissions(manage_guild=True)
    async def enigmicset_channel_remove(
        self, ctx: commands.Context, channel: discord.TextChannel
    ) -> None:
        """Remove a channel from the allowed list."""
        async with self.config.guild(ctx.guild).allowed_channels() as channels:
            if channel.id not in channels:
                await ctx.send(f"{channel.mention} is not on the list.")
                return
            channels.remove(channel.id)
        await ctx.send(f"{channel.mention} removed from the allowed channels.")

    @enigmicset_channel.command(name="list")
    @commands.admin_or_permissions(manage_guild=True)
    async def enigmicset_channel_list(self, ctx: commands.Context) -> None:
        """List the allowed channels."""
        channels = await self.config.guild(ctx.guild).allowed_channels()
        if not channels:
            await ctx.send("No channel restriction - Enigmic is allowed everywhere.")
            return
        await ctx.send(
            "Enigmic is allowed in: "
            + ", ".join(f"<#{cid}>" for cid in channels)
        )

    @enigmicset.command(name="hints")
    @commands.admin_or_permissions(manage_guild=True)
    async def enigmicset_hints(self, ctx: commands.Context, enabled: bool) -> None:
        """Enable or disable hints."""
        await self.config.guild(ctx.guild).hints_enabled.set(enabled)
        await ctx.send(f"Hints are now {'enabled' if enabled else 'disabled'}.")

    @enigmicset.command(name="hintlimit")
    @commands.admin_or_permissions(manage_guild=True)
    async def enigmicset_hintlimit(self, ctx: commands.Context, number: int) -> None:
        """Set the maximum hints per case (0 = unlimited)."""
        if number < 0 or number > 50:
            await ctx.send("Please choose a value between 0 and 50.")
            return
        await self.config.guild(ctx.guild).hint_limit.set(number)
        await ctx.send(
            "Hint limit set to "
            + ("unlimited." if number == 0 else f"{number} per case.")
        )

    @enigmicset.command(name="hintautoplace")
    @commands.admin_or_permissions(manage_guild=True)
    async def enigmicset_hintautoplace(
        self, ctx: commands.Context, enabled: bool
    ) -> None:
        """Automatically place characters revealed by forced/strong hints."""
        await self.config.guild(ctx.guild).hint_autoplace.set(enabled)
        await ctx.send(
            f"Hint auto-placement is now {'enabled' if enabled else 'disabled'}."
        )

    @enigmicset.command(name="hintdetails")
    @commands.admin_or_permissions(manage_guild=True)
    async def enigmicset_hintdetails(
        self, ctx: commands.Context, enabled: bool
    ) -> None:
        """Show which placement causes a contradiction in hints."""
        await self.config.guild(ctx.guild).hint_details.set(enabled)
        await ctx.send(
            f"Contradiction details are now {'shown' if enabled else 'hidden'}."
        )

    @enigmicset.command(name="feedback")
    @commands.admin_or_permissions(manage_guild=True)
    async def enigmicset_feedback(self, ctx: commands.Context, mode: str) -> None:
        """Set submission feedback: generic, count, or detailed."""
        try:
            parsed = FeedbackMode(mode.lower())
        except ValueError:
            await ctx.send("Choose one of: generic, count, detailed.")
            return
        await self.config.guild(ctx.guild).feedback_mode.set(parsed.value)
        await ctx.send(f"Submission feedback set to '{parsed.value}'.")

    @enigmicset.command(name="timeout")
    @commands.admin_or_permissions(manage_guild=True)
    async def enigmicset_timeout(self, ctx: commands.Context, minutes: int) -> None:
        """Set the inactivity timeout for games, in minutes (0 = never)."""
        if minutes < 0 or minutes > 60 * 24 * 30:
            await ctx.send("Please choose between 0 and 43200 minutes.")
            return
        await self.config.guild(ctx.guild).game_timeout_minutes.set(minutes)
        await ctx.send(
            "Games now "
            + ("never expire." if minutes == 0 else f"expire after {minutes} minutes "
               f"of inactivity.")
        )

    @enigmicset.command(name="timezone")
    @commands.admin_or_permissions(manage_guild=True)
    async def enigmicset_timezone(self, ctx: commands.Context, tz: str) -> None:
        """Set the IANA timezone used for daily cases (e.g. Europe/Amsterdam)."""
        try:
            ZoneInfo(tz)
        except (ZoneInfoNotFoundError, ValueError):
            await ctx.send(
                f"'{tz}' is not a valid IANA timezone. "
                f"Examples: UTC, Europe/Amsterdam, America/New_York."
            )
            return
        await self.config.guild(ctx.guild).timezone.set(tz)
        await ctx.send(f"Daily timezone set to {tz}.")

    @enigmicset.command(name="daily")
    @commands.admin_or_permissions(manage_guild=True)
    async def enigmicset_daily(self, ctx: commands.Context, enabled: bool) -> None:
        """Enable or disable the daily case."""
        await self.config.guild(ctx.guild).daily_enabled.set(enabled)
        await ctx.send(
            f"Daily cases are now {'enabled' if enabled else 'disabled'}."
        )

    @enigmicset.command(name="showsettings")
    @commands.admin_or_permissions(manage_guild=True)
    async def enigmicset_showsettings(self, ctx: commands.Context) -> None:
        """Show the current Enigmic settings for this server."""
        conf = await self.config.guild(ctx.guild).all()
        channels = conf.get("allowed_channels") or []
        channel_text = (
            ", ".join(f"<#{cid}>" for cid in channels) if channels else "everywhere"
        )
        embed = discord.Embed(
            title="Enigmic settings", color=discord.Color.dark_teal()
        )
        embed.add_field(
            name="General",
            value=(
                f"Enabled: {conf['enabled']}\n"
                f"Channels: {channel_text}\n"
                f"Game timeout: {conf['game_timeout_minutes']} minutes\n"
                f"Timezone: {conf['timezone']}"
            ),
            inline=False,
        )
        embed.add_field(
            name="Hints and feedback",
            value=(
                f"Hints enabled: {conf['hints_enabled']}\n"
                f"Hint limit: {conf['hint_limit'] or 'unlimited'}\n"
                f"Hint auto-place: {conf['hint_autoplace']}\n"
                f"Contradiction details: {conf['hint_details']}\n"
                f"Feedback mode: {conf['feedback_mode']}"
            ),
            inline=False,
        )
        embed.add_field(
            name="Cases",
            value=(
                f"Daily enabled: {conf['daily_enabled']}\n"
                f"Bundled cases: {len(self._bundled_cases)}\n"
                f"Custom cases: {len(conf.get('custom_cases') or {})}\n"
                f"Disabled cases: {len(conf.get('disabled_case_ids') or [])}"
            ),
            inline=False,
        )
        await ctx.send(embed=embed)

    # -- custom case management ----------------------------------------- #

    @enigmicset.group(name="case")
    @commands.admin_or_permissions(manage_guild=True)
    async def enigmicset_case(self, ctx: commands.Context) -> None:
        """Manage custom cases."""
        if ctx.invoked_subcommand is None:
            await ctx.send_help(ctx.command)

    @enigmicset_case.command(name="list")
    @commands.admin_or_permissions(manage_guild=True)
    async def enigmicset_case_list(self, ctx: commands.Context) -> None:
        """List every case with its source and enabled state."""
        disabled = set(await self.config.guild(ctx.guild).disabled_case_ids())
        custom = await self.config.guild(ctx.guild).custom_cases()
        lines = []
        for case_id, case in sorted(self._bundled_cases.items()):
            state = "disabled" if case_id in disabled else "enabled"
            lines.append(
                f"`{case_id}` (bundled, {case.difficulty.value}, "
                f"{case.size}x{case.size}) - {state}"
            )
        for case_id in sorted(custom):
            state = "disabled" if case_id in disabled else "enabled"
            lines.append(f"`{case_id}` (custom) - {state}")
        if not lines:
            await ctx.send("No cases are installed.")
            return
        for page in pagify("\n".join(lines), page_length=1900):
            await ctx.send(page)

    @enigmicset_case.command(name="info")
    @commands.admin_or_permissions(manage_guild=True)
    async def enigmicset_case_info(self, ctx: commands.Context, case_id: str) -> None:
        """Show details about one case."""
        try:
            case = await self._get_case(ctx.guild.id, case_id)
        except CaseNotFound as exc:
            await ctx.send(str(exc))
            return
        source = "bundled" if case_id in self._bundled_cases else "custom"
        embed = discord.Embed(
            title=f"{case.title} ({case_id})"[:256],
            description=case.story[:2000],
            color=discord.Color.dark_teal(),
        )
        embed.add_field(
            name="Details",
            value=(
                f"Source: {source}\n"
                f"Difficulty: {case.difficulty.value}\n"
                f"Grid: {case.size}x{case.size}\n"
                f"Characters: {len(case.characters)}\n"
                f"Rooms: {len(case.rooms)}\n"
                f"Clues: {len(case.clues)}\n"
                f"Author: {case.author or 'unknown'}"
            ),
            inline=False,
        )
        await ctx.send(embed=embed)

    @enigmicset_case.command(name="import")
    @commands.admin_or_permissions(manage_guild=True)
    async def enigmicset_case_import(
        self, ctx: commands.Context, attachment: discord.Attachment
    ) -> None:
        """Import a custom case from an attached JSON file.

        The case is fully validated, including a solver run proving it has
        exactly one solution, before it is accepted.
        """
        if attachment.size > MAX_IMPORT_FILE_SIZE:
            await ctx.send(
                f"The file is too large "
                f"(max {MAX_IMPORT_FILE_SIZE // 1024} KiB)."
            )
            return
        try:
            raw_bytes = await attachment.read()
            data = json.loads(raw_bytes.decode("utf-8"))
        except (discord.HTTPException, UnicodeDecodeError,
                json.JSONDecodeError) as exc:
            await ctx.send(f"Could not read that file as JSON: {exc}")
            return
        if not isinstance(data, dict):
            await ctx.send("The file must contain a single JSON object.")
            return

        async with ctx.typing():
            case, report = await asyncio.to_thread(validate_case_dict, data)
        await self._send_validation_report(ctx, report)
        if case is None or not report.ok:
            await ctx.send("The case was **rejected** - fix the errors and retry.")
            return

        custom = await self.config.guild(ctx.guild).custom_cases()
        if case.id in custom or case.id in self._bundled_cases:
            view = ConfirmView(ctx.author.id)
            prompt = await ctx.send(
                f"A case with ID `{case.id}` already exists. Overwrite it?",
                view=view,
            )
            await view.wait()
            try:
                await prompt.edit(view=None)
            except discord.HTTPException:
                pass
            if not view.value:
                await ctx.send("Import cancelled.")
                return
            if case.id in self._bundled_cases:
                await ctx.send(
                    "Bundled cases cannot be overwritten. Change the case ID "
                    "and import again."
                )
                return
        async with self.config.guild(ctx.guild).custom_cases() as stored:
            stored[case.id] = case.to_dict()
        self._custom_case_cache.pop((ctx.guild.id, case.id), None)
        clear_background_cache(case.id)
        await ctx.send(
            f"Case `{case.id}` (**{case.title[:100]}**) imported successfully."
        )

    @enigmicset_case.command(name="export")
    @commands.admin_or_permissions(manage_guild=True)
    async def enigmicset_case_export(
        self, ctx: commands.Context, case_id: str
    ) -> None:
        """Export a case as a JSON file."""
        try:
            case = await self._get_case(ctx.guild.id, case_id)
        except CaseNotFound as exc:
            await ctx.send(str(exc))
            return
        payload = json.dumps(case.to_dict(), indent=2, ensure_ascii=False)
        file = discord.File(
            io.BytesIO(payload.encode("utf-8")), filename=f"{case_id}.json"
        )
        await ctx.send(f"Case `{case_id}`:", file=file)

    @enigmicset_case.command(name="validate")
    @commands.admin_or_permissions(manage_guild=True)
    async def enigmicset_case_validate(
        self, ctx: commands.Context, case_id: str
    ) -> None:
        """Re-run full validation (including the uniqueness solver) on a case."""
        try:
            case = await self._get_case(ctx.guild.id, case_id)
        except CaseNotFound as exc:
            await ctx.send(str(exc))
            return
        async with ctx.typing():
            _case, report = await asyncio.to_thread(
                validate_case_dict, case.to_dict()
            )
        await self._send_validation_report(ctx, report)

    async def _send_validation_report(self, ctx: commands.Context, report) -> None:
        text = report.render()
        if len(text) <= 1900:
            await ctx.send(box(text))
        else:
            file = discord.File(
                io.BytesIO(text.encode("utf-8")),
                filename=f"validation_{report.case_id}.txt",
            )
            summary = (
                f"Validation of '{report.case_id}': "
                f"{len(report.errors)} error(s), {len(report.warnings)} "
                f"warning(s) - full report attached."
            )
            await ctx.send(summary, file=file)

    @enigmicset_case.command(name="remove")
    @commands.admin_or_permissions(manage_guild=True)
    async def enigmicset_case_remove(
        self, ctx: commands.Context, case_id: str
    ) -> None:
        """Delete a custom case."""
        custom = await self.config.guild(ctx.guild).custom_cases()
        if case_id not in custom:
            if case_id in self._bundled_cases:
                await ctx.send(
                    "Bundled cases cannot be removed - use "
                    f"`{ctx.clean_prefix}enigmicset case disable {case_id}` instead."
                )
            else:
                await ctx.send(f"No custom case with ID `{case_id}` exists.")
            return
        view = ConfirmView(ctx.author.id)
        prompt = await ctx.send(f"Delete custom case `{case_id}`?", view=view)
        await view.wait()
        try:
            await prompt.edit(view=None)
        except discord.HTTPException:
            pass
        if not view.value:
            await ctx.send("Removal cancelled.")
            return
        async with self.config.guild(ctx.guild).custom_cases() as stored:
            stored.pop(case_id, None)
        self._custom_case_cache.pop((ctx.guild.id, case_id), None)
        await ctx.send(f"Custom case `{case_id}` removed.")

    @enigmicset_case.command(name="enable")
    @commands.admin_or_permissions(manage_guild=True)
    async def enigmicset_case_enable(
        self, ctx: commands.Context, case_id: str
    ) -> None:
        """Re-enable a disabled case."""
        async with self.config.guild(ctx.guild).disabled_case_ids() as disabled:
            if case_id not in disabled:
                await ctx.send(f"Case `{case_id}` is not disabled.")
                return
            disabled.remove(case_id)
        await ctx.send(f"Case `{case_id}` enabled.")

    @enigmicset_case.command(name="disable")
    @commands.admin_or_permissions(manage_guild=True)
    async def enigmicset_case_disable(
        self, ctx: commands.Context, case_id: str
    ) -> None:
        """Disable a case so it cannot be started."""
        custom = await self.config.guild(ctx.guild).custom_cases()
        if case_id not in custom and case_id not in self._bundled_cases:
            await ctx.send(f"No case with ID `{case_id}` exists.")
            return
        async with self.config.guild(ctx.guild).disabled_case_ids() as disabled:
            if case_id in disabled:
                await ctx.send(f"Case `{case_id}` is already disabled.")
                return
            disabled.append(case_id)
        await ctx.send(f"Case `{case_id}` disabled.")
