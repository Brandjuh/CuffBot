// Live Bail Out windows, keyed by the attempt message id (M26.3a).
//
// Its own module purely to break a cycle: the command posts the attempt and
// registers it, the pump reads it when the button is pressed. If either owned
// the Map the two would import each other, and an ESM cycle that happens to
// work today is a trap for whoever edits it next.
const attempts = new Map();

export function trackAttempt(messageId) {
  const record = { bailed: false, settled: false };
  attempts.set(messageId, record);
  return record;
}

export const getAttempt = (messageId) => attempts.get(messageId) ?? null;
export const forgetAttempt = (messageId) => attempts.delete(messageId);
export const clearAttempts = () => attempts.clear();
