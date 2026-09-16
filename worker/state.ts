// Worker-owned state, isolated in the `agent` Postgres schema.
//
// These tables are created with idempotent raw SQL at boot instead of drizzle
// migrations because the repo's migration journal is out of sync with the live
// DB (0002-0012 were applied out-of-band). Keeping worker state in its own
// schema means `drizzle-kit` never sees it and can't produce garbage diffs.
//
// Tenancy rule (see lib/tenant/scope.ts): every read/write here carries BOTH
// userId and brandId explicitly. There is no "current brand" anywhere in the
// worker. A chat is bound to exactly one brand, and the binding row is the
// single source of tenant identity for everything that chat triggers.

import { sql } from 'drizzle-orm';
import { db } from '@/lib/db';
import { isValidTenantScope } from '@/lib/tenant/scope';

export interface ChatBinding {
  chatId: string;
  userId: string;
  brandId: string;
  brandName: string;
  briefHour: number;
  eveningHour: number;
  paused: boolean;
}

export interface OnboardingRow {
  chatId: string;
  step: string;
  data: Record<string, unknown>;
}

export async function bootstrapAgentSchema(): Promise<void> {
  await db.execute(sql`CREATE SCHEMA IF NOT EXISTS agent`);
  await db.execute(sql`
    CREATE TABLE IF NOT EXISTS agent.kv (
      key text PRIMARY KEY,
      value text NOT NULL
    )`);
  await db.execute(sql`
    CREATE TABLE IF NOT EXISTS agent.chat_bindings (
      chat_id text PRIMARY KEY,
      user_id text NOT NULL,
      brand_id uuid NOT NULL,
      brand_name text NOT NULL DEFAULT '',
      brief_hour int NOT NULL DEFAULT 8,
      evening_hour int NOT NULL DEFAULT 20,
      paused boolean NOT NULL DEFAULT false,
      created_at timestamptz NOT NULL DEFAULT now(),
      updated_at timestamptz NOT NULL DEFAULT now()
    )`);
  await db.execute(sql`
    CREATE TABLE IF NOT EXISTS agent.onboarding (
      chat_id text PRIMARY KEY,
      step text NOT NULL,
      data jsonb NOT NULL DEFAULT '{}',
      updated_at timestamptz NOT NULL DEFAULT now()
    )`);
  // Idempotency log for proactive sends. One row per (brand, ritual, day);
  // the INSERT is the claim, so two ticks (or two replicas) can't double-send.
  await db.execute(sql`
    CREATE TABLE IF NOT EXISTS agent.ritual_log (
      brand_id uuid NOT NULL,
      ritual text NOT NULL,
      day date NOT NULL,
      status text NOT NULL,
      updated_at timestamptz NOT NULL DEFAULT now(),
      PRIMARY KEY (brand_id, ritual, day)
    )`);
  // Per-brand daily operation counter. The atomic increment IS the budget gate.
  await db.execute(sql`
    CREATE TABLE IF NOT EXISTS agent.spend (
      brand_id uuid NOT NULL,
      day date NOT NULL,
      ops int NOT NULL DEFAULT 0,
      PRIMARY KEY (brand_id, day)
    )`);
}

function rows(result: unknown): Record<string, unknown>[] {
  // drizzle + postgres-js: db.execute returns an array-like RowList
  return result as unknown as Record<string, unknown>[];
}

// ---------- kv ----------

export async function kvGet(key: string): Promise<string | null> {
  const r = rows(await db.execute(sql`SELECT value FROM agent.kv WHERE key = ${key}`));
  return (r[0]?.value as string) ?? null;
}

export async function kvSet(key: string, value: string): Promise<void> {
  await db.execute(sql`
    INSERT INTO agent.kv (key, value) VALUES (${key}, ${value})
    ON CONFLICT (key) DO UPDATE SET value = ${value}`);
}

// ---------- chat bindings ----------

function toBinding(r: Record<string, unknown>): ChatBinding {
  return {
    chatId: String(r.chat_id),
    userId: String(r.user_id),
    brandId: String(r.brand_id),
    brandName: String(r.brand_name ?? ''),
    briefHour: Number(r.brief_hour ?? 8),
    eveningHour: Number(r.evening_hour ?? 20),
    paused: Boolean(r.paused),
  };
}

export async function getBinding(chatId: string): Promise<ChatBinding | null> {
  const r = rows(await db.execute(sql`SELECT * FROM agent.chat_bindings WHERE chat_id = ${chatId}`));
  return r[0] ? toBinding(r[0]) : null;
}

