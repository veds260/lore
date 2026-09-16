import { NextResponse } from 'next/server';
import { auth } from '@/lib/auth';
import { db } from '@/lib/db';
import { brands } from '@/lib/db/schema';
import { and, desc, eq } from 'drizzle-orm';
import { generateIdeasFromLatestInterview } from '@/lib/interview-engine';
import { getActiveBrandId } from '@/lib/active-brand';

export async function GET() {
  const session = await auth();
  if (!session?.user?.id) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const activeBrandId = await getActiveBrandId(session.user.id);
  const brand = activeBrandId ? { id: activeBrandId } : null;

  if (!brand) return NextResponse.json({ ideas: [], hasInterviewData: false });

  const ideas = await generateIdeasFromLatestInterview(brand.id);

  if (!ideas || ideas.length === 0) {
    return NextResponse.json({ ideas: [], hasInterviewData: false });
  }

  return NextResponse.json({ ideas, hasInterviewData: true });
}
