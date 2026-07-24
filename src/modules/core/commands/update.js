// Manually trigger the self-updater from Discord — WITH feedback where you
// typed it. This spawns the same test-gated update path the timer uses
// (scripts/update.sh: fetch → tests → deploy-commands → restart), so a manual
// update is exactly as safe as an automatic one: a red test suite rolls back
// and the running bot is untouched.
//
// Feedback loop: while this process lives we poll the on-disk commit and edit
// the reply (nothing new / fetched, tests running / tests failed, rolled
// back). The success restart kills this process mid-poll — so the order is
// remembered in the store, and core's update-report event posts the final
// "back on duty" message right after boot.
//
// Security: gated to administrators / the guild owner, and it runs a FIXED
// repo script with no user-supplied arguments — nothing from the message
// reaches a shell. Reliable operation wants the systemd update unit + a
// sudoers drop-in (setup-pi.sh step 8 arranges both); without them it falls
// back to a detached script run.
import { spawn } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { MessageFlags, PermissionFlagsBits, SlashCommandBuilder } from 'discord.js';
import { logger } from '../../../core/logger.js';
import {
  classifyPollTick,
  clearUpdateMarker,
  getHead,
  writeUpdateMarker,
} from '../update-status.js';

const REPO_DIR = path.resolve(fileURLToPath(new URL('../../../../', import.meta.url)));
const POLL_MS = 5_000;
const POLL_LIMIT_MS = 3 * 60_000; // fetch+install+tests comfortably fit; then we stop editing

function triggerUpdate() {
  // Preferred: the dedicated systemd unit runs outside the bot's own cgroup,
  // so the update's service-restart cannot kill the update mid-run.
  const viaService = spawn(
    'sudo',
    ['-n', 'systemctl', 'start', '--no-block', 'cuffbot-update.service'],
    { stdio: 'ignore', detached: true },
  );
  let fellBack = false;
  const fallback = () => {
    if (fellBack) return;
    fellBack = true;
    const child = spawn('bash', [path.join(REPO_DIR, 'scripts', 'update.sh')], {
      cwd: REPO_DIR,
      stdio: 'ignore',
      detached: true,
    });
    child.on('error', (err) => logger.error('Manual update fallback failed:', err));
    child.unref();
  };
  viaService.on('error', fallback);
  viaService.on('exit', (code) => {
    if (code !== 0) fallback();
  });
  viaService.unref();
}

// One update order at a time — a second /update while one runs is confusion,
// not concurrency.
let inFlight = false;

export default {
  data: new SlashCommandBuilder()
    .setName('update')
    .setDescription('Update the bot from GitHub: fetch, run the tests, restart when green (admins only).')
    .setDefaultMemberPermissions(PermissionFlagsBits.Administrator),
  async execute(interaction) {
    const isOwner = interaction.guild?.ownerId === interaction.user.id;
    const isAdmin = interaction.memberPermissions?.has(PermissionFlagsBits.Administrator);
    if (!isAdmin && !isOwner) {
      await interaction.reply({
        content: '🚫 Only administrators can order an update.',
        flags: MessageFlags.Ephemeral,
      });
      return;
    }
    if (inFlight) {
      await interaction.reply({
        content: '⏳ An update check is already running — give it a minute.',
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    const started = getHead();
    if (!started.head) {
      await interaction.reply({
        content: '🚫 Cannot read the current version (git unavailable?) — update from the Pi instead: `bash scripts/update.sh`.',
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    inFlight = true;
    // Remember the order NOW: if the update succeeds, the restart kills this
    // process and the boot reporter finishes the conversation.
    writeUpdateMarker(interaction.guild.id, {
      channelId: interaction.channel?.id ?? null,
      requesterId: interaction.user.id,
      startedHead: started.head,
      at: Date.now(),
    });

    await interaction.reply({
      content: `🔄 On it. Current version: \`${started.head}\`. Fetching from GitHub — if there is something new **and its tests pass**, I restart into it and report back here.`,
    });
    triggerUpdate();
    logger.info(`Manual update ordered by ${interaction.user.tag ?? interaction.user.username}.`);

    // Live status while this process survives (no-update and rollback paths).
    let previousHead = started.head;
    let announcedFetch = false;
    const startedAt = Date.now();
    const timer = setInterval(async () => {
      try {
        const current = getHead().head;
        if (!current) return;
        const state = classifyPollTick(started.head, previousHead, current);
        previousHead = current;

        if (state === 'fetched' && !announcedFetch) {
          announcedFetch = true;
          await interaction
            .editReply(`🔄 New version fetched: \`${started.head}\` → \`${current}\` — installing and running the test suite. Restart imminent if it goes green… 🚔`)
            .catch(() => {});
        } else if (state === 'rolled-back') {
          stop();
          clearUpdateMarker(interaction.guild.id);
          await interaction
            .editReply(`🚨 The new version FAILED its tests and was rolled back — still safely on \`${started.head}\`. Details: \`journalctl -u cuffbot-update -n 30\` on the Pi.`)
            .catch(() => {});
        } else if (Date.now() - startedAt > POLL_LIMIT_MS) {
          stop();
          clearUpdateMarker(interaction.guild.id);
          await interaction
            .editReply(announcedFetch
              ? `🔄 Still busy after ${Math.round(POLL_LIMIT_MS / 60_000)} min — check \`journalctl -u cuffbot-update -n 30\` on the Pi.`
              : `✅ Already up to date — \`${started.head}\` is the latest version. Nothing changed.`)
            .catch(() => {});
        }
      } catch (error) {
        logger.warn('Update poll failed:', error);
      }
    }, POLL_MS);
    const stop = () => {
      clearInterval(timer);
      inFlight = false;
    };
    timer.unref?.();
  },
};
