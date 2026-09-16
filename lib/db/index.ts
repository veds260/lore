import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import { env } from '@/lib/env';
import * as schema from './schema';

// Keep pool small, Railway hobby Postgres allows ~25 connections total.
// Next.js spawns multiple Node workers; leave headroom for migrations and admin.
const client = postgres(env.DATABASE_URL, {
  prepare: false,
  max: 5,
  idle_timeout: 20,
  connect_timeout: 10,
});
export const db = drizzle(client, { schema });

export * from './schema';
