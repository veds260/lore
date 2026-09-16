export async function register() {
  if (process.env.NEXT_RUNTIME !== 'nodejs') return;
  if (process.env.LORE_SKIP_CLAIM_BANNER === 'true') return;

  try {
    const { isUnclaimed, issueClaimToken } = await import('@/lib/setup/claim');
    if (!(await isUnclaimed())) return;

    const token = await issueClaimToken();
    if (!token) return;

    const base = process.env.NEXT_PUBLIC_APP_URL?.replace(/\/$/, '') || 'http://localhost:3000';
    console.log(
      `\n  Lore is running and nobody owns it yet.\n  Open this once to become the owner:\n\n  ${base}/claim?token=${token}\n\n  The link works until someone uses it, and a restart issues a new one.\n`,
    );
  } catch {
    // No database yet. The setup page explains what to do.
  }
}
