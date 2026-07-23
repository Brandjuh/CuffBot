// Pure embed construction for the evidence locker and dispatch announcements —
// no discord.js imports. Returns plain APIEmbed objects (discord.js accepts
// these directly in `embeds: [...]`), so formatting is fully testable.

const ENFORCEMENT_META = {
  citation: { label: 'Citation', badge: '📋', color: 0xf3bfc9 },
  detainment: { label: 'Detainment', badge: '🚔', color: 0xe08a3c },
  arrest: { label: 'Arrest', badge: '🚨', color: 0xcc3a3a },
  release: { label: 'Release', badge: '🔓', color: 0x4caf6a },
};

/**
 * Build the evidence-locker embed for an enforcement action.
 * @param {{ type:string, subject:string, officer:string, reason?:string|null,
 *           caseNumber?:number|null, fields?:Array<{name,value,inline?}> }} action
 * @returns {object} APIEmbed
 */
export function enforcementEmbed({ type, subject, officer, reason, caseNumber = null, fields = [] }) {
  const meta = ENFORCEMENT_META[type];
  if (!meta) throw new Error(`Unknown enforcement type "${type}"`);
  const head = [
    { name: 'Officer', value: officer, inline: true },
    ...(caseNumber != null
      ? [{ name: 'Case', value: `#${String(caseNumber).padStart(4, '0')}`, inline: true }]
      : []),
  ];
  return {
    title: `${meta.badge} ${meta.label}`,
    color: meta.color,
    description: `Subject: ${subject}`,
    fields: [...head, ...fields, { name: 'Reason', value: reason?.trim() ? reason : 'No reason given' }],
  };
}

/** Build the announcement embed for /dispatch. */
export function announcementEmbed({ message, officer }) {
  return {
    title: '📣 Dispatch',
    color: 0x5865f2,
    description: message,
    footer: { text: `Issued by ${officer}` },
  };
}
