import { NextRequest, NextResponse } from 'next/server';
import { auth } from '@/lib/auth';
import { db } from '@/lib/db';
import { postPatterns, templateUsage, brands } from '@/lib/db/schema';
import { eq, notInArray, sql, and, gte, desc } from 'drizzle-orm';
import { callAI, parseJSON, MODEL_EXTRACT } from '@/lib/ai';

// GET /api/viral-templates?exclude=uuid1,uuid2&hookType=contrarian&format=single-punch&topic=some+words
// Returns one pattern not recently used by this brand, scored by topic relevance.
export async function GET(req: NextRequest) {
  const session = await auth();
  if (!session?.user?.id) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const userId = session.user.id;
  const url = new URL(req.url);
  const excludeParam = url.searchParams.get('exclude') ?? '';
  const hookTypeFilter = url.searchParams.get('hookType') ?? null;
  const formatFilter = url.searchParams.get('format') ?? null;
  const topic = url.searchParams.get('topic') ?? '';

  const clientExcluded = excludeParam.split(',').filter(s => s.trim().match(/^[0-9a-f-]{36}$/i));

  // Fetch the brand for this user
  const [brand] = await db
    .select({ id: brands.id })
    .from(brands)
    .where(and(eq(brands.userId, userId), eq(brands.isActive, true)))
    .orderBy(desc(brands.createdAt))
    .limit(1);

  // Get templates used by this brand in the last 60 days
  const serverExcluded: string[] = [];
  if (brand?.id) {
    const since = new Date(Date.now() - 60 * 24 * 60 * 60 * 1000);
    const recentUsage = await db
      .select({ templateId: templateUsage.templateId })
      .from(templateUsage)
      .where(and(eq(templateUsage.brandId, brand.id), gte(templateUsage.createdAt, since)));
    serverExcluded.push(...recentUsage.map(r => r.templateId));
  }

  // Merge client-side + server-side exclusions
  const allExcluded = [...new Set([...clientExcluded, ...serverExcluded])];

  // Extract meaningful keywords from topic (3+ chars, ignore common words)
  const STOP_WORDS = new Set(['the','and','for','with','this','that','from','have','are','was','not','but','they','been','their','has','had','will','can','its','our','you','your','what','how','why','when','who']);
  const keywords = topic
    .toLowerCase()
    .split(/\W+/)
    .filter(w => w.length >= 3 && !STOP_WORDS.has(w))
    .slice(0, 10);

  // Pull candidates: active, not excluded, with optional filters
  // We fetch up to 100 and score them in JS for keyword relevance
  async function fetchCandidates(withExclude: boolean) {
    const exclusions = withExclude ? allExcluded : [];
    const baseCondition = and(
      eq(postPatterns.isActive, true),
      hookTypeFilter ? eq(postPatterns.hookType, hookTypeFilter) : undefined,
      formatFilter ? eq(postPatterns.formatType, formatFilter) : undefined,
      exclusions.length > 0 ? notInArray(postPatterns.id, exclusions) : undefined,
    );

    return db
      .select({
        id: postPatterns.id,
        name: postPatterns.name,
        description: postPatterns.description,
        hookType: postPatterns.hookType,
        formatType: postPatterns.formatType,
        bodyStructure: postPatterns.bodyStructure,
        engagementTarget: postPatterns.engagementTarget,
        emotionTrigger: postPatterns.emotionTrigger,
        viralMechanic: postPatterns.viralMechanic,
        postType: postPatterns.postType,
        reusableFor: postPatterns.reusableFor,
        coreInsight: postPatterns.coreInsight,
        isQrt: postPatterns.isQrt,
      })
      .from(postPatterns)
      .where(baseCondition)
      .orderBy(sql`RANDOM()`)
      .limit(100);
  }

  let candidates = await fetchCandidates(true);
  if (candidates.length === 0) candidates = await fetchCandidates(false);
  if (candidates.length === 0) return NextResponse.json({ error: 'No patterns available' }, { status: 404 });

  // Score by topic keyword overlap with reusableFor tags + coreInsight
  function scoreCandidate(c: typeof candidates[number]): number {
    if (keywords.length === 0) return 0;
    const tags = ((c.reusableFor ?? []) as string[]).map(t => t.toLowerCase()).join(' ');
    const insight = (c.coreInsight ?? '').toLowerCase();
    const desc = (c.description ?? '').toLowerCase();
    const haystack = `${tags} ${insight} ${desc}`;
    let score = 0;
    for (const kw of keywords) {
      if (haystack.includes(kw)) score++;
    }
    // Bonus for save-targeted patterns (highest retention)
    if (c.engagementTarget === 'save') score += 0.5;
    return score;
  }

  // Sort by score desc, pick the best
  candidates.sort((a, b) => scoreCandidate(b) - scoreCandidate(a));
  const pattern = candidates[0];

  return NextResponse.json({
    id: pattern.id,
    name: pattern.name,
    description: pattern.description ?? '',
    hookType: pattern.hookType ?? '',
    formatType: pattern.formatType ?? '',
    bodyStructure: pattern.bodyStructure ?? '',
    engagementTarget: pattern.engagementTarget ?? '',
    emotionTrigger: pattern.emotionTrigger ?? '',
    viralMechanic: pattern.viralMechanic ?? '',
    postType: pattern.postType ?? 'tweet',
    isQrt: pattern.isQrt ?? false,
  });
}

