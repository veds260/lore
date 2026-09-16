import { mkdir, writeFile, readFile, stat, unlink } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

// Local filesystem fallback when no external object store is configured.
// Files live under <repo>/uploads/<brandId>/<id>-<safename>. They are served
// via the route handler app/api/vault/file/[...key]/route.ts.

const ROOT = path.resolve(process.cwd(), 'uploads');

function safeName(name: string): string {
  const ext = path.extname(name).toLowerCase();
  const base = path.basename(name, ext).replace(/[^a-zA-Z0-9._-]+/g, '-').slice(0, 60);
  return `${base || 'file'}${ext}`;
}

export interface StoreResult {
  storageKey: string;
  fileUrl: string;
  fileSize: number;
}

export async function storeFile(opts: {
  brandId: string;
  buffer: Buffer;
  filename: string;
}): Promise<StoreResult> {
  const id = crypto.randomUUID();
  const safe = safeName(opts.filename);
  const dir = path.join(ROOT, opts.brandId);
  await mkdir(dir, { recursive: true });
  const fileName = `${id}-${safe}`;
  const filePath = path.join(dir, fileName);
  await writeFile(filePath, opts.buffer);
  const storageKey = `${opts.brandId}/${fileName}`;
  const fileUrl = `/api/vault/file/${storageKey}`;
  return { storageKey, fileUrl, fileSize: opts.buffer.length };
}

export async function readStoredFile(storageKey: string): Promise<Buffer | null> {
  // Defense in depth: the key must contain no traversal segments
  if (storageKey.includes('..') || storageKey.startsWith('/')) return null;
  const full = path.join(ROOT, storageKey);
  if (!existsSync(full)) return null;
  try {
    const st = await stat(full);
    if (!st.isFile()) return null;
  } catch {
    return null;
  }
  return readFile(full);
}

export async function deleteStoredFile(storageKey: string): Promise<void> {
  if (storageKey.includes('..') || storageKey.startsWith('/')) return;
  const full = path.join(ROOT, storageKey);
  if (!existsSync(full)) return;
  try { await unlink(full); } catch {}
}

export function storageRoot(): string { return ROOT; }
