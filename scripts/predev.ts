import { spawn } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { createRequire } from 'node:module';
import { copyFileSync, existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

// Runs before `next dev`. A fresh clone has no .env.local and no AUTH_SECRET, and
// env validation is strict, so without this the first `npm run dev` dies on a zod
// dump before it can tell anyone what to do. Never touches an existing value.
//
// With --dev it then starts `next dev` bound to this computer only. Until someone
// claims a fresh install, its setup page is open to whoever reaches it, so it should
// not be reachable from the rest of the network by default. LORE_HOST=0.0.0.0 opens it up.

const root = process.cwd();
const local = join(root, '.env.local');
const example = join(root, '.env.example');

function generated(): string {
  return randomBytes(32).toString('base64');
}

function main() {
  if (process.env.NODE_ENV === 'production') return;

  const did: string[] = [];

  if (!existsSync(local)) {
    if (!existsSync(example)) {
      console.error('No .env.local and no .env.example to copy. Pull the repo again.');
      process.exit(1);
    }
    copyFileSync(example, local);
    did.push('created .env.local from .env.example');
  }

  let text = readFileSync(local, 'utf8');
  const line = text.match(/^AUTH_SECRET=(.*)$/m);
  const value = line?.[1]?.trim() ?? '';

  if (value.length < 32) {
    const secret = generated();
    text = line
      ? text.replace(/^AUTH_SECRET=.*$/m, `AUTH_SECRET=${secret}`)
      : `${text.trimEnd()}\nAUTH_SECRET=${secret}\n`;
    writeFileSync(local, text);
    did.push('generated AUTH_SECRET');
  }

  if (did.length) {
    process.stdout.write(`\n  Setup: ${did.join(', ')}.\n`);
  }
}

function startDev() {
  const host = process.env.LORE_HOST?.trim() || '127.0.0.1';
  const next = createRequire(join(root, 'package.json')).resolve('next/dist/bin/next');
  const child = spawn(process.execPath, [next, 'dev', '-H', host, ...process.argv.slice(3)], { stdio: 'inherit' });
  for (const signal of ['SIGINT', 'SIGTERM'] as const) {
    process.on(signal, () => child.kill(signal));
  }
  child.on('exit', (code, signal) => process.exit(code ?? (signal ? 1 : 0)));
}

main();
if (process.argv[2] === '--dev') startDev();
