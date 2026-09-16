import { readdirSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import type { WorkerPlugin } from './types';

export type { WorkerPlugin, TickContext } from './types';

// Every other file in this folder is a plugin with a default export. Drop a file
// in to add a command, an onboarding step or a daily job without touching the
// core worker.

const SKIP = new Set(['index.ts', 'types.ts']);

let loaded: Promise<WorkerPlugin[]> | null = null;

async function load(): Promise<WorkerPlugin[]> {
  const dir = join(process.cwd(), 'worker', 'plugins');
  let files: string[] = [];
  try {
    files = readdirSync(dir).filter((f) => /\.(ts|mts|js|mjs)$/.test(f) && !SKIP.has(f) && !f.endsWith('.d.ts'));
  } catch {
    return [];
  }

  const plugins: WorkerPlugin[] = [];
  for (const file of files.sort()) {
    try {
      const mod = await import(pathToFileURL(join(dir, file)).href);
      const plugin = (mod.default ?? mod) as WorkerPlugin;
      if (plugin && typeof plugin.name === 'string') plugins.push(plugin);
    } catch (err) {
      console.error(`[agent:plugins] could not load ${file}:`, err instanceof Error ? err.message : err);
    }
  }
  if (plugins.length) console.log(`[agent:plugins] loaded ${plugins.map((p) => p.name).join(', ')}`);
  return plugins;
}

export function loadPlugins(): Promise<WorkerPlugin[]> {
  if (!loaded) loaded = load();
  return loaded;
}
