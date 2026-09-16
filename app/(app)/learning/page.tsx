import { redirect } from 'next/navigation';
import { Brain, RotateCcw } from 'lucide-react';
import { auth } from '@/lib/auth';
import { getActiveBrandId } from '@/lib/active-brand';
import { getInsightsForBrand } from '@/lib/learning-insights';
import { LearningClient } from '@/components/learning/learning-client';
import { EmptyState } from '@/components/ui/empty-state';

export default async function LearningPage() {
  const session = await auth();
  if (!session?.user) redirect('/login');

  if (!session.user.id) redirect('/login');
  const brandId = await getActiveBrandId(session.user.id);
  if (!brandId) {
    return (
      <div className="p-8 lg:p-10 w-full">
        <div className="mb-8">
          <h1 className="text-2xl font-semibold tracking-tight">Learning</h1>
          <p className="text-sm text-muted-foreground mt-1">What Lore has picked up from your writing.</p>
        </div>
        <EmptyState
          variant="fullHeight"
          icon={Brain}
          title="The learning loop hasn't started yet"
          description="Finish onboarding so Lore can read your voice, watch your edits, and turn them into rules that show up here."
          primary={{ label: 'Finish onboarding', href: '/onboarding' }}
        />
      </div>
    );
  }

  const data = await getInsightsForBrand(brandId);
  if (!data) {
    return (
      <div className="p-8 lg:p-10 w-full">
        <div className="mb-8">
          <h1 className="text-2xl font-semibold tracking-tight">Learning</h1>
          <p className="text-sm text-muted-foreground mt-1">What Lore has picked up from your writing.</p>
        </div>
        <EmptyState
          variant="fullHeight"
          icon={RotateCcw}
          title="Couldn't load your insights"
          description="Something went wrong on our end. Refresh in a moment, or open another page and come back."
        />
      </div>
    );
  }

  return <LearningClient data={data} />;
}
