import { existsSync } from 'node:fs';
import { readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

/**
 * Sets or removes lines in .env.local, the file a self-hosted install keeps its
 * settings in. A removed key is commented out rather than deleted, so nothing the
 * owner typed by hand disappears without a trace. Values must already be checked
 * to be a single safe token by the caller.
 */
export async function writeEnvLocal(updates: Record<string, string | null>): Promise<void> {
  const file = join(process.cwd(), '.env.local');
  let text = existsSync(file) ? await readFile(file, 'utf8') : '';

  for (const [key, value] of Object.entries(updates)) {
    if (!/^[A-Z][A-Z0-9_]*$/.test(key)) throw new Error(`Bad env name ${key}`);
    if (value !== null && /[\r\n]/.test(value)) throw new Error(`Bad value for ${key}`);
    const line = new RegExp(`^${key}=.*$`, 'm');

    if (value === null) {
      text = text.replace(new RegExp(`^${key}=`, 'gm'), `# replaced from the setup page: ${key}=`);
    } else if (line.test(text)) {
      text = text.replace(line, `${key}=${value}`);
    } else {
      text = `${text.trimEnd()}${text ? '\n' : ''}${key}=${value}\n`;
    }
  }

  await writeFile(file, text, { mode: 0o600 });
}
