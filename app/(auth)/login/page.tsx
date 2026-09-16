import { redirect } from 'next/navigation';
import { auth, signIn } from '@/lib/auth';
import { AuthError } from 'next-auth';

const googleConfigured = !!(process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET);

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string }>;
}) {
  const session = await auth();
  if (session?.user) redirect('/board');

  const { error } = await searchParams;

  return (
    <div className="w-full max-w-sm">
      <div className="mb-8 text-center">
        <h1 className="text-2xl font-semibold tracking-tight text-foreground">Sign in to Lore</h1>
        <p className="text-sm text-muted-foreground mt-2">
          Enter your email and we&apos;ll send you a magic link.
        </p>
      </div>

      {error && (
        <div className="mb-5 px-3 py-2.5 rounded-md border border-destructive/40 bg-destructive/5 text-xs text-destructive leading-relaxed">
          {error === 'db' && 'Database not connected. Set DATABASE_URL in .env.local and run the migration.'}
          {error === 'email' && 'Email could not be sent. Check that RESEND_API_KEY is set.'}
          {error === 'config' && 'Auth is not fully configured. See .env.example for required variables.'}
          {!['db', 'email', 'config'].includes(error) && 'Something went wrong. Try again.'}
        </div>
      )}

      {googleConfigured && (
        <>
          <form
            action={async () => {
              'use server';
              await signIn('google', { redirectTo: '/board' });
            }}
          >
            <button
              type="submit"
              className="w-full flex items-center justify-center gap-3 py-2 px-4 rounded-md border border-border bg-card text-foreground text-sm font-medium hover:bg-accent transition-colors"
            >
              <svg width="16" height="16" viewBox="0 0 24 24" aria-hidden="true">
                <path d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z" fill="#4285F4"/>
                <path d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" fill="#34A853"/>
                <path d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l3.66-2.84z" fill="#FBBC05"/>
                <path d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" fill="#EA4335"/>
              </svg>
              Continue with Google
            </button>
          </form>

          <div className="flex items-center gap-3 my-5">
            <div className="flex-1 h-px bg-border" />
            <span className="text-xs text-muted-foreground">or</span>
            <div className="flex-1 h-px bg-border" />
          </div>
        </>
      )}

      <form
        action={async (formData: FormData) => {
          'use server';
          try {
            await signIn('resend', {
              email: formData.get('email') as string,
              redirectTo: '/board',
            });
          } catch (err) {
            // NextAuth signals a successful redirect by throwing, let that through
            if (err instanceof Error && err.message === 'NEXT_REDIRECT') throw err;

            if (err instanceof AuthError) {
              const msg = err.message?.toLowerCase() ?? '';
              if (msg.includes('adapter') || msg.includes('database') || msg.includes('connect')) {
                redirect('/login?error=db');
              }
              if (msg.includes('email') || msg.includes('resend') || msg.includes('send')) {
                redirect('/login?error=email');
              }
              redirect('/login?error=config');
            }

            redirect('/login?error=unknown');
          }
        }}
        className="space-y-4"
      >
        <div>
          <label htmlFor="email" className="block text-sm font-medium text-foreground mb-1.5">
            Email
          </label>
          <input
            id="email"
            name="email"
            type="email"
            required
            autoComplete="email"
            placeholder="you@example.com"
            className="w-full px-3 py-2 rounded-md border border-border bg-card text-foreground text-sm placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring transition-colors"
          />
        </div>
        <button
          type="submit"
          className="w-full py-2 px-4 rounded-md bg-foreground text-background text-sm font-medium hover:opacity-90 transition-opacity"
        >
          Send magic link
        </button>
      </form>

      <p className="mt-6 text-xs text-muted-foreground text-center">
        No password needed. We&apos;ll email you a sign-in link.
      </p>

      <p className="mt-8 text-xs text-muted-foreground text-center">
        New to Lore? Just enter your email above. We&apos;ll create your account on first sign-in.
      </p>
    </div>
  );
}
