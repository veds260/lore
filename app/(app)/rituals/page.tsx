import { auth } from '@/lib/auth';
import { redirect } from 'next/navigation';
import { RitualsClient } from '@/components/rituals/rituals-client';

export default async function RitualsPage() {
  const session = await auth();
  if (!session?.user?.id) redirect('/login');

  return <RitualsClient />;
}
