import { access, constants } from 'node:fs/promises';
import { readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { delimiter, isAbsolute, join } from 'node:path';

/**
 * Lore runs on macOS, Linux, and on Windows through WSL2. Three things differ
 * between them: how you open a browser, where an agent CLI ends up, and what a
 * missing tool should tell you to install. Everything platform-specific lives
 * here so the rest of the code can stay plain.
 */

/**
 * WSL reports itself as Linux, so ask the kernel. Split out from `isWsl` with no
 * caching and no globals, so it can be checked directly.
 */
export function looksLikeWsl(platform: string, env: Record<string, string | undefined>, procVersion: string): boolean {
  if (platform !== 'linux') return false;
  if (env.WSL_DISTRO_NAME || env.WSL_INTEROP) return true;
  return /microsoft/i.test(procVersion);
}

export function isWsl(): boolean {
  let procVersion = '';
  try {
    procVersion = readFileSync('/proc/version', 'utf8');
  } catch {
    // not Linux, or a Linux without procfs mounted
  }
  return looksLikeWsl(process.platform, process.env, procVersion);
}

/**
 * The commands that can open a URL, best first. Under WSL the browser is on the
 * Windows side, so a Linux opener there would either do nothing or open a browser
 * inside the distro that the person cannot see.
 */
export function browserOpeners(url: string, platform: string, wsl = false): Array<[string, string[]]> {
  if (platform === 'darwin') return [['open', [url]]];
  if (platform === 'win32') return [['cmd', ['/c', 'start', '', url]]];
  if (wsl) {
    return [
      ['wslview', [url]],
      ['cmd.exe', ['/c', 'start', '', url]],
      ['/mnt/c/Windows/System32/cmd.exe', ['/c', 'start', '', url]],
      ['xdg-open', [url]],
    ];
  }
  return [
    ['xdg-open', [url]],
    ['gio', ['open', url]],
    ['gnome-open', [url]],
    ['x-www-browser', [url]],
  ];
}

/**
 * Finds an executable the way a shell would, plus a few directories installers
 * like to use that a background process often does not have on its PATH.
 */
export async function whichBin(name: string, extraDirs: string[] = []): Promise<string | null> {
  const exts = process.platform === 'win32'
    ? (process.env.PATHEXT || '.COM;.EXE;.BAT;.CMD').split(';').filter(Boolean)
    : [''];

  const candidates: string[] = [];
  if (isAbsolute(name) || name.includes('/') || name.includes('\\')) {
    candidates.push(name);
  } else {
    const onPath = (process.env.PATH || '').split(delimiter).filter(Boolean);
    for (const dir of [...onPath, ...extraDirs]) candidates.push(join(dir, name));
  }

  for (const candidate of candidates) {
    for (const ext of exts) {
      try {
        await access(candidate + ext, constants.X_OK);
        return candidate + ext;
      } catch {
        // not here, keep looking
      }
    }
  }
  return null;
}

/**
 * Where Claude Code and Codex land when they are not installed through a global
 * npm on the PATH. A server started from a desktop launcher or a systemd unit
 * usually has a much shorter PATH than the terminal the person installed from.
 */
export function agentBinDirs(home = homedir()): string[] {
  if (!home) return [];
  const dirs = [
    join(home, '.local', 'bin'),
    join(home, 'bin'),
    join(home, '.claude', 'local'),
    join(home, '.bun', 'bin'),
    join(home, '.npm-global', 'bin'),
    join(home, '.volta', 'bin'),
    '/usr/local/bin',
  ];
  dirs.push(process.platform === 'darwin' ? '/opt/homebrew/bin' : '/home/linuxbrew/.linuxbrew/bin');
  return dirs;
}
