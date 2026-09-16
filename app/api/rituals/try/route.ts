import { NextRequest, NextResponse } from 'next/server';
import { eq } from 'drizzle-orm';
import { auth } from '@/lib/auth';
import { db } from '@/lib/db';
import { users } from '@/lib/db/schema';
import { sendMessage } from '@/lib/telegram';
import { activeBrandFor, buildEveningReport, buildMorningBrief, saveLastIdeas } from '@/lib/briefs';

export const maxDuration = 120;

// Run a single ritual right now for the current user. Sends to Telegram when
// linked, and always returns the body so the page can show a preview.
export async function POST(req: NextRequest) {
  const session = await auth();
  if (!session?.user?.id) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const body = await req.json().catch(() => ({}));
  const ritual = body?.ritual as string | undefined;
  if (ritual !== 'morning_brief' && ritual !== 'evening_report') {
    return NextResponse.json({ error: 'Invalid ritual' }, { status: 400 });
  }

  const brand = await activeBrandFor(session.user.id);
  if (!brand) {
    return NextResponse.json({ ok: false, reason: 'no-brand', preview: null, sentToTelegram: false });
  }

  const brief = ritual === 'morning_brief'
    ? await buildMorningBrief(session.user.id, brand.id, brand.name)
    : await buildEveningReport(session.user.id, brand.id, brand.name);

  if (!brief) {
    return NextResponse.json({ ok: true, reason: 'nothing-to-say', preview: null, sentToTelegram: false });
  }

  const [user] = await db
    .select({ telegramChatId: users.telegramChatId })
    .from(users)
    .where(eq(users.id, session.user.id))
    .limit(1);

  let sentToTelegram = false;
  if (user?.telegramChatId) {
    await sendMessage(user.telegramChatId, brief.body);
    if (ritual === 'morning_brief') {
      await saveLastIdeas(session.user.id, 'daily', brief.ideas);
    }
    sentToTelegram = true;
  }

  return NextResponse.json({ ok: true, preview: brief.body, sentToTelegram });
}
