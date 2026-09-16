import { NextResponse } from 'next/server';
import { auth } from '@/lib/auth';
import { db } from '@/lib/db';
import { brands, users } from '@/lib/db/schema';
import { and, desc, eq } from 'drizzle-orm';
import { getActiveBrandId } from '@/lib/active-brand';

export async function GET() {
  const session = await auth();
  if (!session?.user?.id) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const [user] = await db
    .select({ name: users.name, image: users.image, planTier: users.planTier })
    .from(users)
    .where(eq(users.id, session.user.id))
    .limit(1);

  const activeBrandId = await getActiveBrandId(session.user.id);
  const [brand] = activeBrandId ? await db
    .select({
      id: brands.id,
      name: brands.name,
      handle: brands.handle,
      linkedinHandle: brands.linkedinHandle,
      avatarUrl: brands.avatarUrl,
      niche: brands.niche,
      voiceSummary: brands.voiceSummary,
      selectedCategories: brands.selectedCategories,
      weeklyFocus: brands.weeklyFocus,
      contentStyle: brands.contentStyle,
      allowUnhingedMode: brands.allowUnhingedMode,
      mainstreamNewsEnabled: brands.mainstreamNewsEnabled,
    })
    .from(brands)
    .where(eq(brands.id, activeBrandId))
    .limit(1) : [];

  const displayName = brand?.name ?? user?.name ?? 'Your Name';
  // Never fall back to user.image when a brand exists, the logged-in user
  // and the brand are often different people (agency owner managing a client).
  const avatarUrl = brand ? (brand.avatarUrl ?? null) : (user?.image ?? null);
  const headline = brand?.niche ?? (brand?.voiceSummary?.split('.')[0]) ?? 'Your headline here';

  return NextResponse.json({
    displayName,
    avatarUrl,
    headline,
    twitterHandle: brand?.handle?.trim().replace(/^@/, '') || null,
    linkedinHandle: brand?.linkedinHandle ?? null,
    brandId: brand?.id ?? null,
    selectedCategories: brand?.selectedCategories ?? [],
    weeklyFocus: brand?.weeklyFocus ?? null,
    contentStyle: brand?.contentStyle ?? 'mixed',
    allowUnhingedMode: brand?.allowUnhingedMode ?? false,
    mainstreamNewsEnabled: brand?.mainstreamNewsEnabled ?? false,
    planTier: user?.planTier ?? 'free',
  });
}
