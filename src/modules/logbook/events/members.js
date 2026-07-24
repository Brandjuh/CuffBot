// Member trail: joins, leaves, nickname and role changes, bans. Join/leave/
// update events need the privileged Server Members Intent; bans need the
// (non-privileged) GuildModeration intent.
import { Events } from 'discord.js';
import { logger } from '../../../core/logger.js';
import {
  memberBanned,
  memberJoined,
  memberLeft,
  memberUnbanned,
  nicknameChanged,
  rolesChanged,
} from '../lib/logformat.js';
import { postLog } from '../service.js';

const isHome = (guild, client) => guild && guild.id === client.config.homeGuildId;

export const onMemberAdd = {
  name: Events.GuildMemberAdd,
  async execute(member) {
    try {
      if (!isHome(member.guild, member.client)) return;
      const created = member.user?.createdTimestamp;
      await postLog(
        member.guild,
        memberJoined({
          userTag: member.user?.tag ?? member.user?.username,
          userId: member.id,
          accountAgeDays: created ? Math.floor((Date.now() - created) / 86_400_000) : null,
        }),
      );
    } catch (error) {
      logger.warn('Logbook: join log failed:', error);
    }
  },
};

export const onMemberRemove = {
  name: Events.GuildMemberRemove,
  async execute(member) {
    try {
      if (!isHome(member.guild, member.client)) return;
      const roleNames = member.roles?.cache
        ? [...member.roles.cache.values()].filter((r) => r.name !== '@everyone').map((r) => r.name)
        : [];
      await postLog(
        member.guild,
        memberLeft({ userTag: member.user?.tag ?? member.user?.username, userId: member.id, roleNames }),
      );
    } catch (error) {
      logger.warn('Logbook: leave log failed:', error);
    }
  },
};

export const onMemberUpdate = {
  name: Events.GuildMemberUpdate,
  async execute(oldMember, newMember) {
    try {
      if (!isHome(newMember.guild, newMember.client)) return;
      const userTag = newMember.user?.tag ?? newMember.user?.username;
      if (!oldMember.partial && oldMember.nickname !== newMember.nickname) {
        await postLog(
          newMember.guild,
          nicknameChanged({
            userTag,
            userId: newMember.id,
            before: oldMember.nickname,
            after: newMember.nickname,
          }),
        );
      }
      if (!oldMember.partial && oldMember.roles?.cache && newMember.roles?.cache) {
        const beforeIds = new Set(oldMember.roles.cache.keys());
        const afterIds = new Set(newMember.roles.cache.keys());
        const added = [...newMember.roles.cache.values()].filter((r) => !beforeIds.has(r.id)).map((r) => r.name);
        const removed = [...oldMember.roles.cache.values()].filter((r) => !afterIds.has(r.id)).map((r) => r.name);
        if (added.length || removed.length) {
          await postLog(newMember.guild, rolesChanged({ userTag, userId: newMember.id, added, removed }));
        }
      }
    } catch (error) {
      logger.warn('Logbook: member-update log failed:', error);
    }
  },
};

export const onBanAdd = {
  name: Events.GuildBanAdd,
  async execute(ban) {
    try {
      if (!isHome(ban.guild, ban.client)) return;
      const full = ban.partial ? await ban.fetch().catch(() => ban) : ban;
      await postLog(
        ban.guild,
        memberBanned({
          userTag: full.user?.tag ?? full.user?.username,
          userId: full.user?.id,
          reason: full.reason ?? null,
        }),
      );
    } catch (error) {
      logger.warn('Logbook: ban log failed:', error);
    }
  },
};

export const onBanRemove = {
  name: Events.GuildBanRemove,
  async execute(ban) {
    try {
      if (!isHome(ban.guild, ban.client)) return;
      await postLog(
        ban.guild,
        memberUnbanned({ userTag: ban.user?.tag ?? ban.user?.username, userId: ban.user?.id }),
      );
    } catch (error) {
      logger.warn('Logbook: unban log failed:', error);
    }
  },
};
