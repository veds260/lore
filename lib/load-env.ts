// Next loads .env.local on its own. Plain scripts run through tsx do not, so
// they import this first. Existing variables are never overwritten.
const load = (process as NodeJS.Process & { loadEnvFile?: (path: string) => void }).loadEnvFile;

if (typeof load === 'function') {
  for (const file of ['.env.local', '.env']) {
    try {
      load.call(process, file);
    } catch {
      // not present
    }
  }
}

export {};
