import { spawn } from 'node:child_process';

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

  const [cmd, args] = process.platform === 'darwin' ? ['open', [url]]
    : process.platform === 'win32' ? ['cmd', ['/c', 'start', '""', url]]
      : ['xdg-open', [url]];
  try {
    const child = spawn(cmd, args, { stdio: 'ignore', detached: true });
    child.on('error', () => {});
    child.unref();
  } catch {
    // No browser on this machine, the printed link still works.
  }
}
