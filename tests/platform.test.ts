/**
 * The platform branches. Lore is developed on one operating system and run on
 * three, so these force each branch instead of trusting that it looks right.
 */
import { chmodSync, mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { agentBinDirs, browserOpeners, cmdQuote, looksLikeWsl, needsCmdShell, spawnBin, whichBin } from '../lib/platform';
import { openUrl } from '../lib/setup/open-browser';

const onWindows = process.platform === 'win32';

let failed = 0;
function check(name: string, cond: boolean) {
  console.log(`${cond ? '  ok  ' : ' FAIL '}${name}`);
  if (!cond) failed++;
}

const URL = 'http://localhost:3077/claim?token=x';

// --- which opener each platform picks --------------------------------------
const mac = browserOpeners(URL, 'darwin');
check('macOS uses open', mac[0][0] === 'open' && mac[0][1][0] === URL);

const win = browserOpeners(URL, 'win32');
check('Windows uses cmd start with an empty window title', win[0][0] === 'cmd' && win[0][1].join(' ') === `/d /s /c start "" ${URL}`);
check('Windows has a fallback after cmd', win.length > 1 && win[1][0] === 'powershell');
check('every Windows opener carries the url', win.every(([, args]) => args.some((a) => a.includes(URL))));

const linux = browserOpeners(URL, 'linux');
check('Linux tries xdg-open first', linux[0][0] === 'xdg-open');
check('Linux has fallbacks after xdg-open', linux.length > 1 && linux.every(([, args]) => args.includes(URL)));
check('Linux never reaches for a Windows opener', !linux.some(([cmd]) => /cmd|wsl/.test(cmd)));

const wsl = browserOpeners(URL, 'linux', true);
check('WSL tries wslview first', wsl[0][0] === 'wslview');
check('WSL falls back to cmd.exe', wsl[1][0] === 'cmd.exe' && wsl[1][1].join(' ') === `/c start  ${URL}`);
check('WSL knows where cmd.exe lives when PATH interop is off', wsl[2][0] === '/mnt/c/Windows/System32/cmd.exe');

// --- quoting for cmd.exe ---------------------------------------------------
// Windows has no argv, only one command line, so anything we do not quote here
// gets re-split by cmd. An empty string has to survive as an argument too: it is
// what `claude -p --tools ''` uses to take every tool away from the agent.
check('an empty argument survives as a pair of quotes', cmdQuote('') === '""');
check('a plain argument is left alone', cmdQuote('--tools') === '--tools');
check('a path with a space gets quoted', cmdQuote('C:\\Program Files\\a.cmd') === '"C:\\Program Files\\a.cmd"');
check('an ampersand gets quoted', cmdQuote('a&b') === '"a&b"');
check('an inner quote is escaped', cmdQuote('say "hi"') === '"say \\"hi\\""');

check('a .cmd shim needs cmd.exe on Windows', needsCmdShell('C:\\npm\\claude.cmd', 'win32'));
check('a .bat shim needs cmd.exe on Windows', needsCmdShell('C:\\npm\\claude.BAT', 'win32'));
check('an .exe does not', !needsCmdShell('C:\\node\\node.exe', 'win32'));
check('nothing needs it off Windows', !needsCmdShell('/usr/local/bin/claude.cmd', 'linux'));

// --- where each platform keeps an agent CLI --------------------------------
const winDirs = agentBinDirs('C:\\Users\\sam', 'win32', { APPDATA: 'C:\\Users\\sam\\AppData\\Roaming', LOCALAPPDATA: 'C:\\Users\\sam\\AppData\\Local' });
check('Windows lookup covers the global npm folder', winDirs.includes('C:\\Users\\sam\\AppData\\Roaming\\npm'));
check('Windows lookup covers winget links', winDirs.includes('C:\\Users\\sam\\AppData\\Local\\Microsoft\\WinGet\\Links'));
check('Windows lookup covers ~/.local/bin', winDirs.includes('C:\\Users\\sam\\.local\\bin'));
check('Windows lookup has no unix paths', !winDirs.some((d) => d.startsWith('/')));
check('Windows lookup works with no environment', agentBinDirs('C:\\Users\\sam', 'win32', {}).length > 0);

// --- telling WSL apart from plain Linux ------------------------------------
check('a Microsoft kernel is WSL', looksLikeWsl('linux', {}, 'Linux version 5.15.0-microsoft-standard-WSL2'));
check('WSL_DISTRO_NAME is enough', looksLikeWsl('linux', { WSL_DISTRO_NAME: 'Ubuntu' }, 'Linux version 6.1.0'));
check('a normal Linux kernel is not WSL', !looksLikeWsl('linux', {}, 'Linux version 6.8.0-45-generic'));
check('macOS is never WSL', !looksLikeWsl('darwin', { WSL_DISTRO_NAME: 'Ubuntu' }, ''));

// --- finding a binary ------------------------------------------------------
const box = mkdtempSync(join(tmpdir(), 'lore-platform-'));
const binDir = join(box, 'bin');
const extraDir = join(box, 'extra');
const calls = join(box, 'calls.txt');
mkdirSync(binDir);
mkdirSync(extraDir);

function fake(dir: string, name: string) {
  const path = join(dir, name);
  writeFileSync(path, `#!/bin/sh\nprintf '%s %s\\n' "${name}" "$*" >> ${calls}\n`);
  chmodSync(path, 0o755);
  return path;
}

const realPath = process.env.PATH;
const realPlatform = process.platform;
const setPlatform = (value: string) => Object.defineProperty(process, 'platform', { value, configurable: true });

/**
 * The Windows half. A global npm install there is a .cmd shim, and since the 2024
 * Node fix a shim can only be started through cmd.exe, which means Lore has to
 * quote every argument itself. This runs a real shim and reads back what it got.
 */
async function windowsChecks() {
  const shim = join(binDir, 'claude.cmd');
  const out = join(box, 'args.txt');
  writeFileSync(shim, [
    '@echo off',
    ':loop',
    'if [%1]==[] goto end',
    '>>"%LORE_TEST_OUT%" echo arg=%1',
    'shift',
    'goto loop',
    ':end',
    '',
  ].join('\r\n'));

  process.env.PATH = binDir;
  check('whichBin finds the .cmd shim from the bare name', (await whichBin('claude')) === shim);
  check('whichBin does not invent one', (await whichBin('definitely-not-installed')) === null);
  check('whichBin accepts a full path that already has its extension', (await whichBin(shim)) === shim);
  check('whichBin looks in the extra directories too', (await whichBin('claude', [binDir])) !== null);

  writeFileSync(out, '');
  const args = ['-p', '--tools', '', '--strict-mcp-config', 'C:\\Program Files\\x', 'a&b'];
  const code = await new Promise<number | null>((resolve) => {
    const child = spawnBin(shim, args, {
      stdio: 'ignore',
      env: { ...process.env, LORE_TEST_OUT: out },
    });
    child.on('error', () => resolve(null));
    child.on('close', (c) => resolve(c));
  });
  const got = readFileSync(out, 'utf8').split(/\r?\n/).filter(Boolean).map((l) => l.replace(/^arg=/, '').trim());
  check('the shim ran at all', code === 0);
  check('the shim got every argument', got.length === args.length);
  check('the empty argument survived', got[2] === '""');
  check('a path with a space stayed one argument', got[4] === '"C:\\Program Files\\x"');
  check('an ampersand did not become a second command', got[5] === '"a&b"');

  process.env.PATH = realPath;
  rmSync(box, { recursive: true, force: true });
}

async function main() {
  if (onWindows) {
    await windowsChecks();
    console.log(failed ? `\n${failed} failed\n` : '\nall good\n');
    process.exit(failed ? 1 : 0);
  }

  fake(binDir, 'xdg-open');
  fake(extraDir, 'claude');

  process.env.PATH = binDir;
  check('whichBin finds something on PATH', (await whichBin('xdg-open')) === join(binDir, 'xdg-open'));
  check('whichBin does not invent one', (await whichBin('definitely-not-installed')) === null);
  check('whichBin looks in the extra directories too', (await whichBin('claude', [extraDir])) === join(extraDir, 'claude'));
  check('whichBin accepts a full path', (await whichBin(join(extraDir, 'claude'))) === join(extraDir, 'claude'));

  const dirs = agentBinDirs('/home/tester', 'linux');
  check('agent lookup covers ~/.local/bin', dirs.includes('/home/tester/.local/bin'));
  check('agent lookup covers ~/.claude/local', dirs.includes('/home/tester/.claude/local'));

  // --- the opener actually running, once per platform ----------------------
  async function opened(label: string, platform: string, wslEnv: boolean, expect: string) {
    setPlatform(platform);
    if (wslEnv) process.env.WSL_DISTRO_NAME = 'Ubuntu';
    else delete process.env.WSL_DISTRO_NAME;

    writeFileSync(calls, '');
    const picked = await openUrl(URL);
    let seen = '';
    for (let i = 0; i < 50 && !seen.includes(URL); i++) {
      await new Promise((r) => setTimeout(r, 40));
      seen = readFileSync(calls, 'utf8');
    }
    check(`${label} runs ${expect}`, picked === expect && seen.startsWith(`${expect} `) && seen.includes(URL));
  }

  fake(binDir, 'open');
  await opened('macOS', 'darwin', false, 'open');

  await opened('Linux', 'linux', false, 'xdg-open');

  fake(binDir, 'wslview');
  await opened('WSL', 'linux', true, 'wslview');

  // With wslview gone, WSL should fall through to cmd.exe rather than xdg-open.
  rmSync(join(binDir, 'wslview'));
  fake(binDir, 'cmd.exe');
  await opened('WSL without wslview', 'linux', true, 'cmd.exe');

  // Nothing installed at all is a quiet no, because the link was already printed.
  process.env.PATH = join(box, 'empty');
  setPlatform('linux');
  check('no opener installed is not an error', (await openUrl(URL)) === null);

  process.env.PATH = realPath;
  setPlatform(realPlatform);
  rmSync(box, { recursive: true, force: true });

  console.log(failed ? `\n${failed} failed\n` : '\nall good\n');
  process.exit(failed ? 1 : 0);
}

void main();
