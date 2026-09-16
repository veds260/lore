import test from 'node:test';
import assert from 'node:assert/strict';

const policy = await import('../lib/vault/workspace-policy.ts');

test('canonical private tenant workspace files are tenant-local and stable', () => {
  const files = policy.getCanonicalWorkspaceFiles({ brandName: 'Acme Labs' });
  const paths = files.map((f) => f.path);

  assert.deepEqual(paths, [
    'AGENTS.md',
    '00-profile/voice.md',
    '00-profile/positioning.md',
    '00-profile/offer.md',
    '01-rules/writing-rules.md',
    '01-rules/banned-phrases.md',
    '01-rules/formatting.md',
    '02-stories/personal-stories.md',
    '02-stories/client-stories.md',
    '03-proof/proof-points.md',
    '04-ideas/content-angles.md',
    '05-visuals/visual-style.md',
    '05-visuals/asset-index.md',
    '06-performance/winning-patterns.md',
    '06-performance/failed-patterns.md',
    '07-interviews/knowledge-gaps.md',
    '07-interviews/question-backlog.md',
    '08-memory/corrections.md',
    '08-memory/learned-preferences.md',
    '08-memory/changelog.md',
  ]);

  assert.equal(new Set(paths).size, paths.length);
  assert.ok(files.every((f) => f.scope === 'tenant'));
  assert.ok(files.some((f) => f.body.includes('Acme Labs')));
});

test('global and tenant scopes have explicit one-way flow rules', () => {
  assert.equal(policy.canFlowIntoPrompt('global', 'tenant'), true);
  assert.equal(policy.canFlowIntoPrompt('tenant', 'same-tenant'), true);
  assert.equal(policy.canFlowIntoPrompt('tenant', 'other-tenant'), false);
  assert.equal(policy.canPromoteTenantLearningToGlobal({ anonymized: false, adminApproved: true }), false);
  assert.equal(policy.canPromoteTenantLearningToGlobal({ anonymized: true, adminApproved: false }), false);
  assert.equal(policy.canPromoteTenantLearningToGlobal({ anonymized: true, adminApproved: true }), true);
});

test('agent workspace tool schemas never expose userId, tenantId, workspaceId, or brandId to the model', () => {
  const tools = policy.getTenantWorkspaceToolDefinitions();
  assert.ok(tools.length >= 5);

  for (const tool of tools) {
    const serialized = JSON.stringify(tool.parameters ?? {});
    assert.equal(serialized.includes('tenantId'), false, `${tool.name} exposes tenantId`);
    assert.equal(serialized.includes('workspaceId'), false, `${tool.name} exposes workspaceId`);
    assert.equal(serialized.includes('brandId'), false, `${tool.name} exposes brandId`);
    assert.equal(serialized.includes('userId'), false, `${tool.name} exposes userId`);
  }
});
