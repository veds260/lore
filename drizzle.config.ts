import { defineConfig } from 'drizzle-kit';

// drizzle-kit runs outside Next, so nothing has loaded .env.local yet.
for (const file of ['.env.local', '.env']) {
  try {
    process.loadEnvFile(file);
    break;
  } catch {
    // not there, try the next one
  }
}

if (!process.env.DATABASE_URL) {
  console.error('DATABASE_URL is not set. Copy .env.example to .env.local, or run `npm run setup`.');
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
