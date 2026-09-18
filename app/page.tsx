import { redirect } from 'next/navigation';
import { isHosted } from '@/lib/plans';

export const dynamic = 'force-dynamic';

// The hosted service opens on the marketing page. A self-hosted install has no use
// for it: the owner goes straight to the app, and a fresh install goes to setup.
export default async function RootPage() {
  if (isHosted()) redirect('/home');

  const { setupAccess } = await import('@/lib/setup/claim');
  const access = await setupAccess();
  if (access === 'open' || access === 'no-database' || access === 'no-tables') redirect('/setup');

  const { auth } = await import('@/lib/auth');
  const session = await auth();
  redirect(session?.user ? '/board' : '/login');
}
