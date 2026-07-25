// The !hammertime group (S84 = M16.11, Dumb-Cogs port): turn a natural time
// phrase into Discord <t:…> timestamps that render correctly for every
// reader. `!ht in 1 day and 12 hrs`, `!ht @officer saturday at 6:30pm`,
// `!ht 5pm list` — plus the timezone registry the conversions run on.
import { ActionRowBuilder, EmbedBuilder, PermissionFlagsBits, StringSelectMenuBuilder } from 'discord.js';
import { formatUsersTime, offsetMinutesAt } from '../lib/time.js';
import { parsePhrase } from '../lib/parse.js';
import { lookupTimezones } from '../lib/zones.js';
import {
  clearPendingPick,
  getAutoTime,
  getUserTimezone,
  resolveTimezone,
  setAutoTime,
  setPendingPick,
  setRoleTimezone,
  setUserTimezone,
} from '../service.js';

const TEAL = 0x11806a;
export const PICK_TIMEOUT_MS = 60_000; // cog used 10 s — too twitchy (deviation)
const REMOVE_VALUE = 'ht-none';

/** The cog's seven-style output block, verbatim shape. */
export function hammertimeMessage(targetMention, usersTime, ts, prefix) {
  return (
    '**Hammertime!**\n' +
    `${targetMention}'s **${usersTime}** is your\n` +
    `-# \`<t:${ts}:d>\`: <t:${ts}:d>\n` +
    `-# \`<t:${ts}:D>\`: <t:${ts}:D>\n` +
    `-# \`<t:${ts}:t>\`: <t:${ts}:t>\n` +
    `-# \`<t:${ts}:T>\`: <t:${ts}:T>\n` +
    `-# \`<t:${ts}:f>\`: <t:${ts}:f>\n` +
    `-# \`<t:${ts}:F>\`: <t:${ts}:F>\n` +
    `-# \`<t:${ts}:R>\`: <t:${ts}:R>\n` +
    `-# Not correct? make sure your timezone is set with \`${prefix}ht tz <timezone>\`\n`
  );
}

/** Open the cog's disambiguation select for a multi-zone query. */
async function promptZoneChoice(ctx, options, role) {
  const rows = [];
  const capped = options.slice(0, 119); // ≤5 select rows of 24 + the remove option
  for (let start = 0; start < capped.length; start += 24) {
    const slice = capped.slice(start, start + 24).map((zone) => ({ label: zone, value: zone }));
    if (start + 24 >= capped.length) {
      slice.push({ label: 'My timezone is not listed / Remove my timezone', value: REMOVE_VALUE });
    }
    rows.push(
      new ActionRowBuilder().addComponents(
        new StringSelectMenuBuilder()
          .setCustomId(`htz:pick:${ctx.user.id}:${start}`)
          .setPlaceholder('Select your timezone')
          .addOptions(slice),
      ),
    );
  }
  const message = await ctx.reply({ components: rows });
  if (!message) return;
  const timer = setTimeout(() => {
    clearPendingPick(ctx.user.id);
    message.edit({ content: 'Took too long.', components: [] }).catch(() => {});
  }, PICK_TIMEOUT_MS);
  timer.unref?.();
  setPendingPick(ctx.user.id, { guildId: ctx.guild.id, roleId: role?.id ?? null, roleName: role?.name ?? null, message, timer });
}

/** Apply a confirmed zone choice (or removal) for a user or a role. */
export async function applyZoneChoice(pick, userId, zone) {
  const chosen = zone === REMOVE_VALUE ? null : zone;
  if (pick.roleId) {
    setRoleTimezone(pick.guildId, pick.roleId, chosen);
    return chosen
      ? `The role **${pick.roleName}**'s timezone is now ${chosen}.`
      : `The role **${pick.roleName}**'s timezone has been unset.`;
  }
  setUserTimezone(pick.guildId, userId, chosen);
  return chosen ? `Your timezone is now ${chosen}.` : 'Your timezone has been unset.';
}

async function setZoneFlow(ctx, query, role) {
  const options = lookupTimezones(query);
  if (options.length === 0) {
    await ctx.reply('That is not a valid timezone.');
    return;
  }
  if (options.length === 1) {
    const pick = { guildId: ctx.guild.id, roleId: role?.id ?? null, roleName: role?.name ?? null };
    await ctx.reply(await applyZoneChoice(pick, ctx.user.id, options[0]));
    return;
  }
  await promptZoneChoice(ctx, options, role);
}

/** The `list` rendering: everyone with a timezone, grouped by their local
 * time for the instant, earliest first (the cog's sort compared identical
 * instants — a no-op; sorting by offset is the evident intent, fixed). */
export function buildListGroups(members, roleZonesResolver, epochMs) {
  const groups = new Map(); // formatted local time → { offset, mentions }
  for (const member of members) {
    const zone = roleZonesResolver(member);
    if (!zone) continue;
    const formatted = formatUsersTime(epochMs, zone);
    if (!groups.has(formatted)) {
      groups.set(formatted, { offset: offsetMinutesAt(epochMs, zone), members: [] });
    }
    groups.get(formatted).members.push(member);
  }
  return [...groups.entries()]
    .sort((a, b) => a[1].offset - b[1].offset)
    .map(([formatted, group]) => ({
      formatted,
      members: group.members.sort((a, b) => (a.displayName ?? '').localeCompare(b.displayName ?? '')),
    }));
}

