import { redirect } from 'next/navigation';
import { and, desc, eq } from 'drizzle-orm';
import { auth } from '@/lib/auth';
import { db } from '@/lib/db';
import { brands, users } from '@/lib/db/schema';
import { AppSidebar } from '@/components/layout/app-sidebar';
import { ProductTour } from '@/components/tour/product-tour';
import { PLAN_CONFIG } from '@/lib/plans';
import { getActiveBrandId } from '@/lib/active-brand';

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const session = await auth();
  if (!session?.user) redirect('/login');

  let userBrands: { id: string; name: string }[] = [];
  let planTier = 'free';
  const uid = session.user.id;
  try {
    if (uid) {
      userBrands = await db
        .select({ id: brands.id, name: brands.name })
        .from(brands)
        .where(and(eq(brands.userId, uid), eq(brands.isActive, true)))
        .orderBy(desc(brands.createdAt))
        .limit(5);

      const [user] = await db.select({ planTier: users.planTier }).from(users).where(eq(users.id, uid)).limit(1);
      planTier = user?.planTier ?? 'free';
    }
  } catch {
    // DB not connected, skip in local dev
  }

  const activeBrandId = uid ? await getActiveBrandId(uid) : null;
  const activeBrand = userBrands.find(b => b.id === activeBrandId) ?? userBrands[0] ?? null;
  const adminEmail = process.env.ADMIN_EMAIL;
  const isAdmin = !!adminEmail && !!session.user.email &&
    adminEmail.split(',').map(e => e.trim().toLowerCase()).includes(session.user.email.toLowerCase());

  // An install with nothing set up goes to onboarding, in development too: `npm run
  // dev` is how a self-hosted Lore runs, so an exemption for it is an open door.
  if (userBrands.length === 0 && !isAdmin) {
    redirect('/onboarding');
  }

  const clientSlots = PLAN_CONFIG[planTier]?.clientSlots ?? 1;
  const canAddBrand = userBrands.length < clientSlots;

  return (
    <div className="flex h-screen bg-background overflow-hidden">
      <AppSidebar user={session.user} activeBrand={activeBrand} allBrands={userBrands} canAddBrand={canAddBrand} isAdmin={isAdmin} />
      <main className="flex-1 overflow-y-auto">
        {children}
      </main>
      <ProductTour />
    </div>
  );
}
