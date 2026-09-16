import { NextRequest, NextResponse } from 'next/server';
import { auth } from '@/lib/auth';
import { synthesizeInterview } from '@/lib/interview-engine';

function isAdmin(email: string | null | undefined): boolean {
  const adminEmail = process.env.ADMIN_EMAIL;
  if (!adminEmail || !email) return false;
  return adminEmail.split(',').map(e => e.trim().toLowerCase()).includes(email.toLowerCase());
}

export async function POST(req: NextRequest) {
  const session = await auth();
  if (!isAdmin(session?.user?.email)) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  const { sessionId } = await req.json().catch(() => ({})) as { sessionId?: string };
  if (!sessionId) return NextResponse.json({ error: 'sessionId required' }, { status: 400 });

  try {
    await synthesizeInterview(sessionId);
    return NextResponse.json({ ok: true });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : String(e) }, { status: 500 });
  }
}
