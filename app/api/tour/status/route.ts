import { NextResponse } from 'next/server';
import { eq } from 'drizzle-orm';
import { auth } from '@/lib/auth';
import { db } from '@/lib/db';
import { users } from '@/lib/db/schema';

export async function GET() {
  const session = await auth();
  if (!session?.user?.id) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const [user] = await db
    .select({
      tourCompletedAt: users.tourCompletedAt,
      drawerTourCompletedAt: users.drawerTourCompletedAt,
    })
    .from(users)
    .where(eq(users.id, session.user.id))
    .limit(1);

  return NextResponse.json({
    mainCompleted: !!user?.tourCompletedAt,
    drawerCompleted: !!user?.drawerTourCompletedAt,
  });
}
