import { redirect } from 'next/navigation';
import { isHosted } from '@/lib/plans';
import { modelReady } from '@/lib/providers';

export const dynamic = 'force-dynamic';

// Onboarding writes with the model from its first message, so a self-hosted install
// only gets here after setup has seen the model answer a real test message.
export default async function OnboardingGate({ children }: { children: React.ReactNode }) {
  if (!isHosted() && !(await modelReady())) redirect('/setup?step=model');
  return <>{children}</>;
}
