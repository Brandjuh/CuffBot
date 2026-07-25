// Restart the bot from Discord — for when the owner edits .env (API keys,
// overrides) and needs the process to re-read it without SSH. The restart
// kills this process mid-command, so the order is remembered in the store and
// core's update-report boot event posts "Restart complete" where it was typed.
//
// Mechanics: `sudo -n systemctl restart cuffbot` matches the EXACT sudoers
// rule setup-pi.sh installs (arguments are part of the rule — no flags may be
// added). Once systemd accepts the job it survives this process's death.
// Fallback without sudoers: exit(1) — the unit runs Restart=on-failure with
// RestartSec=5, so a failure exit is revived by systemd within seconds.
//
// Security: admin/guild-owner only; a fixed command with no user input.
//
// S96 (M17.3 slice D): converted to the flat { command } shape. The gate is
// checked inside run() rather than declared as `permission`, because it also
// admits the GUILD OWNER, who may not hold the Administrator flag —
// `isAdminOrOwner` is shared with !update.
import { spawn } from 'node:child_process';
import { isAdminOrOwner } from '../../../core/prefix/permissions.js';
import { logger } from '../../../core/logger.js';
import { getHead, writeUpdateMarker } from '../update-status.js';

function triggerRestart() {
  const viaService = spawn('sudo', ['-n', 'systemctl', 'restart', 'cuffbot'], {
    stdio: 'ignore',
    detached: true,
  });
  let fellBack = false;
  const fallback = () => {
    if (fellBack) return;
    fellBack = true;
    logger.warn('Restart: sudo path unavailable — exiting so systemd revives the service (Restart=on-failure).');
    setTimeout(() => process.exit(1), 1_500).unref?.();
  };
  viaService.on('error', fallback);
  viaService.on('exit', (code) => {
    if (code !== 0) fallback();
  });
  viaService.unref();
}

export default {
  command: {
    name: 'restart',
    description: 'Restart the bot to reload its configuration/.env (admins only).',
    emoji: '🔄',
    args: [],
    async run(ctx) {
      if (!isAdminOrOwner(ctx)) {
        await ctx.reply('🚫 Only administrators can order a restart.');
        return;
      }

      // Remember the order first — the restart kills this process, and the boot
      // reporter finishes the conversation in this channel.
      writeUpdateMarker(ctx.guild.id, {
        channelId: ctx.channel?.id ?? null,
        requesterId: ctx.user.id,
        startedHead: getHead().head ?? 'unknown',
        at: Date.now(),
        kind: 'restart',
      });
      await ctx.reply(
        '🔄 Restarting to reload the configuration (`.env`) — back in a moment, I will report here. 🚔',
      );
      logger.info(`Restart ordered by ${ctx.user.tag ?? ctx.user.username}.`);
      triggerRestart();
    },
  },
};
