import { NextRequest, NextResponse } from 'next/server';
import { desc, eq } from 'drizzle-orm';
import { auth } from '@/lib/auth';
import { db } from '@/lib/db';
import { inviteCodes, users } from '@/lib/db/schema';
import { z } from 'zod';

function isAdmin(email: string | null | undefined): boolean {
  const adminEmail = process.env.ADMIN_EMAIL;
  if (!adminEmail || !email) return false;
  return adminEmail.split(',').map(e => e.trim().toLowerCase()).includes(email.toLowerCase());
}

const CreateSchema = z.object({
  code: z.string().min(3).max(64).regex(/^[A-Z0-9-]+$/, 'Uppercase letters, numbers, and hyphens only'),
  planTier: z.enum(['pro', 'growth', 'agency']),
  note: z.string().max(200).nullable(),
});

export async function GET() {
  const session = await auth();
  if (!isAdmin(session?.user?.email)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });

  const codes = await db
    .select({
      id: inviteCodes.id,
      code: inviteCodes.code,
      planTier: inviteCodes.planTier,
      note: inviteCodes.note,
      redeemedBy: inviteCodes.redeemedBy,
      redeemedAt: inviteCodes.redeemedAt,
      redeemedByEmail: users.email,
      redeemedByName: users.name,
      expiresAt: inviteCodes.expiresAt,
      createdAt: inviteCodes.createdAt,
    })
    .from(inviteCodes)
    .leftJoin(users, eq(inviteCodes.redeemedBy, users.id))
    .orderBy(desc(inviteCodes.createdAt));

  return NextResponse.json(codes);
}

export async function POST(req: NextRequest) {
  const session = await auth();
  if (!isAdmin(session?.user?.email)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });

  const body = await req.json().catch(() => ({}));
  const parsed = CreateSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues[0]?.message ?? 'Invalid request' }, { status: 400 });
  }

  const { code, planTier, note } = parsed.data;

  const [created] = await db.insert(inviteCodes).values({ code, planTier, note }).returning();
  return NextResponse.json(created, { status: 201 });
}
