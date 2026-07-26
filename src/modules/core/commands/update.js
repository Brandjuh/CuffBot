// `!update` — the owner's spec, S127:
//
//   "Als ik handmatig !update uitvoer wil ik dat hij update, als ik !update
//    status doe wil ik een status of we goed of achter lopen."
//
// So: bare `!update` UPDATES. `!update status` only reports. Nothing in
// between, and no path where typing `!update` produces a paragraph about
// systemd instead of an update.
//
// The mechanism is in `../updater.js`, and the header there explains why this
// no longer touches sudo or a second systemd unit. The short version: the bot
// runs the script itself and then exits, and systemd's `Restart=always` brings
// it back on the new code.
//
// Security: administrators and the guild owner only, and it runs a FIXED repo
// script with no user-supplied arguments — nothing from the message reaches a
// shell.
import { PermissionFlagsBits } from 'discord.js';
import { isAdminOrOwner } from '../../../core/prefix/permissions.js';
import { logger } from '../../../core/logger.js';
import {
  AUTO_CHECK_MS,
  RESULTS,
  applyRestart,
  describeState,
  restartPlan,
  restartPolicy,
  runUpdateScript,
  updateState,
} from '../updater.js';
import { autoUpdateEnabled, lastAutoRun, setAutoUpdate } from '../update-store.js';
import { clearUpdateMarker, getHead, writeUpdateMarker } from '../update-status.js';

// One update at a time — a second `!update` while one runs is confusion, not
// concurrency. Exported so the unattended loop shares the same lock.
export const lock = { busy: false };

/**
 * Install whatever is on origin, reporting as it goes.
 *
 * Shared by the command and the 15-minute loop, so there is exactly ONE update
 * path in the bot. Two paths is how the old design drifted: the timer's runs
 * were invisible to the half that reported on them.
 *
 * @param {object} opts
 * @param {(text:string)=>Promise<any>} [opts.onProgress] live status, if a human is waiting
 */
export async function performUpdate({ onProgress = async () => {}, guildId = null, markerFor = null } = {}) {
  if (lock.busy) return { result: 'busy', from: null, to: null };
  lock.busy = true;
  try {
    const before = getHead();
    // Remember the order NOW: a successful update exits this process, and the
    // boot reporter finishes the conversation on the other side.
    if (guildId && markerFor) {
      writeUpdateMarker(guildId, { ...markerFor, startedHead: before.head, at: Date.now() });
    }

    let sawInstall = false;
    const run = await runUpdateScript({
      onLine: (line) => {
        if (!sawInstall && /updating [0-9a-f]+ -> [0-9a-f]+/.test(line)) {
          sawInstall = true;
          onProgress('🔄 New version fetched — installing dependencies and running the test suite. This takes a few minutes on the Pi.').catch(
            () => {},
          );
        }
      },
    });

    const meaning = RESULTS[run.result] ?? RESULTS.unknown;
    if (!meaning.changed) {
      if (guildId) clearUpdateMarker(guildId);
      return { ...run, meaning };
    }

    // New code is on disk and green. Getting it RUNNING is the only step left.
    const plan = restartPlan(restartPolicy());
    const restarted = applyRestart(plan);
    return { ...run, meaning, plan, restarted };
  } finally {
    // The success path exits the process shortly after this, so releasing the
    // lock here is harmless and the failure paths genuinely need it back.
    lock.busy = false;
  }
}

export default {
  group: {
    name: 'update',
    description: 'Update the bot from GitHub — bare form installs, `status` only reports (admins only).',
    emoji: '🔄',
    invokeWithoutSubcommand: true,
    fallback: 'now',
    subcommands: [
      {
        name: 'now',
        aliases: ['install', 'run'],
        description: 'Fetch, test and install the newest version, then restart into it.',
        args: [],
        async run(ctx) {
          if (!isAdminOrOwner(ctx)) {
            await ctx.reply('🚫 Only administrators can order an update.');
            return;
          }
          if (lock.busy) {
            await ctx.reply('⏳ An update is already running — give it a few minutes.');
            return;
          }

          const status = await ctx.reply('🔄 Checking GitHub and, if there is something new, installing it…');
          const edit = (body) => Promise.resolve(status?.edit?.(body)).catch(() => {});

          const outcome = await performUpdate({
            onProgress: edit,
            guildId: ctx.guild.id,
            markerFor: { channelId: ctx.channel?.id ?? null, requesterId: ctx.user.id },
          });
          logger.info(`Manual update by ${ctx.user.tag ?? ctx.user.username}: ${outcome.result}`);

          if (outcome.result === 'up-to-date') {
            await edit(`✅ Already up to date — \`${outcome.from ?? getHead().head}\` is the latest. Nothing changed.`);
            return;
          }
          if (!outcome.meaning?.ok) {
            await edit(`🚨 **Update failed.** ${outcome.meaning?.text ?? 'Unknown error.'}\n-# Details on the Pi: \`journalctl -u cuffbot -n 60\`.`);
            return;
          }
          if (outcome.restarted) {
            await edit(
              `✅ **Installed \`${outcome.from}\` → \`${outcome.to}\`** and the tests passed. Restarting now — I will report back here the moment I am up. 🚔`,
            );
            return;
          }
          await edit(
            `⚠️ **Installed \`${outcome.from}\` → \`${outcome.to}\`, but I cannot restart myself** (${outcome.plan?.why ?? 'unknown reason'}).\n` +
              'The new code is on disk and tested; it loads on the next restart. On the Pi: `sudo systemctl restart cuffbot`.',
          );
        },
      },
      {
        name: 'status',
        aliases: ['check', 'version'],
        description: 'Are we up to date or behind? Reports only — changes nothing.',
        args: [],
        async run(ctx) {
          const state = await updateState();
          const lines = describeState(state, {
            autoOn: autoUpdateEnabled(ctx.guild.id),
            lastRun: lastAutoRun(ctx.guild.id),
            prefix: ctx.prefix,
          });
          await ctx.reply(lines.join('\n'));
        },
      },
      {
        name: 'auto',
        description: `Turn the ${AUTO_CHECK_MS / 60_000}-minute automatic update check on or off.`,
        permission: PermissionFlagsBits.ManageGuild,
        args: [{ name: 'on', type: 'boolean', required: true }],
        async run(ctx, { on }) {
          setAutoUpdate(ctx.guild.id, on);
          await ctx.reply(
            on
              ? `🔄 Automatic updates **on** — I check GitHub every ${AUTO_CHECK_MS / 60_000} minutes and install anything whose tests pass.`
              : '🔄 Automatic updates **off**. `!update` still works by hand.',
          );
        },
      },
    ],
  },
};
