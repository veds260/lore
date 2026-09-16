import crypto from 'node:crypto';
import { db } from '@/lib/db';
import { vaultNotes } from '@/lib/db/schema';
import { and, eq, desc, inArray, isNull } from 'drizzle-orm';
import { writeFrontmatter } from './frontmatter';

type NoteType = 'rule' | 'story' | 'belief' | 'proof' | 'idea' | 'post' | 'visual' | 'profile';

export interface UpsertNoteInput {
  userId: string;
  brandId: string | null;
  path: string;
  title: string;
  type: NoteType;
  tags?: string[];
  topics?: string[];
  summary?: string;
  body?: string;
  source?: string;
  status?: 'active' | 'archived' | 'needs_review';
  frontmatter?: Record<string, unknown>;
  sourceRefType?: string | null;
  sourceRefId?: string | null;
  scope?: 'global' | 'tenant';
}

function hash(body: string | undefined): string {
  return crypto.createHash('sha1').update(body ?? '').digest('hex');
}

// Insert or update by scoped workspace path. Returns the row id.
export async function upsertVaultNote(input: UpsertNoteInput): Promise<string> {
  const contentHash = hash(input.body);
  const now = new Date();
  const noteScope = input.scope ?? (input.brandId ? 'tenant' : 'global');
  const data = {
    userId: input.userId,
    brandId: input.brandId,
    scope: noteScope,
    path: input.path,
    title: input.title,
    type: input.type,
    tags: input.tags ?? [],
    topics: input.topics ?? [],
    summary: input.summary ?? null,
    body: input.body ?? null,
    frontmatter: input.frontmatter ?? {},
    source: input.source ?? 'manual',
    status: input.status ?? 'active',
    contentHash,
    sourceRefType: input.sourceRefType ?? null,
    sourceRefId: input.sourceRefId ?? null,
    updatedAt: now,
  };

  const [existing] = await db
    .select({ id: vaultNotes.id })
    .from(vaultNotes)
    .where(and(
      eq(vaultNotes.scope, noteScope),
      eq(vaultNotes.userId, input.userId),
      eq(vaultNotes.path, input.path),
      input.brandId !== null ? eq(vaultNotes.brandId, input.brandId) : isNull(vaultNotes.brandId),
    ))
    .limit(1);
  if (existing) {
    await db.update(vaultNotes).set(data).where(eq(vaultNotes.id, existing.id));
    return existing.id;
  }
  const [row] = await db.insert(vaultNotes).values(data).returning({ id: vaultNotes.id });
  return row.id;
}

export async function deleteVaultNote(noteId: string, userId: string): Promise<boolean> {
  const res = await db
    .delete(vaultNotes)
    .where(and(eq(vaultNotes.id, noteId), eq(vaultNotes.userId, userId)))
    .returning({ id: vaultNotes.id });
  return res.length > 0;
}

export async function listVaultNotes(opts: {
  brandId: string;
  types?: NoteType[];
  status?: 'active' | 'archived' | 'needs_review';
  limit?: number;
}) {
  const conditions = [eq(vaultNotes.brandId, opts.brandId)];
  if (opts.types?.length) conditions.push(inArray(vaultNotes.type, opts.types));
  if (opts.status) conditions.push(eq(vaultNotes.status, opts.status));
  return db
    .select()
    .from(vaultNotes)
    .where(and(...conditions))
    .orderBy(desc(vaultNotes.updatedAt))
    .limit(opts.limit ?? 200);
}

// Render the note as an Obsidian-style markdown document (frontmatter + body).
export function renderNoteMarkdown(note: {
  title: string;
  type: NoteType | string;
  tags: string[] | null;
  topics: string[] | null;
  summary: string | null;
  body: string | null;
  status: string;
  source: string;
  frontmatter?: Record<string, unknown> | null;
  createdAt: Date | string;
  updatedAt: Date | string;
}): string {
  const fm: Record<string, unknown> = {
    type: note.type,
    tags: note.tags ?? [],
    topics: note.topics ?? [],
    status: note.status,
    source: note.source,
    created_at: typeof note.createdAt === 'string' ? note.createdAt : note.createdAt.toISOString(),
    updated_at: typeof note.updatedAt === 'string' ? note.updatedAt : note.updatedAt.toISOString(),
    ...(note.frontmatter ?? {}),
  };
  const body = `# ${note.title}\n\n${note.summary ? note.summary + '\n\n' : ''}${note.body ?? ''}`.trim();
  return writeFrontmatter(fm, body);
}