// POST /api/viral-templates
// Body: { content: string }
// AI-extracts structural template from a post and saves it to postPatterns.
export async function POST(req: NextRequest) {
  const session = await auth();
  if (!session?.user?.id) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const body = await req.json().catch(() => ({}));
  const content = typeof body.content === 'string' ? body.content.trim() : '';
  if (!content) return NextResponse.json({ error: 'content is required' }, { status: 400 });

  const prompt = `Analyze this social media post and extract its reusable structural template. The template must be faithful enough that someone following it produces a post with the same sentence count, sentence lengths, line breaks, and phrasing register — not just the same topic shape.

POST:
"""
${content}
"""

Return this exact JSON shape (no extra keys, no markdown fences):
{
  "name": "Short descriptive name for this pattern (5-8 words)",
  "template": "Line-for-line structural blueprint. Replace ONLY the specific details (people, numbers, product names, events) with [descriptive placeholders]. Keep every connecting word, sentence opener, transition, and phrasing pattern intact — these are structural, not content. Preserve blank lines between sections exactly as they appear in the original. If the original has 3 short punchy lines then a blank line then a closer, the template must too.",
  "hookType": "one of: contrarian | story | outcome | question | how-to | list | stat | identity",
  "formatType": "one of: single-punch | line-per-point | numbered-list | before-after | narrative | comparison",
  "bodyStructure": "one of: short-punch | before-after | narrative | stacked-proof | breakdown | none",
  "closerType": "one of: punchline | question-cta | open-loop | call-to-action | reflection | none",
  "engagementTarget": "one of: save | share | reply | follow",
  "coreInsight": "1-2 sentences: why this structure works and what makes readers engage with it",
  "viralMechanic": "one of: gap-reveal | borrowed-authority | debate-bait | relatability | aspiration | fear | social-proof | curiosity-loop",
  "emotionTrigger": "one of: curiosity | aspiration | fear | validation | surprise | humor | nostalgia | anger",
  "contentCategory": "one of: thought-leadership | build-in-public | storytelling | authority | educational | thesis-building | ragebait | engagement-bait. Use engagement-bait ONLY for posts whose main mechanic is farming replies (asking readers to drop a link, tag someone, guess a number, pick a side, fill a blank). A contrarian opinion that happens to start arguments is thought-leadership, not engagement-bait.",
  "reusableFor": ["array", "of", "topic", "tags", "this", "works", "for"]
}`;

  let extracted: Record<string, unknown>;
  try {
    const raw = await callAI({ model: MODEL_EXTRACT, prompt, temperature: 0.3, maxTokens: 900 });
    extracted = parseJSON(raw) ?? {};
  } catch {
    return NextResponse.json({ error: 'AI extraction failed' }, { status: 502 });
  }

  const name = typeof extracted.name === 'string' ? extracted.name : 'Custom template';
  const template = typeof extracted.template === 'string' ? extracted.template : content;

  const [inserted] = await db.insert(postPatterns).values({
    name,
    template,
    example: content,
    hookType: typeof extracted.hookType === 'string' ? extracted.hookType : null,
    formatType: typeof extracted.formatType === 'string' ? extracted.formatType : null,
    bodyStructure: typeof extracted.bodyStructure === 'string' ? extracted.bodyStructure : null,
    closerType: typeof extracted.closerType === 'string' ? extracted.closerType : null,
    engagementTarget: typeof extracted.engagementTarget === 'string' ? extracted.engagementTarget : null,
    coreInsight: typeof extracted.coreInsight === 'string' ? extracted.coreInsight : null,
    viralMechanic: typeof extracted.viralMechanic === 'string' ? extracted.viralMechanic : null,
    emotionTrigger: typeof extracted.emotionTrigger === 'string' ? extracted.emotionTrigger : null,
    contentCategory: typeof extracted.contentCategory === 'string' ? extracted.contentCategory : null,
    reusableFor: Array.isArray(extracted.reusableFor) ? extracted.reusableFor as string[] : [],
    postType: 'tweet',
    isActive: true,
  }).returning({ id: postPatterns.id, name: postPatterns.name });

  return NextResponse.json({ ok: true, id: inserted.id, name: inserted.name }, { status: 201 });
}