export default {
  group: {
    name: 'hammertime',
    aliases: ['ht'],
    description: 'Turn "in 2 hours" or "saturday at 6:30pm" into timestamps that render right for everyone.',
    emoji: '⏰',
    fallback: 'time', // `!ht in 2 hours` needs no subcommand word
    status(ctx) {
      const zone = getUserTimezone(ctx.guild.id, ctx.user.id);
      return [
        `\`${ctx.prefix}ht <phrase>\` converts a time in YOUR timezone into Discord timestamps every reader sees correctly — try \`${ctx.prefix}ht in 1 day and 12 hrs\`, \`${ctx.prefix}ht saturday at 6:30pm\`, \`${ctx.prefix}ht now\`. Put a member first to read it in THEIR timezone; add the word \`list\` to see everyone's local time.`,
        '',
        zone
          ? `**Your timezone:** ${zone}`
          : `**Your timezone:** not set — \`${ctx.prefix}ht tz <city, zone or abbreviation>\` first.`,
        `**Auto-convert:** ${getAutoTime(ctx.guild.id) ? 'on — messages with "at 5" / "in 20 min" get a quiet timestamp reply' : 'off'}`,
      ];
    },
    subcommands: [
      {
        name: 'time',
        aliases: ['for'],
        description: 'Convert a phrase (optionally for another member: `!ht @officer 5pm`).',
        args: [{ name: 'phrase', type: 'string', required: true, greedy: true }],
        async run(ctx, { phrase }) {
          let target = ctx.member;
          let text = phrase;
          const lead = /^(?:<@!?(\d+)>|(\d{15,21}))(?:\s+|$)/.exec(text);
          if (lead) {
            const id = lead[1] ?? lead[2];
            const member = await ctx.guild.members.fetch(id).catch(() => null);
            if (member) {
              target = member;
              text = text.slice(lead[0].length);
            }
          }
          const listEveryone = /\blist\b/i.test(text);
          text = text.replace(/\blist\b/gi, '').trim() || 'now';

          const pre = target.id === ctx.user.id ? 'You have' : `<@${target.id}> has`;
          const resolved = resolveTimezone(ctx.guild.id, target.id, [...(target.roles?.cache?.keys() ?? [])]);
          if (resolved.error === 'none') {
            await ctx.reply(`${pre} no timezone set. Use \`${ctx.prefix}ht tz <timezone>\` to set your timezone.`);
            return;
          }
          if (resolved.error === 'ambiguous') {
            await ctx.reply(`${pre} multiple timezone roles. Use \`${ctx.prefix}ht tz <timezone>\` to set your timezone.`);
            return;
          }
          const parsed = parsePhrase(text, resolved.zone, Date.now());
          if (!parsed) {
            await ctx.reply("I couldn't understand that");
            return;
          }
          const usersTime = formatUsersTime(parsed.epochMs, resolved.zone);
          const ts = Math.floor(parsed.epochMs / 1000);
          await ctx.reply(hammertimeMessage(`<@${target.id}>`, usersTime, ts, ctx.prefix));

          if (!listEveryone) return;
          const groups = buildListGroups(
            [...ctx.guild.members.cache.values()].filter((m) => !m.user.bot),
            (member) => {
              const r = resolveTimezone(ctx.guild.id, member.id, [...member.roles.cache.keys()]);
              return r.zone ?? null;
            },
            parsed.epochMs,
          );
          if (groups.length === 0) {
            await ctx.reply('Nobody here has a timezone set yet.');
            return;
          }
          let description = '';
          for (const group of groups) {
            const block = `**${group.formatted}**\n${'-'.repeat(32)}\n${group.members.map((m) => `-# <@${m.id}>`).join('\n')}\n\n`;
            if (description.length + block.length > 3900) {
              description += '…and more.';
              break;
            }
            description += block;
          }
          await ctx.reply({
            embeds: [
              new EmbedBuilder()
                .setColor(TEAL)
                .setTitle(`@${target.displayName}'s ${usersTime} is`)
                .setDescription(description.trimEnd()),
            ],
            allowedMentions: { parse: [] },
          });
        },
      },
      {
        name: 'tz',
        aliases: ['timezone'],
        description: 'Set your timezone — a city (new york), a zone (Europe/Amsterdam), an abbreviation, or utc+2.',
        args: [{ name: 'zone', type: 'string', required: true, greedy: true }],
        async run(ctx, { zone }) {
          await setZoneFlow(ctx, zone, null);
        },
      },
      {
        name: 'role',
        description: "Give a role a default timezone — members without their own setting inherit it.",
        permission: PermissionFlagsBits.ManageRoles,
        args: [
          { name: 'role', type: 'role', required: true },
          { name: 'zone', type: 'string', required: true, greedy: true },
        ],
        async run(ctx, { role, zone }) {
          await setZoneFlow(ctx, zone, role);
        },
      },
      {
        name: 'auto',
        description: 'Toggle auto-converting chat messages containing "at 5" / "in 20 min" (quiet replies).',
        permission: PermissionFlagsBits.ManageGuild,
        args: [{ name: 'state', type: 'boolean', required: false }],
        async run(ctx, { state }) {
          const next = state ?? !getAutoTime(ctx.guild.id);
          setAutoTime(ctx.guild.id, next);
          await ctx.reply(next ? 'Time auto-converting is now on.' : 'Time auto-converting is now off.');
        },
      },
    ],
  },
};
