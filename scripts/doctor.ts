/**
 * `npm run doctor` — tells you whether Lore can run, and exactly what to type
 * when it cannot. Run this before opening an issue.
 *
 * Reads the same capability registry as the in-app /setup screen, so the two
 * can never disagree.
 */
import { runChecks, canRun, type Capability } from '../lib/setup/checks';

const MARK: Record<Capability['status'], string> = {
  ok: '  ok  ',
  missing: '  --  ',
  broken: ' fail ',
  unknown: '  ?   ',
};

function render(c: Capability) {
  const req = c.required ? ' (required)' : '';
  console.log(`${MARK[c.status]}${c.label}${req}`);
  if (c.detail) console.log(`        ${c.detail}`);
  if (c.status !== 'ok') {
    if (c.unlocks) console.log(`        ${c.unlocks}`);
    for (const line of c.fix ?? []) console.log(`        ${line}`);
  }
  console.log('');
}

async function main() {
  console.log('\nLore setup check\n');

  const caps = await runChecks();
  for (const c of caps) render(c);

  const required = caps.filter((c) => c.required);
  const optionalOn = caps.filter((c) => !c.required && c.status === 'ok').length;
  const optionalTotal = caps.length - required.length;

  if (canRun(caps)) {
    console.log(`Lore is ready. ${optionalOn} of ${optionalTotal} optional features are on.\n`);
    process.exit(0);
  }

  const blocking = required.filter((c) => c.status !== 'ok').map((c) => c.label);
  console.log(`Not ready. Fix these first: ${blocking.join(', ')}\n`);
  process.exit(1);
}

main().catch((err) => {
  console.error('\nThe check itself crashed, which is a bug. Please report it:\n', err);
  process.exit(1);
});
