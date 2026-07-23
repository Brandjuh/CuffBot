// Leveled console logger — the single place to swap in a real transport later.
const levels = { debug: 10, info: 20, warn: 30, error: 40 };
const threshold = levels[process.env.LOG_LEVEL ?? 'info'] ?? levels.info;

function log(level, ...args) {
  if (levels[level] < threshold) return;
  const sink = level === 'debug' ? 'log' : level;
  console[sink](`[${new Date().toISOString()}] [${level.toUpperCase()}]`, ...args);
}

export const logger = {
  debug: (...args) => log('debug', ...args),
  info: (...args) => log('info', ...args),
  warn: (...args) => log('warn', ...args),
  error: (...args) => log('error', ...args),
};
