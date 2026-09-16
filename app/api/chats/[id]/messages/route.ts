import { NextRequest, NextResponse } from 'next/server';
import { auth } from '@/lib/auth';
import { db } from '@/lib/db';
import { chatConversations, chatMessages } from '@/lib/db/schema';
import { eq, and, asc } from 'drizzle-orm';

async function verifyOwnership(userId: string, convId: string) {
  const [convo] = await db
    .select({ id: chatConversations.id })
    .from(chatConversations)
    .where(and(eq(chatConversations.id, convId), eq(chatConversations.userId, userId)))
    .limit(1);
  return !!convo;
}

export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await auth();
  if (!session?.user?.id) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { id } = await params;
  if (!(await verifyOwnership(session.user.id, id))) {
    return NextResponse.json({ error: 'Not found' }, { status: 404 });
  }

  const messages = await db
    .select()
    .from(chatMessages)
    .where(eq(chatMessages.conversationId, id))
    .orderBy(asc(chatMessages.createdAt));

  return NextResponse.json(messages);
}

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await auth();
  if (!session?.user?.id) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { id } = await params;
  if (!(await verifyOwnership(session.user.id, id))) {
    return NextResponse.json({ error: 'Not found' }, { status: 404 });
  }

  const { role, text, posts, isQuestion } = await req.json().catch(() => ({}));
  if (!role) return NextResponse.json({ error: 'role required' }, { status: 400 });

  const [msg] = await db
    .insert(chatMessages)
    .values({ conversationId: id, role, text: text ?? null, posts: posts ?? null, isQuestion: !!isQuestion })
    .returning({ id: chatMessages.id });

  return NextResponse.json({ id: msg.id });
}
