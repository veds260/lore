import { NextResponse } from 'next/server';
import { auth } from '@/lib/auth';
import { db } from '@/lib/db';
import { users } from '@/lib/db/schema';
import { eq } from 'drizzle-orm';
import { generateLinkToken, startLink, botUsername } from '@/lib/telegram';

export async function POST() {
  const session = await auth();
  if (!session?.user?.id) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  if (!process.env.TELEGRAM_BOT_TOKEN || !process.env.TELEGRAM_BOT_USERNAME) {
    return NextResponse.json({ error: 'Telegram bot not configured' }, { status: 503 });
  }

  const token = generateLinkToken();

  await db.update(users)
    .set({ telegramLinkToken: token, updatedAt: new Date() })
    .where(eq(users.id, session.user.id));

  return NextResponse.json({
    url: startLink(token),
    botUsername: botUsername(),
    expiresInMinutes: 30,
  });
}

export async function GET() {
  const session = await auth();
  if (!session?.user?.id) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const [user] = await db
    .select({
      telegramChatId: users.telegramChatId,
      telegramLinkedAt: users.telegramLinkedAt,
    })
    .from(users)
    .where(eq(users.id, session.user.id))
    .limit(1);

  return NextResponse.json({
    linked: !!user?.telegramChatId,
    linkedAt: user?.telegramLinkedAt?.toISOString() ?? null,
    botUsername: botUsername(),
  });
}
