import { spawn } from 'node:child_process';
import { browserOpeners, isWsl, whichBin } from '../platform';

// Opens the setup link once the server answers, only on a developer machine. A
// deployed server has nobody sitting at it, so it just prints the link.
export async function openWhenReady(base: string, url: string) {
  if (process.env.NODE_ENV === 'production' || process.env.CI || process.env.LORE_NO_BROWSER) return;
  if (!/^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(base)) return;

  for (let i = 0; i < 60; i++) {
    try {
      await fetch(`${base}/api/health`, { signal: AbortSignal.timeout(2000) });
      break;
    } catch {
      await new Promise((r) => setTimeout(r, 1000));
    }
  }

  await openUrl(url);
}

/**
 * Tries each opener this platform knows about and stops at the first one that is
 * installed. A machine with no browser at all, like a server over ssh, gets
 * nothing and no error, because the link was already printed.
 */
export async function openUrl(url: string): Promise<string | null> {
  for (const [cmd, args] of browserOpeners(url, process.platform, isWsl())) {
    const bin = await whichBin(cmd);
    if (!bin) continue;
    try {
      const child = spawn(bin, args, { stdio: 'ignore', detached: true });
      child.on('error', () => {});
      child.unref();
      return cmd;
    } catch {
      // that one would not start, try the next
    }
  }
  return null;
}
