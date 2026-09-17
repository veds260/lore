import { spawn, type ChildProcess, type SpawnOptions } from 'node:child_process';
import { access, constants } from 'node:fs/promises';
import { readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { delimiter, isAbsolute, join, win32 } from 'node:path';

/**
 * Lore runs on macOS, Linux and Windows, and on Windows either natively or inside
 * WSL2. Four things differ between them: how you open a browser, where an agent CLI
 * ends up, how you start one, and what a missing tool should tell you to install.
 * Everything platform-specific lives here so the rest of the code can stay plain.
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
 * Wraps one argument so cmd.exe passes it through whole. Windows has no argv, only
 * one command line, so anything with a space or a cmd operator in it has to be
 * quoted here rather than by the runtime.
 */
export function cmdQuote(arg: string): string {
  if (arg === '') return '""';
  if (!/[\s"^&|<>()]/.test(arg)) return arg;
  // Backslashes only escape a quote when they sit right before one, so double just
  // those runs and leave the rest alone.
  const body = arg.replace(/(\\*)"/g, '$1$1\\"').replace(/(\\+)$/, '$1$1');
  return `"${body}"`;
}

/**
 * A global npm install on Windows is a .cmd shim, and since the 2024 security fix
 * Node refuses to start one directly: it has to go through cmd.exe. That means we
 * quote every argument ourselves, because the shell would otherwise re-split them.
 */
export function needsCmdShell(bin: string, platform: string = process.platform): boolean {
  return platform === 'win32' && /\.(cmd|bat)$/i.test(bin);
}

/**
 * spawn, with the Windows shim case handled. Everywhere else it is plain spawn, so
 * the behaviour on macOS and Linux is byte for byte what it was.
 */
export const spawnBin: typeof spawn = ((bin: string, args: string[] = [], options: SpawnOptions = {}): ChildProcess => {
  if (!needsCmdShell(bin)) return spawn(bin, args, options);
  return spawn(cmdQuote(bin), args.map(cmdQuote), {
    ...options,
    shell: true,
    windowsVerbatimArguments: true,
  });
}) as typeof spawn;

/**
 * The commands that can open a URL, best first. Under WSL the browser is on the
 * Windows side, so a Linux opener there would either do nothing or open a browser
 * inside the distro that the person cannot see. Native Windows goes through
 * `start`, which is a cmd builtin and not a program, and the empty pair of quotes
 * after it is the window title `start` would otherwise read the URL as.
 *
 * Windows arguments come out pre-quoted, so `openUrl` passes them verbatim.
 */
export function browserOpeners(url: string, platform: string, wsl = false): Array<[string, string[]]> {
  if (platform === 'darwin') return [['open', [url]]];
  if (platform === 'win32') {
    return [
      ['cmd', ['/d', '/s', '/c', 'start', '""', cmdQuote(url)]],
      ['powershell', ['-NoProfile', '-NonInteractive', '-Command', 'Start-Process', cmdQuote(url)]],
      ['rundll32', ['url.dll,FileProtocolHandler', cmdQuote(url)]],
    ];
  }
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
 *
 * Windows decides what is runnable by extension, not by a permission bit, so there
 * we try PATHEXT in its own order and check only that the file exists.
 */
export async function whichBin(name: string, extraDirs: string[] = [], platform: string = process.platform): Promise<string | null> {
  const windows = platform === 'win32';
  // The empty extension last, so `claude` finds claude.cmd before the shell script
  // of the same name that sits beside it, and a full path with .exe still matches.
  const exts = windows
    ? [...(process.env.PATHEXT || '.COM;.EXE;.BAT;.CMD').split(';').filter(Boolean), '']
    : [''];
  const mode = windows ? constants.F_OK : constants.X_OK;

  const candidates: string[] = [];
  if (isAbsolute(name) || name.includes('/') || name.includes('\\')) {
    candidates.push(name);
  } else {
    const sep = windows ? ';' : delimiter;
    const onPath = (process.env.PATH || '').split(sep).filter(Boolean);
    const joinPath = windows ? win32.join : join;
    for (const dir of [...onPath, ...extraDirs]) candidates.push(joinPath(dir, name));
  }

  for (const candidate of candidates) {
    for (const ext of exts) {
      try {
        await access(candidate + ext, mode);
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
 * npm on the PATH. A server started from a desktop launcher, a systemd unit or a
 * Windows service usually has a much shorter PATH than the terminal the person
 * installed from.
 */
export function agentBinDirs(
  home = homedir(),
  platform: string = process.platform,
  env: Record<string, string | undefined> = process.env,
): string[] {
  if (!home) return [];

  if (platform === 'win32') {
    const appData = env.APPDATA || win32.join(home, 'AppData', 'Roaming');
    const localAppData = env.LOCALAPPDATA || win32.join(home, 'AppData', 'Local');
    const programFiles = env.ProgramFiles || 'C:\\Program Files';
    return [
      // npm install -g puts its .cmd shims here, which is where both agent CLIs land.
      win32.join(appData, 'npm'),
      win32.join(localAppData, 'npm'),
      // Claude Code's own installer, and anything else following the Unix habit.
      win32.join(home, '.local', 'bin'),
      win32.join(home, 'bin'),
      win32.join(home, '.claude', 'local'),
      win32.join(home, '.bun', 'bin'),
      win32.join(home, '.volta', 'bin'),
      win32.join(home, 'scoop', 'shims'),
      win32.join(localAppData, 'Microsoft', 'WinGet', 'Links'),
      win32.join(localAppData, 'Programs', 'nodejs'),
      win32.join(programFiles, 'nodejs'),
    ];
  }

  const dirs = [
    join(home, '.local', 'bin'),
    join(home, 'bin'),
    join(home, '.claude', 'local'),
    join(home, '.bun', 'bin'),
    join(home, '.npm-global', 'bin'),
    join(home, '.volta', 'bin'),
    '/usr/local/bin',
  ];
  dirs.push(platform === 'darwin' ? '/opt/homebrew/bin' : '/home/linuxbrew/.linuxbrew/bin');
  return dirs;
}
