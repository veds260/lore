import '../lib/load-env';
import { createInterface } from 'node:readline/promises';
import { stdin, stdout } from 'node:process';
import { eq } from 'drizzle-orm';

// Sets a new password for an account on this install. Anyone who can run this
// already has the database credentials, so it asks for nothing else.

async function main() {
  const { db } = await import('../lib/db');
  const { users } = await import('../lib/db/schema');
  const { MIN_PASSWORD, findPasswordUser, hashPassword } = await import('../lib/auth/local');

  const rl = createInterface({ input: stdin, output: stdout });
  const email = (process.argv[2] ?? (await rl.question('Email: '))).trim().toLowerCase();
  const user = await findPasswordUser(email);
  if (!user) {
    rl.close();
    console.error(`No account with the email ${email}.`);
    process.exit(1);
  }
  const password = await rl.question(`New password (at least ${MIN_PASSWORD} characters): `);
  rl.close();
  if (password.length < MIN_PASSWORD) {
    console.error('Too short, nothing changed.');
    process.exit(1);
  }
  await db.update(users).set({ passwordHash: await hashPassword(password) }).where(eq(users.id, user.id));
  console.log('Password updated. Sign in at /login.');
  process.exit(0);
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
