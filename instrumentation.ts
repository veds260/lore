export async function register() {
  if (process.env.NEXT_RUNTIME !== 'nodejs') return;
  if (process.env.LORE_SKIP_CLAIM_BANNER === 'true') return;

  try {
    const { isUnclaimed, issueClaimToken } = await import('@/lib/setup/claim');
    if (!(await isUnclaimed())) return;

    const token = await issueClaimToken();
    if (!token) return;

    const base = process.env.NEXT_PUBLIC_APP_URL?.replace(/\/$/, '') || `http://localhost:${process.env.PORT || 3000}`;
    const url = `${base}/claim?token=${token}`;
    console.log(
      `\n  Lore is running and nobody owns it yet.\n  Your browser should open to finish setup. If it does not, open:\n\n  ${url}\n\n  The link works until someone uses it, and a restart issues a new one.\n`,
    );
    const { openWhenReady } = await import('@/lib/setup/open-browser');
    void openWhenReady(base, url);
  } catch {
    // No database yet. The setup page explains what to do.
  }
}

