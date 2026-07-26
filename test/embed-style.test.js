// Embed style guard (S114, owner: "Sommige teksten zijn veelste groot, zelfs
// een blinde kan die lezen, dit mag wel wat kleiner").
//
// Discord renders `# ` as H1 — by far the largest text it can produce. Four
// embeds used it for a donut amount, which turned a payout into a billboard.
// This is a taste decision, and taste decisions are exactly the ones that come
// back: the next session writing an embed has no way to know H1 was rejected
// unless something says so out loud.
//
// So the rule is enforced, not documented: no source file may emit an H1 or H2
// in user-facing text. `### ` (H3) is the largest allowed heading, and `-# `
// (subtext, the SMALLEST thing Discord renders) stays free — heist uses it for
// XP footnotes and that is the opposite problem.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');

function jsFilesUnder(dir) {
  const out = [];
  for (const name of readdirSync(dir)) {
    const full = path.join(dir, name);
    if (statSync(full).isDirectory()) out.push(...jsFilesUnder(full));
    else if (name.endsWith('.js')) out.push(full);
  }
  return out;
}

/**
 * An H1/H2 that Discord would actually render.
 *
 * Discord only treats `#` as a heading at the START of a line, so the match is
 * anchored to a line start or an escaped newline inside a template literal.
 * `-# ` (subtext) must not match, hence the guard on the preceding character.
 */
const BIG_HEADING = /(^|\\n|`|')(#{1,2}) [^\n]/;

test('no source file emits an H1 or H2 — those are Discord’s biggest text', () => {
  const offenders = [];
  for (const file of jsFilesUnder(path.join(repoRoot, 'src'))) {
    const lines = readFileSync(file, 'utf8').split('\n');
    lines.forEach((line, i) => {
      const code = line.trimStart();
      // Skip comments: a markdown heading in a doc comment renders nowhere.
      if (code.startsWith('//') || code.startsWith('*') || code.startsWith('/*')) return;
      if (line.includes('-#')) return; // subtext, the opposite problem
      if (BIG_HEADING.test(line)) {
        offenders.push(`${path.relative(repoRoot, file)}:${i + 1}: ${line.trim()}`);
      }
    });
  }
  assert.deepEqual(
    offenders,
    [],
    `Use \`### \` (H3) or bold instead — H1/H2 read as shouting in a Discord embed:\n${offenders.join('\n')}`,
  );
});

test('the economy headline helper is H3, and every big number goes through it', async () => {
  const { headline, gold } = await import('../src/modules/economy/lib/bank.js');
  // Spelled out rather than compared against the helper's own output, so this
  // can actually disagree with it (S111 / skill 0.5.35).
  assert.equal(headline('+500 🍩'), '### +500 🍩');
  assert.equal(gold(1500), '1,500 🍩');
  assert.equal(headline(gold(1500)), '### 1,500 🍩');

  // The four call sites the owner was looking at must use the helper, not a
  // literal heading of their own.
  for (const rel of ['src/modules/economy/commands/steal.js', 'src/modules/economy/commands/pot.js']) {
    const source = readFileSync(path.join(repoRoot, rel), 'utf8');
    assert.match(source, /headline\(/, `${rel} should build its big number with headline()`);
  }
});
