import { auth } from '@/lib/auth';
import { notFound } from 'next/navigation';
import { db } from '@/lib/db';
import { visualInspirations } from '@/lib/db/schema';
import { asc } from 'drizzle-orm';
import { VisualsClient } from '@/components/admin/visuals-client';

function isAdmin(email: string | null | undefined): boolean {
  const adminEmail = process.env.ADMIN_EMAIL;
  if (!adminEmail || !email) return false;
  return adminEmail.split(',').map(e => e.trim().toLowerCase()).includes(email.toLowerCase());
}

export default async function AdminVisualsPage() {
  const session = await auth();
  if (!isAdmin(session?.user?.email)) notFound();

  const rows = await db
    .select()
    .from(visualInspirations)
    .orderBy(asc(visualInspirations.sortOrder), asc(visualInspirations.createdAt));

  return (
    <VisualsClient
      initial={rows.map(r => ({ ...r, createdAt: r.createdAt.toISOString() }))}
    />
  );
}
