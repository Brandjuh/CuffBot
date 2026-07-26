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
// S96 (M17.3 slice D): converted to the flat { command } shape.
//
// Security: gated to administrators / the guild owner, and it runs a FIXED
// repo script with no user-supplied arguments — nothing from the message
// reaches a shell. Reliable operation wants the systemd update unit + a
// sudoers drop-in (setup-pi.sh step 8 arranges both); without them it falls
// back to a detached script run.
import { spawn } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { isAdminOrOwner } from '../../../core/prefix/permissions.js';
import { logger } from '../../../core/logger.js';
import {
  behindOrigin,
  classifyPollTick,
  clearUpdateMarker,
  getHead,
  stalledUpdateReport,
  updaterUnitStatus,
  writeUpdateMarker,
} from '../update-status.js';

const REPO_DIR = path.resolve(fileURLToPath(new URL('../../../../', import.meta.url)));
const POLL_MS = 5_000;
// S120: was 3 min, sized when the suite was ~350 tests with no dependencies.
// It is 1,087 tests plus an `npm install` now, and a Pi is far slower than the
// build container — three minutes reported healthy updates as broken ones.
const POLL_LIMIT_MS = 12 * 60_000;

/** How quickly a non-zero exit still means "sudo refused" rather than "the unit failed". */
const SUDO_REFUSAL_MS = 5_000;

function triggerUpdate() {
  // Preferred: the dedicated systemd unit runs outside the bot's own cgroup,
  // so the update's service-restart cannot kill the update mid-run.
  //
  // ⚠️ The argument list must match the sudoers rule setup-pi.sh writes
  // EXACTLY. sudo matches the whole command line, so the `--no-block` this
  // used to pass meant the rule
  //   NOPASSWD: /usr/bin/systemctl start cuffbot-update.service
  // never matched — `sudo -n` refused every time and the preferred path had
  // silently never worked since S7. The fallback hid it: updates still
  // happened, just always down the slower route. If you add a flag here, add
  // it to the sudoers line in the same commit or it will break again the same
  // invisible way.
  const startedAt = Date.now();
  const viaService = spawn('sudo', ['-n', 'systemctl', 'start', 'cuffbot-update.service'], {
    stdio: 'ignore',
    detached: true,
  });
  let fellBack = false;
  const fallback = (why) => {
    if (fellBack) return;
    fellBack = true;
    logger.warn(`Update: systemd path unavailable (${why}); running scripts/update.sh directly.`);
    const child = spawn('bash', [path.join(REPO_DIR, 'scripts', 'update.sh')], {
      cwd: REPO_DIR,
      stdio: 'ignore',
      detached: true,
    });
    child.on('error', (err) => logger.error('Manual update fallback failed:', err));
    child.unref();
  };
  viaService.on('error', () => fallback('spawn failed'));
  viaService.on('exit', (code) => {
    if (code === 0) return;
    // Without `--no-block`, `systemctl start` on a Type=oneshot unit blocks
    // until the update FINISHES — so a late non-zero exit is the update's own
    // failure (red tests, rolled back), and re-running it would repeat the
    // whole thing. Only a fast refusal means sudo turned us away.
    if (Date.now() - startedAt < SUDO_REFUSAL_MS) fallback(`sudo exited ${code}`);
    else logger.warn(`Update: the update service finished with code ${code} — see journalctl -u cuffbot-update.`);
  });
  viaService.unref();
}

// One update order at a time — a second !update while one runs is confusion,
// not concurrency.
let inFlight = false;

export default {
  command: {
    name: 'update',
    description:
      'Update the bot from GitHub: fetch, run the tests, restart when green (admins only).',
    emoji: '🔄',
    // The gate lives in run(): it also admits the GUILD OWNER, who may not
    // carry the Administrator flag, which `permission` cannot express.
    args: [],
    async run(ctx) {
      if (!isAdminOrOwner(ctx)) {
        await ctx.reply('🚫 Only administrators can order an update.');
        return;
      }
      if (inFlight) {
        await ctx.reply('⏳ An update check is already running — give it a minute.');
        return;
      }

      const started = getHead();
      if (!started.head) {
        await ctx.reply(
          '🚫 Cannot read the current version (git unavailable?) — update from the Pi instead: `bash scripts/update.sh`.',
        );
        return;
      }

      inFlight = true;
      // Remember the order NOW: if the update succeeds, the restart kills this
      // process and the boot reporter finishes the conversation.
      writeUpdateMarker(ctx.guild.id, {
        channelId: ctx.channel?.id ?? null,
        requesterId: ctx.user.id,
        startedHead: started.head,
        at: Date.now(),
      });

      // ctx.reply hands back the sent Message, so the live status edits that
      // one message instead of needing the interaction's editReply.
      const status = await ctx.reply(
        `🔄 On it. Current version: \`${started.head}\`. Fetching from GitHub — if there is something new **and its tests pass**, I restart into it and report back here.`,
      );
      const edit = (body) => Promise.resolve(status?.edit?.(body)).catch(() => {});

      triggerUpdate();
      logger.info(`Manual update ordered by ${ctx.user.tag ?? ctx.user.username}.`);

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
            await edit(
              `🔄 New version fetched: \`${started.head}\` → \`${current}\` — installing and running the test suite. Restart imminent if it goes green… 🚔`,
            );
          } else if (state === 'rolled-back') {
            stop();
            clearUpdateMarker(ctx.guild.id);
            await edit(
              `🚨 The new version FAILED its tests and was rolled back — still safely on \`${started.head}\`. Details: \`journalctl -u cuffbot-update -n 30\` on the Pi.`,
            );
          } else if (Date.now() - startedAt > POLL_LIMIT_MS) {
            stop();
            clearUpdateMarker(ctx.guild.id);
            if (announcedFetch) {
              await edit(
                `🔄 Still busy after ${Math.round(POLL_LIMIT_MS / 60_000)} min — check \`journalctl -u cuffbot-update -n 30\` on the Pi.`,
              );
            } else {
              // Nothing moved on disk. "Up to date" is only true if origin
              // agrees — an updater that never STARTED looks identical from
              // here, so check before claiming success.
              const { behind } = await behindOrigin();
              await edit(
                behind === 0
                  ? `✅ Already up to date — \`${started.head}\` is the latest version. Nothing changed.`
                  : behind === null
                    ? '⚠️ Could not verify against GitHub (network/credentials?) — run `npm run doctor` on the Pi; it names the problem.'
                    : // S120: ASK systemd rather than asserting a cause. This used to
                      // claim "the updater never ran", which it had no way to know.
                      stalledUpdateReport(updaterUnitStatus(), behind, Math.round(POLL_LIMIT_MS / 60_000)),
              );
            }
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
  },
};
