import { redirect } from 'next/navigation';
import { auth } from '@/lib/auth';
import { GLOBAL_RULES } from '@/lib/global-rules';
import { mirrorSelfLearningIntoVault } from '@/lib/vault/sync';
import { listTenantAssets, listTenantVaultNotes, resolveTenantScope } from '@/lib/vault/workspace';
import { VaultClient } from '@/components/vault/vault-client';
import { EmptyState } from '@/components/ui/empty-state';
import { Archive } from 'lucide-react';

export default async function VaultPage() {
  const session = await auth();
  if (!session?.user?.id) redirect('/login');

  const scope = await resolveTenantScope(session.user.id);
  if (!scope) {
    return (
      <div className="p-8 lg:p-10 w-full">
        <div className="mb-8">
          <h1 className="text-2xl font-semibold tracking-tight">Vault</h1>
          <p className="text-sm text-muted-foreground mt-1">Your Obsidian-powered brand memory.</p>
        </div>
        <EmptyState
          variant="fullHeight"
          icon={Archive}
          title="Create a brand first"
          description="Lore needs an active brand before it can build a tenant vault, mirror self-learning rules, or tag visuals."
          primary={{ label: 'Start onboarding', href: '/onboarding' }}
        />
      </div>
    );
  }

  const mirrorSummary = await mirrorSelfLearningIntoVault({ userId: scope.userId, brandId: scope.brandId }).catch(() => null);

  const [notes, assets] = await Promise.all([
    listTenantVaultNotes(scope, { limit: 300 }),
    listTenantAssets(scope, { limit: 300 }),
  ]);

  return (
    <VaultClient
      initialNotes={notes.map(n => ({
        id: n.id,
        title: n.title,
        type: n.type,
        tags: n.tags,
        topics: n.topics,
        summary: n.summary,
        source: n.source,
        status: n.status,
        updatedAt: n.updatedAt.toISOString(),
      }))}
      initialAssets={assets.map(a => ({
        id: a.id,
        originalFilename: a.originalFilename,
        fileUrl: a.fileUrl,
        thumbnailUrl: a.thumbnailUrl,
        tags: a.tags,
        topics: a.topics,
        usableFor: a.usableFor,
        doNotUseFor: a.doNotUseFor,
        visualStyle: a.visualStyle,
        sensitivity: a.sensitivity,
        captionSummary: a.captionSummary,
        status: a.status,
        createdAt: a.createdAt.toISOString(),
      }))}
      globalRulesCount={GLOBAL_RULES.length}
      mirrorSummary={mirrorSummary}
    />
  );
}