export async function listBindings(): Promise<ChatBinding[]> {
  const r = rows(await db.execute(sql`SELECT * FROM agent.chat_bindings`));
  return r.map(toBinding);
}

export async function setBinding(
  chatId: string,
  scope: { userId: string; brandId: string },
  brandName: string,
): Promise<void> {
  if (!isValidTenantScope(scope)) throw new Error('setBinding: invalid tenant scope');
  await db.execute(sql`
    INSERT INTO agent.chat_bindings (chat_id, user_id, brand_id, brand_name)
    VALUES (${chatId}, ${scope.userId}, ${scope.brandId}, ${brandName})
    ON CONFLICT (chat_id) DO UPDATE
      SET user_id = ${scope.userId}, brand_id = ${scope.brandId},
          brand_name = ${brandName}, updated_at = now()`);
}

export async function updateBindingHours(chatId: string, briefHour: number, eveningHour: number): Promise<void> {
  await db.execute(sql`
    UPDATE agent.chat_bindings
    SET brief_hour = ${briefHour}, evening_hour = ${eveningHour}, updated_at = now()
    WHERE chat_id = ${chatId}`);
}

export async function setPaused(chatId: string, paused: boolean): Promise<void> {
  await db.execute(sql`
    UPDATE agent.chat_bindings SET paused = ${paused}, updated_at = now() WHERE chat_id = ${chatId}`);
}

// ---------- onboarding ----------

export async function getOnboarding(chatId: string): Promise<OnboardingRow | null> {
  const r = rows(await db.execute(sql`SELECT * FROM agent.onboarding WHERE chat_id = ${chatId}`));
  if (!r[0]) return null;
  return {
    chatId: String(r[0].chat_id),
    step: String(r[0].step),
    data: (r[0].data as Record<string, unknown>) ?? {},
  };
}

export async function setOnboarding(chatId: string, step: string, data: Record<string, unknown>): Promise<void> {
  await db.execute(sql`
    INSERT INTO agent.onboarding (chat_id, step, data)
    VALUES (${chatId}, ${step}, ${JSON.stringify(data)}::jsonb)
    ON CONFLICT (chat_id) DO UPDATE
      SET step = ${step}, data = ${JSON.stringify(data)}::jsonb, updated_at = now()`);
}

export async function clearOnboarding(chatId: string): Promise<void> {
  await db.execute(sql`DELETE FROM agent.onboarding WHERE chat_id = ${chatId}`);
}

// ---------- ritual idempotency ----------

// Try to claim today's send for (brand, ritual). Returns true when this caller
// owns the send. A fresh 'started' row blocks everyone else; rows stuck in
// 'started' for >15min or marked 'error' can be re-claimed on a later tick.
export async function claimRitual(brandId: string, ritual: string, day: string): Promise<boolean> {
  const r = rows(await db.execute(sql`
    INSERT INTO agent.ritual_log (brand_id, ritual, day, status)
    VALUES (${brandId}, ${ritual}, ${day}::date, 'started')
    ON CONFLICT (brand_id, ritual, day) DO UPDATE
      SET status = 'started', updated_at = now()
      WHERE agent.ritual_log.status = 'error'
         OR (agent.ritual_log.status = 'started' AND agent.ritual_log.updated_at < now() - interval '15 minutes')
    RETURNING status`));
  return r.length > 0;
}

export async function finishRitual(brandId: string, ritual: string, day: string, status: 'sent' | 'error' | 'skipped'): Promise<void> {
  await db.execute(sql`
    UPDATE agent.ritual_log SET status = ${status}, updated_at = now()
    WHERE brand_id = ${brandId} AND ritual = ${ritual} AND day = ${day}::date`);
}

// ---------- budget ----------

// Atomically consume one operation from the brand's daily budget.
// Returns ops used today, or null when the brand is over its cap (nothing consumed).
export async function consumeBudget(brandId: string, cap: number): Promise<number | null> {
  const r = rows(await db.execute(sql`
    INSERT INTO agent.spend (brand_id, day, ops) VALUES (${brandId}, current_date, 1)
    ON CONFLICT (brand_id, day) DO UPDATE
      SET ops = agent.spend.ops + 1
      WHERE agent.spend.ops < ${cap}
    RETURNING ops`));
  return r.length > 0 ? Number(r[0].ops) : null;
}

export async function budgetUsedToday(brandId: string): Promise<number> {
  const r = rows(await db.execute(sql`
    SELECT ops FROM agent.spend WHERE brand_id = ${brandId} AND day = current_date`));
  return r[0] ? Number(r[0].ops) : 0;
}
