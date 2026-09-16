export default function VerifyPage() {
  return (
    <div className="w-full max-w-sm text-center">
      <div className="w-10 h-10 rounded-full bg-muted flex items-center justify-center mx-auto mb-5">
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" className="text-muted-foreground">
          <rect width="20" height="16" x="2" y="4" rx="2" /><path d="m22 7-8.97 5.7a1.94 1.94 0 0 1-2.06 0L2 7" />
        </svg>
      </div>
      <h1 className="text-xl font-semibold text-foreground mb-2">Check your email</h1>
      <p className="text-sm text-muted-foreground leading-relaxed">
        We sent a sign-in link to your email address. It expires in 24 hours.
      </p>
      <p className="text-xs text-muted-foreground mt-6">
        Didn&apos;t get it? Check your spam folder, or{' '}
        <a href="/login" className="text-foreground underline underline-offset-2">try again</a>.
      </p>
    </div>
  );
}
