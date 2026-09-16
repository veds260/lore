import { NextRequest, NextResponse } from 'next/server';
import { and, desc, eq } from 'drizzle-orm';
import { auth } from '@/lib/auth';
import { db } from '@/lib/db';
import { brands } from '@/lib/db/schema';
import { getActiveBrandId } from '@/lib/active-brand';
import { callAI, parseJSON, MODEL_EXTRACT } from '@/lib/ai';
import { z } from 'zod';
import { modelAvailable } from '@/lib/providers';

const Schema = z.object({
  markdown: z.string().min(20).max(60000),
});

interface Extracted {
  name?: string | null;
  whatYouDo?: string | null;
  recentWin?: string | null;
  strongBelief?: string | null;
  expertise?: string[] | null;
  audience?: string | null;
  positioning?: string | null;
  credibilityMarkers?: string[] | null;
  writingTone?: string[] | null;
  contentThemes?: string[] | null;
  backgroundSummary?: string | null;
  niche?: string | null;
  voiceSummary?: string | null;
}

export async function POST(req: NextRequest) {
  const session = await auth();
  if (!session?.user?.id) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const body = await req.json().catch(() => null);
  const parsed = Schema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: 'Send a markdown/text payload of at least 20 chars' }, { status: 400 });
  }

  const activeBrandId = await getActiveBrandId(session.user.id);
  if (!activeBrandId) return NextResponse.json({ error: 'No active brand' }, { status: 404 });

  // Fetch the existing brand so we can merge instead of overwrite
  const [brand] = await db
    .select()
    .from(brands)
    .where(and(eq(brands.id, activeBrandId), eq(brands.userId, session.user.id)))
    .limit(1);

  if (!brand) return NextResponse.json({ error: 'Brand not found' }, { status: 404 });

  if (!(await modelAvailable())) {
    return NextResponse.json({ error: 'No model backend is set up. Open /setup to connect one.' }, { status: 503 });
  }

  // Extraction prompt, same shape as parse-profile but tuned for "augment existing"
  const prompt = `You are reading a new document the user uploaded to extend Lore's understanding of them. They already have a profile — this is additional context (a new bio, transcript, blog post, case study, or ChatGPT export).

Extract structured fields. Return null for anything you can't confidently pull — never fabricate.

Existing brand context:
- Name: ${brand.name ?? 'unknown'}
- Niche: ${brand.niche ?? '(none)'}
- Existing voice summary: ${brand.voiceSummary?.slice(0, 200) ?? '(none)'}

FIELDS TO EXTRACT (return null if not clearly stated or strongly implied):
- whatYouDo: short plain-language sentence about what they do
- recentWin: a specific result, metric, or outcome mentioned
- strongBelief: a sharp contrarian opinion from the doc
- expertise: 3-6 specific topics they show depth in
- audience: who they write/work for, specific
- positioning: their unique angle
- credibilityMarkers: 2-4 fact-based authority signals
- writingTone: 3-5 adjectives describing their style
- contentThemes: recurring topics
- backgroundSummary: 2-3 sentences on their journey
- niche: refined niche if you can derive a tighter one from this doc
- voiceSummary: 1 sentence describing how they write (only if the doc shows clear stylistic patterns)

Document:
---
${parsed.data.markdown.slice(0, 12000)}
---

Return ONLY a JSON object. No markdown fences, no explanation.`;

  let extracted: Extracted | null = null;
  try {
    const text = await callAI({ model: MODEL_EXTRACT, prompt, temperature: 0.2, maxTokens: 1500 });
    extracted = parseJSON<Extracted>(text);
  } catch (err) {
    console.error('[profile/augment] AI extraction failed:', err);
    return NextResponse.json({ error: 'Could not read the document' }, { status: 500 });
  }
  if (!extracted) {
    return NextResponse.json({ error: 'Could not parse extraction' }, { status: 500 });
  }

  // Merge into existing brand. Rule: only set/append when the field is non-empty.
  //  - Scalar text fields: overwrite only if new value exists AND current is empty
  //  - Voice summary / niche / whatYouDo: prefer new if more specific (longer + non-empty)
  //  - Array fields (expertise, themes, etc.): merge unique
  //  - briefMd: append new context as a new section so we never lose past info
  const updates: Record<string, unknown> = { updatedAt: new Date() };
  const learned: string[] = [];

  if (extracted.niche && (!brand.niche || extracted.niche.length > brand.niche.length)) {
    updates.niche = extracted.niche;
    learned.push('niche');
  }
  if (extracted.voiceSummary && (!brand.voiceSummary || extracted.voiceSummary.length > 80)) {
    updates.voiceSummary = extracted.voiceSummary;
    learned.push('voice summary');
  }

  // Merge unique into contentPillars (treated as themes)
  if (extracted.contentThemes && extracted.contentThemes.length > 0) {
    const existing = new Set((brand.contentPillars ?? []).map(p => p.toLowerCase()));
    const merged = [...(brand.contentPillars ?? [])];
    for (const t of extracted.contentThemes) {
      if (t && !existing.has(t.toLowerCase())) {
        merged.push(t);
        existing.add(t.toLowerCase());
      }
    }
    if (merged.length !== (brand.contentPillars ?? []).length) {
      updates.contentPillars = merged.slice(0, 8);
      learned.push('content themes');
    }
  }

  // Append a structured note to briefMd so we don't lose the source
  const newSections: string[] = [];
  if (extracted.whatYouDo)         newSections.push(`What you do (added): ${extracted.whatYouDo}`);
  if (extracted.audience)          newSections.push(`Audience (added): ${extracted.audience}`);
  if (extracted.positioning)       newSections.push(`Unique angle (added): ${extracted.positioning}`);
  if (extracted.backgroundSummary) newSections.push(`Background (added): ${extracted.backgroundSummary}`);
  if (extracted.recentWin)         newSections.push(`Recent win (added): ${extracted.recentWin}`);
  if (extracted.strongBelief)      newSections.push(`Core belief (added): ${extracted.strongBelief}`);
  if (extracted.credibilityMarkers?.length) {
    newSections.push(`Credibility (added):\n${extracted.credibilityMarkers.map(c => `- ${c}`).join('\n')}`);
  }
  if (extracted.expertise?.length) {
    newSections.push(`Expertise (added):\n${extracted.expertise.map(e => `- ${e}`).join('\n')}`);
  }
  if (extracted.writingTone?.length) {
    newSections.push(`Tone (added): ${extracted.writingTone.join(', ')}`);
  }

  if (newSections.length > 0) {
    const stamp = new Date().toISOString().slice(0, 10);
    const newBlock = `\n\n## Added ${stamp}\n${newSections.join('\n\n')}`;
    updates.briefMd = (brand.briefMd ?? '') + newBlock;
    if (extracted.whatYouDo)         learned.push('what you do');
    if (extracted.audience)          learned.push('audience');
    if (extracted.positioning)       learned.push('positioning');
    if (extracted.backgroundSummary) learned.push('background');
    if (extracted.recentWin)         learned.push('a recent win');
    if (extracted.strongBelief)      learned.push('a core belief');
    if (extracted.credibilityMarkers?.length) learned.push('credibility markers');
    if (extracted.expertise?.length) learned.push('expertise topics');
    if (extracted.writingTone?.length) learned.push('writing tone');
  }

  // Append the styleGuideMd with the new context too
  if (newSections.length > 0) {
    const styleAddition = `\n\n## Added context (${new Date().toISOString().slice(0, 10)})\n${newSections.join('\n\n')}`;
    updates.styleGuideMd = (brand.styleGuideMd ?? '') + styleAddition;
  }

  if (Object.keys(updates).length === 1) {
    // Only updatedAt was set, nothing learned
    return NextResponse.json({
      ok: true,
      learned: [],
      message: "Couldn't find anything new to add. Try a longer or more specific document.",
    });
  }

  await db.update(brands).set(updates).where(eq(brands.id, activeBrandId));

  return NextResponse.json({
    ok: true,
    learned: Array.from(new Set(learned)),
  });
}
