// Opening a game (M26.2b): the half of `!connect4` and `!tictactoe` that is
// identical, extracted so the two command files differ only in their rules.
//
// The command exists only to OPEN the panel. Everything after that happens on
// the panel itself — which is the correction this whole milestone is: the
// source cog is panel-driven, and S71/S100 shipped a command per action.
import { newGame as newConnect4 } from '../lib/connect4.js';
import { newGame as newTicTacToe } from '../lib/tictactoe.js';
import { affordabilityCheck, botMoveIfDue, payloadFor, refundStakes, stakeFor, takeStakes } from '../runtime.js';
import { channelAvailability, createSession, getGame, seatOf, touch } from '../service.js';

const NEW_STATE = { connect4: newConnect4, tictactoe: newTicTacToe };

const money = (n) => Number(n).toLocaleString('en-US');

/**
 * `!<game> [opponent]` — put a panel in the channel.
 *
 * @param {object} ctx      the command context
 * @param {string} game     'connect4' | 'tictactoe'
 * @param {object} spec     { emoji, label, selfChallenge }
 */
export async function openGame(ctx, game, spec, opponent = null) {
  const availability = channelAvailability(ctx.channel.id);
  if (!availability.ok) {
    await ctx.reply(
      `${spec.emoji} A game is already running in this channel. It can be replaced after **${availability.minutesLeft} more minute${availability.minutesLeft === 1 ? '' : 's'}** of inactivity.`,
    );
    return;
  }

  if (opponent && opponent.id === ctx.user.id) {
    await ctx.reply(`${spec.emoji} You cannot challenge yourself. Leave the name off to play the bot.`);
    return;
  }
  if (opponent?.bot && opponent.id !== ctx.client.user.id) {
    await ctx.reply(`${spec.emoji} That is another bot. Leave the name off to play me.`);
    return;
  }

  const againstBot = !opponent || opponent.id === ctx.client.user.id;
  const me = { id: ctx.user.id, name: ctx.member?.displayName ?? ctx.user.username, bot: false };
  const them = againstBot
    ? { id: ctx.client.user.id, name: ctx.client.user.username, bot: true }
    : { id: opponent.id, name: opponent.displayName ?? opponent.username, bot: false };

  // The cog checks affordability BEFORE the panel goes up, so an invitation is
  // never sent for a game that cannot be paid for. The stakes themselves are
  // taken on accept.
  const players = [me, them];
  const afford = await affordabilityCheck(ctx.guild.id, players, { againstBot });
  if (!afford.ok) {
    await ctx.reply(
      afford.shortId === ctx.user.id
        ? `${spec.emoji} The buy-in is **${money(afford.need)} 🍩** and you have **${money(afford.have)}**.`
        : `${spec.emoji} <@${afford.shortId}> cannot cover the **${money(afford.need)} 🍩** buy-in.`,
    );
    return;
  }

  // The challenger takes seat 0, which is also how the cog seats a human
  // against the bot.
  const session = createSession({
    channelId: ctx.channel.id,
    guildId: ctx.guild.id,
    players,
    againstBot,
    game,
    state: NEW_STATE[game](),
    stake: stakeFor(ctx.guild.id, { againstBot }),
  });

  // A bot game is accepted on creation, so its stakes are due immediately.
  if (againstBot) {
    const taken = await takeStakes(session);
    if (!taken.ok) {
      session.finished = true;
      session.cancelled = true;
      await ctx.reply(`${spec.emoji} The buy-in is **${money(taken.need)} 🍩** and you have **${money(taken.have)}**.`);
      return;
    }
    // The starting player is random, so the bot may have to open.
    await botMoveIfDue(session);
  }

  const message = await ctx.reply(payloadFor(session));
  session.messageId = message?.id ?? null;
}

/**
 * `!<game> end` — stop the game in this channel.
 *
 * Named `endGameHere` rather than `endGame` because `service.js` already
 * exports an `endGame(channelId)` that drops a session from the registry.
 * Two different things with one name in one module is a trap for the next
 * session, not a convenience for this one.
 *
 * A game ended before anyone moved refunds the stakes; one abandoned mid-play
 * does not, because the cog's `cancel()` awards the win to the other player and
 * a surrender that costs nothing is not a surrender.
 */
export async function endGameHere(ctx, spec) {
  const game = getGame(ctx.channel.id);
  if (!game || game.finished) {
    await ctx.reply(`${spec.emoji} No game is running here.`);
    return;
  }
  // Anyone may end a STALE game — the cog's rule, and the reason it needs no
  // timers. A live game may only be ended by its players.
  const stale = channelAvailability(ctx.channel.id).reason === 'stale';
  if (!stale && seatOf(game, ctx.user.id) < 0) {
    await ctx.reply(`${spec.emoji} Only the players can end a game that is still being played.`);
    return;
  }

  const refunded = game.state.time === 0 ? await refundStakes(game) : [];
  game.cancelled = true;
  game.finished = true;
  touch(game);
  await ctx.reply(
    refunded.length > 0
      ? `${spec.emoji} Game ended before it started — **${money(refunded[0].delta)} 🍩** back to each player.`
      : `${spec.emoji} Game ended.`,
  );
}
