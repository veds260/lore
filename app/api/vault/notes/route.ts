import { NextRequest, NextResponse } from 'next/server';
import { auth } from '@/lib/auth';
import { listTenantVaultNotes, resolveTenantScope } from '@/lib/vault/workspace';
import { upsertVaultNote } from '@/lib/vault/notes';

const ALLOWED_TYPES = ['rule', 'story', 'belief', 'proof', 'idea', 'post', 'visual', 'profile'] as const;
type NoteType = typeof ALLOWED_TYPES[number];

export async function GET(req: NextRequest) {
  const session = await auth();
  if (!session?.user?.id) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const scope = await resolveTenantScope(session.user.id);
  if (!scope) return NextResponse.json({ notes: [] });

  const url = new URL(req.url);
  const typeParam = url.searchParams.get('type');
  const types = typeParam?.split(',').filter((t): t is NoteType => (ALLOWED_TYPES as readonly string[]).includes(t)) ?? [];

  const rows = await listTenantVaultNotes(scope, { types, limit: 300 });
  return NextResponse.json({ notes: rows });
}

export async function POST(req: NextRequest) {
  const session = await auth();
  if (!session?.user?.id) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const scope = await resolveTenantScope(session.user.id);
  if (!scope) return NextResponse.json({ error: 'No active brand' }, { status: 400 });

  const body = await req.json().catch(() => ({})) as {
    title?: string; type?: string; tags?: string[]; topics?: string[];
    summary?: string; body?: string; path?: string; status?: string;
  };

  if (!body.title?.trim()) return NextResponse.json({ error: 'title required' }, { status: 400 });
  const type = (ALLOWED_TYPES as readonly string[]).includes(body.type ?? '') ? body.type as NoteType : 'idea';
  const safePath = body.path?.trim() || `${typeFolder(type)}/${slugify(body.title)}-${Date.now()}.md`;
  const status = (body.status === 'archived' || body.status === 'needs_review' || body.status === 'active')
    ? body.status as 'active' | 'archived' | 'needs_review'
    : 'active';

  const id = await upsertVaultNote({
    userId: scope.userId,
    brandId: scope.brandId,
    scope: 'tenant',
    path: safePath,
    title: body.title.trim(),
    type,
    tags: body.tags ?? [],
    topics: body.topics ?? [],
    summary: body.summary,
    body: body.body,
    source: 'manual',
    status,
  });

  return NextResponse.json({ id });
}

function typeFolder(type: NoteType): string {
  if (type === 'rule') return '50-rules/manual';
  if (type === 'profile') return '00-profile';
  if (type === 'story') return '20-stories';
  if (type === 'proof') return '30-proof';
  if (type === 'idea') return '10-ideas';
  if (type === 'post') return '40-posts';
  if (type === 'belief') return '00-profile';
  if (type === 'visual') return '50-visuals/notes';
  return '10-ideas';
}

function slugify(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 60) || 'note';
}
