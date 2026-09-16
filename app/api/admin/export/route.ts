import { NextRequest, NextResponse } from 'next/server';
import { auth } from '@/lib/auth';
import { db } from '@/lib/db';
import {
  brands, users, skills, corrections, interviewSessions, drafts, ownPosts,
} from '@/lib/db/schema';
import { eq, and, desc, inArray } from 'drizzle-orm';
import type { QuestionAsked } from '@/lib/db/schema';

function isAdmin(email: string | null | undefined): boolean {
  const adminEmail = process.env.ADMIN_EMAIL;
  if (!adminEmail || !email) return false;
  return adminEmail.split(',').map(e => e.trim().toLowerCase()).includes(email.toLowerCase());
}

function safe(v: unknown): string {
  if (v == null) return '';
  if (typeof v === 'string') return v;
  if (Array.isArray(v)) return v.join(', ');
  return String(v);
}

function fmtDate(d: Date | string | null | undefined): string {
  if (!d) return 'unknown';
  return new Date(d).toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric' });
}

export async function GET(req: NextRequest) {
  const session = await auth();
  if (!isAdmin(session?.user?.email)) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  const brandId = req.nextUrl.searchParams.get('brandId');
  if (!brandId) return NextResponse.json({ error: 'brandId required' }, { status: 400 });

  const [brand] = await db
    .select()
    .from(brands)
    .where(eq(brands.id, brandId))
    .limit(1);
  if (!brand) return NextResponse.json({ error: 'Brand not found' }, { status: 404 });

  const [user] = await db
    .select({ email: users.email, planTier: users.planTier })
    .from(users)
    .where(eq(users.id, brand.userId))
    .limit(1);

  const [skillRows, correctionRows, interviewRows, draftRows, ownPostRows] = await Promise.all([
    db.select().from(skills)
      .where(and(eq(skills.brandId, brandId), inArray(skills.status, ['active', 'consolidated'])))
      .orderBy(skills.kind, skills.name),

    db.select().from(corrections)
      .where(eq(corrections.brandId, brandId))
      .orderBy(desc(corrections.createdAt))
      .limit(50),

    db.select({
      id: interviewSessions.id,
      status: interviewSessions.status,
      startedAt: interviewSessions.startedAt,
      completedAt: interviewSessions.completedAt,
      transcriptMarkdown: interviewSessions.transcriptMarkdown,
      questionsAsked: interviewSessions.questionsAsked,
      guestName: interviewSessions.guestName,
    })
      .from(interviewSessions)
      .where(eq(interviewSessions.brandId, brandId))
      .orderBy(desc(interviewSessions.startedAt)),

    db.select({
      content: drafts.content,
      status: drafts.status,
      qualityScore: drafts.qualityScore,
      contentCategory: drafts.contentCategory,
      postedAt: drafts.postedAt,
      likes: drafts.likes,
      reposts: drafts.reposts,
      impressions: drafts.impressions,
      createdAt: drafts.createdAt,
    })
      .from(drafts)
      .where(eq(drafts.brandId, brandId))
      .orderBy(desc(drafts.createdAt))
      .limit(200),

    db.select({
      platform: ownPosts.platform,
      content: ownPosts.content,
      postedAt: ownPosts.postedAt,
      likeCount: ownPosts.likeCount,
      retweetCount: ownPosts.retweetCount,
      viewCount: ownPosts.viewCount,
    })
      .from(ownPosts)
      .where(eq(ownPosts.brandId, brandId))
      .orderBy(desc(ownPosts.postedAt))
      .limit(100),
  ]);

  // ── Build markdown ────────────────────────────────────────────────────────────
  const lines: string[] = [];

  lines.push(`# ${brand.name} — Full Export`);
  lines.push(`> Generated ${fmtDate(new Date())} · Plan: ${user?.planTier ?? 'unknown'} · ${user?.email ?? ''}`);
  lines.push('');

  // ── Profile ───────────────────────────────────────────────────────────────────
  lines.push('## Profile');
  lines.push('');
  if (brand.handle) lines.push(`**Twitter:** @${brand.handle}`);
  if (brand.linkedinHandle) lines.push(`**LinkedIn:** ${brand.linkedinHandle}`);
  if (brand.niche) lines.push(`**Niche:** ${brand.niche}`);
  if (brand.voiceSummary) lines.push(`**Voice summary:** ${brand.voiceSummary}`);
  const pillars = (brand.contentPillars as string[] | null)?.filter(Boolean) ?? [];
  if (pillars.length) lines.push(`**Content pillars:** ${pillars.join(', ')}`);
  const categories = (brand.selectedCategories ?? []).filter(Boolean);
  if (categories.length) lines.push(`**Selected categories:** ${categories.join(', ')}`);
  lines.push('');

  if (brand.briefMd) {
    lines.push('### Brief');
    lines.push('');
    lines.push(brand.briefMd);
    lines.push('');
  }

  if (brand.voiceDocument) {
    lines.push('### Voice Document');
    lines.push(`> Last updated: ${fmtDate(brand.voiceDocumentUpdatedAt)}`);
    lines.push('');
    lines.push(brand.voiceDocument);
    lines.push('');
  }

  if (brand.styleGuideMd) {
    lines.push('### Style Guide');
    lines.push('');
    lines.push(brand.styleGuideMd);
    lines.push('');
  }

  // ── Skills ────────────────────────────────────────────────────────────────────
  if (skillRows.length > 0) {
    lines.push('---');
    lines.push('');
    lines.push(`## Skills (${skillRows.length})`);
    lines.push('');

    const byKind = new Map<string, typeof skillRows>();
    for (const s of skillRows) {
      if (!byKind.has(s.kind)) byKind.set(s.kind, []);
      byKind.get(s.kind)!.push(s);
    }
    for (const [kind, items] of byKind) {
      lines.push(`### ${kind.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase())}`);
      lines.push('');
      for (const s of items) {
        const conf = Math.round(s.confidence * 100);
        lines.push(`**${s.name}** *(${conf}% confidence, ${s.source})*`);
        lines.push(s.body);
        lines.push('');
      }
    }
  }

  // ── Corrections / User Feedback ───────────────────────────────────────────────
  if (correctionRows.length > 0) {
    lines.push('---');
    lines.push('');
    lines.push(`## User Corrections (${correctionRows.length})`);
    lines.push('');
    for (const c of correctionRows) {
      lines.push(`- **${fmtDate(c.createdAt)}:** ${c.note}`);
      if (c.context) lines.push(`  > Context: ${c.context}`);
    }
    lines.push('');
  }

  // ── Interviews ────────────────────────────────────────────────────────────────
  const completedInterviews = interviewRows.filter(i => i.status === 'completed');
  const incompleteInterviews = interviewRows.filter(i => i.status !== 'completed');

  if (interviewRows.length > 0) {
    lines.push('---');
    lines.push('');
    lines.push(`## Interviews (${completedInterviews.length} completed, ${incompleteInterviews.length} incomplete)`);
    lines.push('');

    for (const iv of interviewRows) {
      const qa = (iv.questionsAsked as QuestionAsked[]) ?? [];
      const answered = qa.filter(q => q.answer && q.answer !== '[skipped]').length;
      lines.push(`### ${fmtDate(iv.startedAt ?? iv.completedAt)} — ${iv.status.toUpperCase()}`);
      if (iv.guestName) lines.push(`> Respondent: ${iv.guestName}`);
      lines.push(`> ${answered} answer${answered !== 1 ? 's' : ''}`);
      lines.push('');

      if (iv.transcriptMarkdown) {
        lines.push(iv.transcriptMarkdown);
      } else if (qa.length > 0) {
        for (let i = 0; i < qa.length; i++) {
          const q = qa[i];
          lines.push(`**Q${i + 1}:** ${q.question}`);
          lines.push('');
          lines.push(q.answer === '[skipped]' ? '*[Skipped]*' : q.answer);
          lines.push('');
        }
      }
      lines.push('');
    }
  }

  // ── Drafts ────────────────────────────────────────────────────────────────────
  if (draftRows.length > 0) {
    lines.push('---');
    lines.push('');
    lines.push(`## Drafts & Posts (${draftRows.length})`);
    lines.push('');

    const grouped = new Map<string, typeof draftRows>();
    for (const d of draftRows) {
      const key = d.status;
      if (!grouped.has(key)) grouped.set(key, []);
      grouped.get(key)!.push(d);
    }
    const statusOrder = ['posted', 'scored', 'review', 'approved', 'draft', 'idea'];
    for (const status of statusOrder) {
      const items = grouped.get(status);
      if (!items?.length) continue;
      lines.push(`### ${status.charAt(0).toUpperCase() + status.slice(1)} (${items.length})`);
      lines.push('');
      for (const d of items) {
        const score = d.qualityScore ? ` · Score: ${d.qualityScore.toFixed(1)}` : '';
        const perf = d.likes != null ? ` · ❤ ${d.likes} 🔁 ${d.reposts ?? 0}${d.impressions ? ` · ${d.impressions} impressions` : ''}` : '';
        lines.push(`**${fmtDate(d.postedAt ?? d.createdAt)}**${score}${perf}`);
        lines.push('');
        lines.push(d.content);
        lines.push('');
      }
    }
  }

  // ── Own Posts (Scraped) ────────────────────────────────────────────────────────
  if (ownPostRows.length > 0) {
    lines.push('---');
    lines.push('');
    lines.push(`## Scraped Posts (${ownPostRows.length})`);
    lines.push('');
    for (const p of ownPostRows) {
      const perf = ` · ❤ ${p.likeCount} 🔁 ${p.retweetCount}${p.viewCount ? ` · ${p.viewCount} views` : ''}`;
      lines.push(`**${fmtDate(p.postedAt)} — ${p.platform}**${perf}`);
      lines.push('');
      lines.push(safe(p.content));
      lines.push('');
    }
  }

  const md = lines.join('\n');
  const filename = `${brand.name.replace(/[^a-z0-9]/gi, '-').toLowerCase()}-export-${new Date().toISOString().slice(0, 10)}.md`;

  return new NextResponse(md, {
    headers: {
      'Content-Type': 'text/markdown; charset=utf-8',
      'Content-Disposition': `attachment; filename="${filename}"`,
    },
  });
}
