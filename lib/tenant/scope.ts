// Pure tenant-scope predicates.
//
// Every tenant-owned resource (drafts, vault notes, vault assets, corrections,
// skills) must be queried with BOTH userId and brandId. Global rules are the
// only resources allowed to skip brand scoping. These helpers express that
// invariant in one place and keep it unit-testable: no DB, no `@/` imports.

export interface TenantResourceScope {
  userId: string;
  brandId: string;
}

// IDs that route a request to a tenant. They must never appear in anything we
// hand to the model (tool params, prompt context). The model addresses the
// vault through opaque paths/titles, not tenant-routing identifiers.
export const MODEL_VISIBLE_ID_KEYS = ['userId', 'brandId', 'tenantId', 'workspaceId'] as const;

/**
 * Build the canonical WHERE-shape used to scope a tenant resource query.
 * Returns exactly { userId, brandId } and nothing else, so callers can spread
 * it into a Drizzle `and(eq(...userId), eq(...brandId))` consistently.
 */
export function tenantPredicate(scope: { userId: string; brandId: string }): TenantResourceScope {
  return { userId: scope.userId, brandId: scope.brandId };
}

/**
 * A tenant resource scope is valid only when BOTH userId and brandId are
 * present, non-empty strings. Anything missing brandId is a global/unscoped
 * value and must not be used to read or write tenant-owned rows.
 */
export function isValidTenantScope(scope: unknown): scope is TenantResourceScope {
  if (!scope || typeof scope !== 'object') return false;
  const s = scope as Record<string, unknown>;
  return (
    typeof s.userId === 'string' && s.userId.trim().length > 0 &&
    typeof s.brandId === 'string' && s.brandId.trim().length > 0
  );
}

/**
 * Walk an arbitrary object/array and report any tenant-routing ID keys it
 * carries. Used to assert that model-facing payloads never leak userId,
 * brandId, tenantId, or workspaceId. Returns the distinct offending keys.
 */
export function findModelVisibleIdLeaks(obj: unknown): string[] {
  const found = new Set<string>();
  const seen = new Set<unknown>();
  const keySet = new Set<string>(MODEL_VISIBLE_ID_KEYS);

  const walk = (node: unknown) => {
    if (!node || typeof node !== 'object') return;
    if (seen.has(node)) return; // guard against cycles
    seen.add(node);
    if (Array.isArray(node)) {
      for (const item of node) walk(item);
      return;
    }
    for (const [k, v] of Object.entries(node as Record<string, unknown>)) {
      if (keySet.has(k)) found.add(k);
      walk(v);
    }
  };

  walk(obj);
  return [...found];
}

/**
 * True when a payload is safe to expose to the model, i.e. it carries no
 * tenant-routing identifiers anywhere in its shape.
 */
export function isModelSafePayload(obj: unknown): boolean {
  return findModelVisibleIdLeaks(obj).length === 0;
}
