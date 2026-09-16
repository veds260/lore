import { NextRequest, NextResponse } from 'next/server';
import { auth } from '@/lib/auth';
import { db } from '@/lib/db';
import { chatConversations } from '@/lib/db/schema';
import { eq, desc } from 'drizzle-orm';

export async function GET() {
  const session = await auth();
  if (!session?.user?.id) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const convos = await db
    .select({ id: chatConversations.id, title: chatConversations.title, createdAt: chatConversations.createdAt })
    .from(chatConversations)
    .where(eq(chatConversations.userId, session.user.id))
    .orderBy(desc(chatConversations.createdAt))
    .limit(50);

  return NextResponse.json(convos);
}

export async function POST(req: NextRequest) {
  const session = await auth();
  if (!session?.user?.id) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { title } = await req.json().catch(() => ({}));
  if (!title?.trim()) return NextResponse.json({ error: 'title required' }, { status: 400 });

  const [convo] = await db
    .insert(chatConversations)
    .values({ userId: session.user.id, title: String(title).slice(0, 80) })
    .returning({ id: chatConversations.id });

  return NextResponse.json({ id: convo.id });
}
