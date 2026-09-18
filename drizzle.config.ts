import { defineConfig } from 'drizzle-kit';

// drizzle-kit runs outside Next, so nothing has loaded .env.local yet.
// process.loadEnvFile landed in Node 20.12. On an older Node it is simply
// undefined, the env file is never read, and every variable in it looks unset.
const loadEnvFile = (process as NodeJS.Process & { loadEnvFile?: (path: string) => void }).loadEnvFile;

if (typeof loadEnvFile === 'function') {
  for (const file of ['.env.local', '.env']) {
    try {
      loadEnvFile.call(process, file);
      break;
    } catch {
      // not there, try the next one
    }
  }
}

if (!process.env.DATABASE_URL) {
  console.error(
    typeof loadEnvFile === 'function'
      ? 'DATABASE_URL is not set. Copy .env.example to .env.local, or run `npm run setup`.'
      : `This is Node ${process.versions.node}, and reading .env.local from a script needs Node 20.12 or newer. `
        + 'DATABASE_URL may well be set in the file, nothing here can read it. Upgrade Node, or pass the '
        + 'variable in for this one command: DATABASE_URL=... npm run db:push',
  );
  process.exit(1);
}

export default defineConfig({
  schema: './lib/db/schema.ts',
  out: './drizzle',
  dialect: 'postgresql',
  dbCredentials: {
    url: process.env.DATABASE_URL,
  },
});
