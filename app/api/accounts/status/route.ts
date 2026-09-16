import { NextResponse } from 'next/server';
import { auth } from '@/lib/auth';
import { db } from '@/lib/db';
import { accountConnections } from '@/lib/db/schema';
import { eq } from 'drizzle-orm';

export async function GET() {
  const session = await auth();
  if (!session?.user?.id) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const rows = await db
    .select({ platform: accountConnections.platform, lastVerifiedAt: accountConnections.lastVerifiedAt })
    .from(accountConnections)
    .where(eq(accountConnections.userId, session.user.id));

  const twitter = rows.find(r => r.platform === 'twitter');
  const linkedin = rows.find(r => r.platform === 'linkedin');

  return NextResponse.json({
    twitter: !!twitter,
    linkedin: !!linkedin,
    twitterVerifiedAt: twitter?.lastVerifiedAt ?? null,
    linkedinVerifiedAt: linkedin?.lastVerifiedAt ?? null,
  });
}
