// Manually trigger the self-updater from Discord. This spawns the same
// test-gated update path the timer uses (scripts/update.sh: fetch → tests →
// restart), so a manual update is exactly as safe as an automatic one — a red
// test suite rolls back and the running bot is untouched.
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

const REPO_DIR = path.resolve(fileURLToPath(new URL('../../../../', import.meta.url)));

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

export default {
  data: new SlashCommandBuilder()
    .setName('update')
    .setDescription('Check for a newer version and restart into it if its tests pass (admins only).')
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

    await interaction.reply({
      content:
        '🔄 Checking for updates. If `main` is ahead **and its tests pass**, I will restart into the new version — otherwise nothing changes. ' +
        'Progress: `journalctl -u cuffbot-update -f`.',
    });
    triggerUpdate();
    logger.info(`Manual update ordered by ${interaction.user.tag ?? interaction.user.username}.`);
  },
};
