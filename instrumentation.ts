export async function register() {
  if (process.env.NEXT_RUNTIME !== 'nodejs') return;
  if (process.env.LORE_SKIP_CLAIM_BANNER === 'true') return;

  try {
    const { databaseState } = await import('@/lib/setup/db-state');
    const report = await databaseState();

    // A fresh clone lands here with Postgres up and nothing in it. Saying nothing
    // leaves the person on a setup page with no way forward, so say the command.
    if (report.state === 'no-tables') {
      console.log(
        `\n  Lore reached the database at ${report.host ?? 'DATABASE_URL'} and it has no tables yet.\n  Create them, then start Lore again:\n\n  npm run db:push\n`,
      );
      return;
    }
    if (report.state === 'unreachable') {
      console.log(
        `\n  Lore could not reach the database at ${report.host ?? 'DATABASE_URL'}.\n  ${report.error ?? ''}\n  Start Postgres (docker compose up -d) and check DATABASE_URL in .env.local, then run npm run doctor.\n`,
      );
      return;
    }

    const { isUnclaimed, issueClaimToken } = await import('@/lib/setup/claim');
    if (!(await isUnclaimed())) return;

    const token = await issueClaimToken();
    if (!token) return;

    // Next sets PORT to the port it really bound, including when it moved off a busy
    // one, so a local link always matches. A deployed server has a public address
    // configured, and nobody can open localhost on it anyway.
    const configured = process.env.NEXT_PUBLIC_APP_URL?.replace(/\/$/, '');
    const local = !configured || /^https?:\/\/(localhost|127\.0\.0\.1|\[::1\])(:\d+)?$/.test(configured);
    // 127.0.0.1, not localhost: on a machine where localhost resolves to ::1 first,
    // the link can land on whatever else is listening there.
    const base = local ? `http://127.0.0.1:${process.env.PORT || 3000}` : configured;
    const url = `${base}/claim?token=${token}`;
    console.log(
      `\n  Lore is running and nobody owns it yet.\n  Your browser should open to finish setup. If it does not, open:\n\n  ${url}\n\n  The link works until someone uses it, and a restart issues a new one.\n`,
    );
    const { openWhenReady } = await import('@/lib/setup/open-browser');
    void openWhenReady(base, url);
  } catch {
    // Something below this is broken in a way the setup page explains better.
  }
}
