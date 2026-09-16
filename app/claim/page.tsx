import { redirect } from 'next/navigation';
import { claimTokenValid, isUnclaimed } from '@/lib/setup/claim';
import { MIN_PASSWORD } from '@/lib/auth/local';
import { SetupShell, StepHeading } from '@/components/setup/setup-shell';

export const dynamic = 'force-dynamic';

const ERRORS: Record<string, string> = {
  email: 'That email does not look right.',
  password: `Use at least ${MIN_PASSWORD} characters for the password.`,
  invalid: 'This setup link has expired or was already used. Restart Lore and it opens a fresh one.',
  failed: 'Could not create the account. Check the database is running and try again.',
};

const INPUT = 'w-full rounded-md border border-border bg-card px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring';

export default async function ClaimPage({
  searchParams,
}: {
  searchParams: Promise<{ token?: string; error?: string }>;
}) {
  const { token = '', error } = await searchParams;
  if (!(await isUnclaimed())) redirect('/login?claimed=1');
  const valid = await claimTokenValid(token);

  return (
    <SetupShell current={0}>
      <StepHeading
        eyebrow="Step 1 of 4"
        title="Make this Lore yours"
        sub="This login only exists in your own database, and it is how you get back in later"
      />

      {!valid ? (
        <p className="mt-8 rounded-md border border-destructive/40 bg-destructive/5 px-3 py-2.5 text-sm text-destructive">
          {ERRORS.invalid}
        </p>
      ) : (
        <form action="/api/claim" method="post" className="mt-8 space-y-4">
          <input type="hidden" name="token" value={token} />
          {error && ERRORS[error] && (
            <p className="rounded-md border border-destructive/40 bg-destructive/5 px-3 py-2.5 text-sm text-destructive">{ERRORS[error]}</p>
          )}
          <div>
            <label htmlFor="name" className="mb-1.5 block text-sm font-medium">Your name</label>
            <input id="name" name="name" autoComplete="name" placeholder="Sam Rivera" autoFocus className={INPUT} />
          </div>
          <div>
            <label htmlFor="email" className="mb-1.5 block text-sm font-medium">Email</label>
            <input id="email" name="email" type="email" required autoComplete="email" placeholder="you@example.com" className={INPUT} />
          </div>
          <div>
            <label htmlFor="password" className="mb-1.5 block text-sm font-medium">Password</label>
            <input id="password" name="password" type="password" required minLength={MIN_PASSWORD} autoComplete="new-password" className={INPUT} />
            <p className="mt-1.5 text-xs text-muted-foreground">At least {MIN_PASSWORD} characters. If you forget it, run npm run password:reset</p>
          </div>
          <button type="submit" className="w-full rounded-md bg-foreground px-4 py-2.5 text-sm font-medium text-background hover:opacity-90">
            Create account
          </button>
        </form>
      )}
    </SetupShell>
  );
}
