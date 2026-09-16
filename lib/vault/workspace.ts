import { and, desc, eq, inArray } from 'drizzle-orm';
import { getActiveBrandId } from '@/lib/active-brand';
import { db } from '@/lib/db';
import { brands, vaultAssets, vaultNotes } from '@/lib/db/schema';
import { upsertVaultNote } from './notes';
import { getCanonicalWorkspaceFiles, type CanonicalWorkspaceFile } from './workspace-policy';

export interface TenantScope {
  userId: string;
  brandId: string;
  brandName: string;
}

export type VaultNoteType = 'rule' | 'story' | 'belief' | 'proof' | 'idea' | 'post' | 'visual' | 'profile';
export type VaultNoteStatus = 'active' | 'archived' | 'needs_review';

export async function resolveTenantScope(userId: string): Promise<TenantScope | null> {
  const brandId = await getActiveBrandId(userId);
  if (!brandId) return null;
  return verifyTenantBrandScope(userId, brandId);
}

export async function verifyTenantBrandScope(userId: string, brandId: string): Promise<TenantScope | null> {
  const [brand] = await db
    .select({ id: brands.id, name: brands.name })
    .from(brands)
    .where(and(eq(brands.id, brandId), eq(brands.userId, userId), eq(brands.isActive, true)))
    .limit(1);

  if (!brand) return null;
  return { userId, brandId: brand.id, brandName: brand.name };
}

export async function ensureCanonicalWorkspace(scope: TenantScope): Promise<{ createdOrUpdated: number; files: CanonicalWorkspaceFile[] }> {
  const files = getCanonicalWorkspaceFiles({ brandName: scope.brandName });
  let createdOrUpdated = 0;

  for (const f of files) {
    const existing = await readTenantWorkspaceFile(scope, f.path);
    if (existing) continue;

    await upsertVaultNote({
      userId: scope.userId,
      brandId: scope.brandId,
      scope: 'tenant',
      path: f.path,
      title: f.title,
      type: f.type,
      tags: f.tags,
      topics: [],
      summary: f.summary,
      body: f.body,
      source: 'workspace_seed',
      status: 'active',
      frontmatter: { scope: 'tenant', canonical: true },
    });
    createdOrUpdated += 1;
  }

  return { createdOrUpdated, files };
}

export async function listTenantVaultNotes(scope: TenantScope, opts: {
  types?: VaultNoteType[];
  status?: VaultNoteStatus;
  limit?: number;
} = {}) {
  const conditions = [
    eq(vaultNotes.scope, 'tenant'),
    eq(vaultNotes.userId, scope.userId),
    eq(vaultNotes.brandId, scope.brandId),
  ];
  if (opts.types?.length) conditions.push(inArray(vaultNotes.type, opts.types));
  if (opts.status) conditions.push(eq(vaultNotes.status, opts.status));

  return db.select().from(vaultNotes)
    .where(and(...conditions))
    .orderBy(desc(vaultNotes.updatedAt))
    .limit(opts.limit ?? 300);
}

export async function listGlobalVaultRules(opts: { limit?: number } = {}) {
  return db.select().from(vaultNotes)
    .where(and(
      eq(vaultNotes.scope, 'global'),
      eq(vaultNotes.type, 'rule'),
      eq(vaultNotes.status, 'active'),
    ))
    .orderBy(desc(vaultNotes.updatedAt))
    .limit(opts.limit ?? 80);
}

export async function readTenantWorkspaceFile(scope: TenantScope, path: string) {
  const [row] = await db.select().from(vaultNotes)
    .where(and(
      eq(vaultNotes.scope, 'tenant'),
      eq(vaultNotes.userId, scope.userId),
      eq(vaultNotes.brandId, scope.brandId),
      eq(vaultNotes.path, path),
    ))
    .limit(1);
  return row ?? null;
}

export async function appendTenantLearningObservation(scope: TenantScope, observation: string, sourceEvent?: string): Promise<string> {
  const canonical = getCanonicalWorkspaceFiles({ brandName: scope.brandName })
    .find(f => f.path === '08-memory/corrections.md');
  const existing = await readTenantWorkspaceFile(scope, '08-memory/corrections.md');
  const timestamp = new Date().toISOString();
  const entry = `\n\n## ${timestamp}${sourceEvent ? ` · ${sourceEvent}` : ''}\n\n${observation.trim()}\n`;
  const body = `${existing?.body ?? canonical?.body ?? '# Corrections'}${entry}`;

  return upsertVaultNote({
    userId: scope.userId,
    brandId: scope.brandId,
    scope: 'tenant',
    path: '08-memory/corrections.md',
    title: canonical?.title ?? `${scope.brandName} corrections`,
    type: 'rule',
    tags: ['memory', 'corrections'],
    summary: 'Raw edit/correction observations before consolidation.',
    body,
    source: 'agent_memory',
    status: 'active',
    frontmatter: { scope: 'tenant', canonical: true, last_source_event: sourceEvent ?? null },
  });
}

export async function listTenantAssets(scope: TenantScope, opts: { limit?: number } = {}) {
  return db.select().from(vaultAssets)
    .where(and(
      eq(vaultAssets.userId, scope.userId),
      eq(vaultAssets.brandId, scope.brandId),
    ))
    .orderBy(desc(vaultAssets.createdAt))
    .limit(opts.limit ?? 120);
}
