import { randomBytes } from 'node:crypto';
import { copyFileSync, existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

// Runs before `next dev`. A fresh clone has no .env.local and no AUTH_SECRET, and
// env validation is strict, so without this the first `npm run dev` dies on a zod
// dump before it can tell anyone what to do. Never touches an existing value.

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

main();
