import { redirect } from 'next/navigation';
import { headers } from 'next/headers';
import { UserCircle2 } from 'lucide-react';
import { auth } from '@/lib/auth';
import { ProfileClient, type ProfileData } from '@/components/profile/profile-client';
import { EmptyState } from '@/components/ui/empty-state';

export default async function ProfilePage() {
  const session = await auth();
  if (!session?.user) redirect('/login');

  const h = await headers();
  const host = h.get('host') ?? 'localhost:3000';
  const proto = h.get('x-forwarded-proto') ?? 'http';
  const cookie = h.get('cookie') ?? '';

  const res = await fetch(`${proto}://${host}/api/profile/full`, {
    headers: { cookie },
    cache: 'no-store',
  });

  if (!res.ok) {
    return (
      <div className="p-8 lg:p-10 w-full">
        <div className="mb-8">
          <h1 className="text-2xl font-semibold tracking-tight">Profile</h1>
          <p className="text-sm text-muted-foreground mt-1">Your brand, voice, and writing rules.</p>
        </div>
        <EmptyState
          variant="fullHeight"
          icon={UserCircle2}
          title="Your profile lives here"
          description="Finish onboarding and Lore will build a voice profile, a writing style guide, and a banned-phrases list you can edit anytime."
          primary={{ label: 'Finish onboarding', href: '/onboarding' }}
        />
      </div>
    );
  }

  const data = (await res.json()) as ProfileData;

  return (
    <div className="flex flex-col h-full">
      <ProfileClient initial={data} />
    </div>
  );
}
