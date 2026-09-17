import { NextResponse } from 'next/server';
import { setupAccess } from '@/lib/setup/claim';
import { isHosted } from '@/lib/plans';
import {
  backendOptions, clearModelVerified, modelReady, resetProviderCache, saveApiKey, saveBackendChoice, testModel,
  type BackendChoice, type KeyBackend,
} from '@/lib/providers';
import { forgetAuthFailures, startCliLogin } from '@/lib/providers/cli';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// Picking and testing a model changes how the whole instance runs, so only the
// owner can do it. Before anyone owns the instance, setup sends people to claim it.
async function owner(): Promise<boolean> {
  return (await setupAccess()) === 'owner';
}

/**
 * Signing a CLI in opens a browser on the machine Lore runs on, which only helps
 * the person sitting at that machine. So it is offered on a self-hosted install
 * opened through localhost, never on the hosted service or over the network.
 */
function onThisMachine(req: Request): boolean {
  if (isHosted()) return false;
  const host = (req.headers.get('x-forwarded-host') ?? req.headers.get('host') ?? '').toLowerCase();
  return /^(localhost|127\.0\.0\.1|\[::1\])(:\d+)?$/.test(host);
}

export async function GET(req: Request) {
  if (!(await owner())) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  resetProviderCache();
  if (new URL(req.url).searchParams.get('recheck') === '1') forgetAuthFailures();
  const { options, active, pinned } = await backendOptions();
  const verified = active !== null && (await modelReady());
  return NextResponse.json({ options, active, pinned, verified, local: onThisMachine(req), canSaveKey: !isHosted() });
}

export async function POST(req: Request) {
  if (!(await owner())) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  const body = (await req.json().catch(() => ({}))) as { action?: unknown; backend?: unknown; provider?: unknown; key?: unknown };

  if (body.action === 'use') {
    const backend = body.backend;
    if (backend !== 'claude' && backend !== 'codex' && backend !== 'api') {
      return NextResponse.json({ error: 'Unknown model' }, { status: 400 });
    }
    await saveBackendChoice(backend as BackendChoice);
    await clearModelVerified();
    return NextResponse.json({ ok: true });
  }

  if (body.action === 'test') {
    return NextResponse.json(await testModel());
  }

  if (body.action === 'login') {
    const backend = body.backend;
    if (backend !== 'claude' && backend !== 'codex') return NextResponse.json({ error: 'Unknown model' }, { status: 400 });
    if (!onThisMachine(req)) {
      return NextResponse.json({ error: 'Sign in from a terminal on the computer Lore runs on' }, { status: 403 });
    }
    try {
      return NextResponse.json({ ok: true, login: await startCliLogin(backend) });
    } catch (err) {
      return NextResponse.json({ error: err instanceof Error ? err.message : String(err) }, { status: 400 });
    }
  }

  if (body.action === 'key') {
    if (isHosted()) return NextResponse.json({ error: 'Keys are managed by the host on this instance' }, { status: 403 });
    const provider = body.provider;
    if (provider !== 'anthropic' && provider !== 'openai' && provider !== 'openrouter') {
      return NextResponse.json({ error: 'Pick Anthropic, OpenAI or OpenRouter' }, { status: 400 });
    }
    if (typeof body.key !== 'string') return NextResponse.json({ error: 'Paste a key first' }, { status: 400 });
    const result = await saveApiKey(provider as KeyBackend, body.key);
    return NextResponse.json(result, { status: result.ok ? 200 : 400 });
  }

  return NextResponse.json({ error: 'Unknown action' }, { status: 400 });
}
