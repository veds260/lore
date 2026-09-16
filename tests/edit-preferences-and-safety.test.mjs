import test from 'node:test';
import assert from 'node:assert/strict';

const { detectEditPreference } = await import('../lib/learning/edit-preferences.ts');
const { normalizeDraftSourceInputs } = await import('../lib/draft-sources-normalize.ts');
const tenant = await import('../lib/tenant/scope.ts');
const policy = await import('../lib/vault/workspace-policy.ts');

test('edit preference detection ignores no-op revisions', () => {
  assert.equal(detectEditPreference({ original: 'This is a post.', revised: 'This is a post.', instruction: 'make it better' }), null);
});

test('edit preference detection finds concise preference', () => {
  const suggestion = detectEditPreference({
    original: 'This is a very long setup with extra context before the point. The actual point is that founder content should be specific and useful.',
    revised: 'Founder content works when it is specific and useful.',
    instruction: 'make it shorter',
    platform: 'twitter',
  });
  assert.equal(suggestion?.reason, 'concise');
  assert.match(suggestion?.observation ?? '', /tighter/i);
});

test('edit preference detection finds grounded tone preference', () => {
  const suggestion = detectEditPreference({
    original: 'This insane game-changing secret will skyrocket your brand.',
    revised: 'This pattern can make your brand easier to trust.',
    instruction: 'less hype',
  });
  assert.equal(suggestion?.reason, 'grounded-tone');
});

test('edit preference detection finds concrete proof preference', () => {
  const suggestion = detectEditPreference({
    original: 'The campaign performed well after the team changed the hook.',
    revised: 'The campaign went from 1.2% to 3.8% CTR after the team changed the hook.',
    instruction: 'make this more specific with numbers',
  });
  assert.equal(suggestion?.reason, 'concrete-proof');
});

test('draft source normalization dedupes, clamps, and drops invalid tenant source shapes', () => {
  const rows = normalizeDraftSourceInputs([
    { noteId: 'note-1', reason: 'good', relevanceScore: 250 },
    { noteId: 'note-1', reason: 'duplicate' },
    { assetId: 'asset-1', reason: 'visual', relevanceScore: -5 },
    { noteId: 'note-2', assetId: 'asset-2' },
    { reason: 'missing ids' },
  ]);
  assert.deepEqual(rows, [
    { noteId: 'note-1', assetId: null, reason: 'good', relevanceScore: 100 },
    { noteId: null, assetId: 'asset-1', reason: 'visual', relevanceScore: 0 },
  ]);
});

test('tenant helper requires userId and brandId and detects model-visible leaks', () => {
  assert.equal(tenant.isValidTenantScope({ userId: 'user-1', brandId: 'brand-1' }), true);
  assert.equal(tenant.isValidTenantScope({ userId: 'user-1' }), false);
  assert.deepEqual(tenant.tenantPredicate({ userId: 'user-1', brandId: 'brand-1' }), { userId: 'user-1', brandId: 'brand-1' });
  assert.deepEqual(tenant.findModelVisibleIdLeaks({ title: 'ok', nested: { brandId: 'leak' } }), ['brandId']);
  assert.equal(tenant.isModelSafePayload({ title: 'ok', nested: { path: '08-memory/corrections.md' } }), true);
});

test('tenant workspace tools hide tenant identifiers from model-visible schemas', () => {
  for (const tool of policy.getTenantWorkspaceToolDefinitions()) {
    const serialized = JSON.stringify(tool.parameters ?? {});
    assert.equal(serialized.includes('tenantId'), false);
    assert.equal(serialized.includes('workspaceId'), false);
    assert.equal(serialized.includes('brandId'), false);
    assert.equal(serialized.includes('userId'), false);
  }
});
