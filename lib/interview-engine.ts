import { db } from './db';
import {
  brands, skills, ownPosts, drafts, interviewSessions, corrections,
  questionTemplates,
  type GeneratedQuestion, type QuestionAsked,
} from './db/schema';
import { eq, and, desc, like, inArray, gt, gte, isNotNull, isNull, sql } from 'drizzle-orm';
import { callAI, parseJSON, MODEL_EXTRACT, MODEL_CREATIVE } from './ai';
import { SHORT_TEXT_BANS } from './craft-rules';
import { applyRulesFix } from './rules-fixer';
import { ensureVaultMirrored } from './vault/sync';
import { formatVaultContextForPrompt, loadVaultContext } from './vault/search';

const SESSION_QUESTION_COUNT = 9;
const MAX_FOLLOW_UPS = 1;
const MIN_ANSWERS_FOR_SYNTHESIS = 2;
const SESSION_TAG = (id: string) => `[interview:${id}]`;

// ── Pillar-to-template-category mapping ──────────────────────────────────────

const PILLAR_GUIDANCE: Record<string, { categories: string[]; minCount: number; instruction: string }> = {
  'build-in-public': {
    categories: ['build_in_public'],
    minCount: 2,
    instruction: 'Include at least 2 build_in_public questions — ask about current active work, recent decisions, customer interactions, struggles, or live metrics. These extract raw material for ongoing journey posts, NOT just launch announcements.',
  },
  'educational': {
    categories: ['technical', 'framework', 'how_to', 'lessons'],
    minCount: 2,
    instruction: 'Include 1-2 questions from how_to / framework / lessons that extract teachable frameworks, step-by-step processes, or hard-won lessons the audience can apply.',
  },
  'storytelling': {
    categories: ['origin_story', 'failure_story', 'turning_point', 'success_story'],
    minCount: 1,
    instruction: 'Include 1-2 narrative questions from origin_story / failure_story / turning_point. Extract a concrete scene with emotional stakes, not a summary.',
  },
  'case-study': {
    categories: ['success_story', 'failure_story', 'technical'],
    minCount: 1,
    instruction: 'Include 1 detailed outcome question from success_story or technical. Get specific numbers, before/after contrast, and timeline. Data-backed case study material.',
  },
  'contrarian-take': {
    categories: ['contrarian_view', 'industry_critique', 'hot_take'],
    minCount: 1,
    instruction: 'Include 1 contrarian_view or industry_critique question. Push them to say something most people in their niche would push back on — a real position, not a softened opinion.',
  },
  'hot-take': {
    categories: ['hot_take', 'contrarian_view'],
    minCount: 1,
    instruction: 'Include 1 hot_take question — surface a strong, specific opinion that contradicts common advice in their niche.',
  },
  'authority': {
    categories: ['success_story', 'advice', 'lessons'],
    minCount: 1,
    instruction: 'Include 1 success_story or advice question that surfaces specific results, client outcomes, or credentials that establish expertise concretely.',
  },
  'thought-leadership': {
    categories: ['prediction', 'values', 'influences'],
    minCount: 1,
    instruction: 'Include 1 prediction or values question — get their long-horizon view on where their space is heading, or the core belief that underlies all their work.',
  },
  'thesis-building': {
    categories: ['prediction', 'values', 'industry_critique'],
    minCount: 1,
    instruction: 'Include 1 prediction or industry_critique question that extracts the non-obvious central insight their whole body of work is built around.',
  },
};

// ── Brand context loader ──────────────────────────────────────────────────────

// Maps the interview angle categories from extractAngles() to content categories
const ANGLE_TO_CONTENT_CATEGORY: Record<string, string> = {
  hot_take: 'hot-take',
  story: 'storytelling',
  lesson: 'educational',
  prediction: 'thought-leadership',
  how_to: 'educational',
  values: 'thought-leadership',
};

interface BrandContext {
  name: string;
  niche: string | null;
  contentPillars: string[];
  selectedCategories: string[];
  voiceDocument: string | null;
  briefMd: string | null;
  styleGuideMd: string | null;
  weeklyFocus: string | null;
  recentPostsSample: string[];
  topPostsSample: string[];
  activeSkillSummary: string | null;
  recentCorrections: string | null;
  recentDraftTopics: string | null;
  pillarPerformanceSummary: string | null;
  pastInterviewSummary: string | null;
}

async function loadBrandContext(brandId: string, userId: string): Promise<BrandContext | null> {
  const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);

  const [
    [brand],
    recentPosts,
    topPosts,
    activeSkills,
    pastSessions,
    recentCorrRows,
    recentDraftRows,
    pillarStatsRows,
  ] = await Promise.all([
    db.select({
      name: brands.name,
      niche: brands.niche,
      contentPillars: brands.contentPillars,
      selectedCategories: brands.selectedCategories,
      voiceDocument: brands.voiceDocument,
      briefMd: brands.briefMd,
      styleGuideMd: brands.styleGuideMd,
      weeklyFocus: brands.weeklyFocus,
    })
      .from(brands)
      .where(and(eq(brands.id, brandId), eq(brands.userId, userId)))
      .limit(1),

    db.select({ content: ownPosts.content })
      .from(ownPosts)
      .where(eq(ownPosts.brandId, brandId))
      .orderBy(desc(ownPosts.postedAt))
      .limit(10),

    db.select({ content: ownPosts.content, likes: ownPosts.likeCount, retweets: ownPosts.retweetCount })
      .from(ownPosts)
      .where(and(eq(ownPosts.brandId, brandId), gt(ownPosts.likeCount, 5)))
      .orderBy(desc(ownPosts.likeCount))
      .limit(5),

    db.select({ name: skills.name, kind: skills.kind, body: skills.body })
      .from(skills)
      .where(and(eq(skills.brandId, brandId), eq(skills.status, 'active'), isNull(skills.absorbedAt)))
      .orderBy(desc(skills.confidence))
      .limit(20),

    db.select({
      transcriptMarkdown: interviewSessions.transcriptMarkdown,
      completedAt: interviewSessions.completedAt,
    })
      .from(interviewSessions)
      .where(and(eq(interviewSessions.brandId, brandId), eq(interviewSessions.status, 'completed')))
      .orderBy(desc(interviewSessions.completedAt))
      .limit(2),

    db.select({ note: corrections.note, context: corrections.context })
      .from(corrections)
      .where(eq(corrections.brandId, brandId))
      .orderBy(desc(corrections.createdAt))
      .limit(10),

    db.select({ content: drafts.content })
      .from(drafts)
      .where(and(eq(drafts.brandId, brandId), inArray(drafts.status, ['idea', 'draft', 'review'])))
      .orderBy(desc(drafts.createdAt))
      .limit(10),

    db.select({
      category: drafts.contentCategory,
      status: drafts.status,
      count: sql<number>`count(*)::int`,
      lastCreated: sql<string>`max(${drafts.createdAt})::text`,
    })
      .from(drafts)
      .where(and(
        eq(drafts.brandId, brandId),
        isNotNull(drafts.contentCategory),
        gte(drafts.createdAt, thirtyDaysAgo),
      ))
      .groupBy(drafts.contentCategory, drafts.status),
  ]);

  if (!brand) return null;

  const pastInterviewSummary = pastSessions.length > 0
    ? pastSessions.map((s, i) => {
      const date = s.completedAt?.toLocaleDateString() ?? 'earlier';
      const excerpt = (s.transcriptMarkdown ?? '').slice(0, 1200);
      return `Session ${i + 1} (${date}):\n${excerpt}${excerpt.length >= 1200 ? '...' : ''}`;
    }).join('\n\n---\n\n')
    : null;

  const recentCorrections = recentCorrRows.length > 0
    ? recentCorrRows.map(c => `- ${c.note}${c.context ? ` [context: ${c.context.slice(0, 80)}]` : ''}`).join('\n')
    : null;

  const recentDraftTopics = recentDraftRows.length > 0
    ? recentDraftRows.map(d => `- ${d.content.slice(0, 120).replace(/\n/g, ' ')}`).join('\n')
    : null;

  // Roll up pillar stats: category → { drafted, posted, lastDate }
  type PillarStat = { drafted: number; posted: number; lastDate: string | null };
  const categoryStats: Record<string, PillarStat> = {};
  for (const row of pillarStatsRows) {
    if (!row.category) continue;
    if (!categoryStats[row.category]) categoryStats[row.category] = { drafted: 0, posted: 0, lastDate: null };
    categoryStats[row.category].drafted += row.count;
    if (row.status === 'posted') categoryStats[row.category].posted += row.count;
    const stat = categoryStats[row.category]!;
    if (row.lastCreated && (!stat.lastDate || row.lastCreated > stat.lastDate)) {
      stat.lastDate = row.lastCreated;
    }
  }

  // Build the selected-pillar performance summary (used by the interview to prioritise questions)
  const selectedCats = (brand.selectedCategories as string[] | null) ?? [];
  const pillarPerformanceSummary = selectedCats.length > 0
    ? selectedCats.map(cat => {
        const stats = categoryStats[cat];
        if (!stats || stats.drafted === 0) {
          return `- ${cat}: 0 drafts or posts in last 30 days — GAP, this bucket needs raw material`;
        }
        const daysSinceLast = stats.lastDate
          ? Math.floor((Date.now() - new Date(stats.lastDate).getTime()) / 86_400_000)
          : null;
        const recency = daysSinceLast == null ? ''
          : daysSinceLast <= 3 ? ', active'
          : daysSinceLast <= 10 ? `, last ${daysSinceLast}d ago`
          : `, last ${daysSinceLast}d ago — GOING COLD`;
        return `- ${cat}: ${stats.drafted} drafted, ${stats.posted} published${recency}`;
      }).join('\n')
    : null;

  return {
    name: brand.name,
    niche: brand.niche,
    contentPillars: (brand.contentPillars as string[] | null) ?? [],
    selectedCategories: brand.selectedCategories ?? [],
    voiceDocument: brand.voiceDocument,
    briefMd: brand.briefMd,
    styleGuideMd: brand.styleGuideMd,
    weeklyFocus: brand.weeklyFocus,
    recentPostsSample: recentPosts.slice(0, 6).map(p => p.content.slice(0, 220)),
    topPostsSample: topPosts.map(p => `[${p.likes}♥ ${p.retweets}↺] ${p.content.slice(0, 200)}`),
    activeSkillSummary: activeSkills.length > 0
      ? activeSkills.map(s => `- [${s.kind}] ${s.name}: ${s.body.slice(0, 150)}`).join('\n')
      : null,
    recentCorrections,
    recentDraftTopics,
    pillarPerformanceSummary,
    pastInterviewSummary,
  };
}

// ── Question generation ───────────────────────────────────────────────────────

export async function generateQuestionsForSession(
  brandId: string,
  userId: string,
): Promise<GeneratedQuestion[]> {
  const context = await loadBrandContext(brandId, userId);
  const templates = await db
    .select({
      id: questionTemplates.id,
      category: questionTemplates.category,
      baseQuestion: questionTemplates.baseQuestion,
      extractionGoal: questionTemplates.extractionGoal,
      clipPotential: questionTemplates.clipPotential,
    })
    .from(questionTemplates)
    .where(eq(questionTemplates.isActive, true));

  const selectedCategories = context?.selectedCategories ?? [];
  const isFirstSession = !context?.pastInterviewSummary;

  await ensureVaultMirrored(userId, brandId);
  const vaultContext = await loadVaultContext({
    userId,
    brandId,
    topic: [
      context?.weeklyFocus,
      context?.niche,
      context?.selectedCategories?.join(' '),
      context?.contentPillars?.join(' '),
      context?.recentDraftTopics,
    ].filter(Boolean).join('\n'),
    limit: 10,
  }).catch(() => null);
  const vaultPromptBlock = vaultContext ? formatVaultContextForPrompt(vaultContext) : '';

  // Build context sections, richest sources take precedence
  const contextSections = [
    context?.niche
      ? `**Niche:** ${context.niche}`
      : null,

    context?.weeklyFocus
      ? `**Currently focused on:** ${context.weeklyFocus}`
      : null,

    // Voice document is the richest source, use it over brief voiceSummary
    context?.voiceDocument
      ? `**Who they are (voice doc):**\n${context.voiceDocument.slice(0, 800)}`
      : context?.briefMd
      ? `**Background:**\n${context.briefMd.slice(0, 600)}`
      : null,

    context?.styleGuideMd
      ? `**Style guide:**\n${context.styleGuideMd.slice(0, 400)}`
      : null,

    context?.topPostsSample?.length
      ? `**Their highest-performing posts (this is ONE slice of their work — useful for sharpening 1-2 questions about their topic, but do NOT make every question about this niche):**\n${context.topPostsSample.map(p => `"${p}"`).join('\n')}`
      : null,

    context?.recentPostsSample?.length
      ? `**Recent posts (same caveat — context for 1-2 topical questions, not a frame for the whole interview):**\n${context.recentPostsSample.map(p => `"${p}"`).join('\n')}`
      : null,

    context?.activeSkillSummary
      ? `**Learned patterns about this creator's voice and preferences:**\n${context.activeSkillSummary}`
      : null,

    context?.recentCorrections
      ? `**Explicit corrections and preferences the creator has expressed — respect these when forming questions:**\n${context.recentCorrections}`
      : null,

    vaultPromptBlock
      ? `**Obsidian vault context — global rules, tenant rules, learned voice notes, stories, beliefs, proof, and open angles:**\n${vaultPromptBlock}\n\nUse this to ask smarter questions. Prioritise gaps, unresolved beliefs, reusable stories, and rules that need better examples.`
      : null,

    context?.recentDraftTopics
      ? `**Content already in their pipeline (don't ask about these — it's already being written):**\n${context.recentDraftTopics}`
      : null,

    context?.pillarPerformanceSummary
      ? `**Content pillar health (last 30 days — prioritise questions for GAP or GOING COLD buckets):**\n${context.pillarPerformanceSummary}`
      : null,

    context?.contentPillars?.length
      ? `**Content themes:** ${context.contentPillars.join(', ')}`
      : null,
  ].filter(Boolean).join('\n\n');

  const templateList = templates.map(t =>
    `ID:${t.id} [${t.category}] ${t.baseQuestion} (clip_potential:${t.clipPotential})`
  ).join('\n');

  const pillarBlock = selectedCategories.length > 0
    ? `## REQUIRED: Content Pillar Coverage
This creator's chosen content pillars are: ${selectedCategories.join(', ')}
You MUST satisfy these requirements before filling remaining slots:
${selectedCategories
  .map(cat => PILLAR_GUIDANCE[cat])
  .filter(Boolean)
  .map(g => `- ${g!.instruction} (draw from template categories: ${g!.categories.join(', ')})`)
  .join('\n')}`
    : `Cover diverse categories AND diverse angles. Required mix:
- At least 1 origin_story or turning_point question (life before now, the moment things changed — NOT about their current work topic)
- At least 1 contrarian_view or hot_take (a real belief, can be inside or outside their niche)
- At least 1 success_story or failure_story (a concrete scene with stakes)
- At least 1 lessons or advice (something they teach)
- At least 1 prediction or values (where they think things are going, or the principle behind their work)
- Remaining 2-4: mix of habits, influences, industry_critique
Critical: their visible niche is ONE slice of who they are. If their tweets are all about X, that does NOT mean every question should be about X. Ask about who they were before, what they believe outside the niche, what shaped them. Aim for 5-6 questions that any peer of theirs could not have answered identically — questions about their specific personal history, beliefs, and stories — and only 3-4 questions tied to their visible topic.`;

  const pastBlock = !isFirstSession && context?.pastInterviewSummary
    ? `## What was covered in previous sessions
${context.pastInterviewSummary}

DO NOT revisit topics or stories already answered above. Push into new territory.`
    : '';

  const prompt = `You are building a personalized interview question sequence for ${context?.name ?? 'this creator'}.

Your job is to act like someone who has been watching this creator closely. You know their work, what performs well, what they're building, and what gaps exist in their content. Every question should feel like it comes from that knowledge — not from a generic template.

## Full creator context
${contextSections || 'No profile data yet — generate general questions.'}
${pastBlock ? `\n${pastBlock}` : ''}

## Available question templates
${templateList}

## Task
Select exactly ${SESSION_QUESTION_COUNT} templates. For each one, rewrite the base_question so it:
- References something SPECIFIC from their context above (their niche, a recent post, what they're working on, their top-performing content)
- Would only make sense for THIS person — it cannot be copy-pasted to a different creator
- Replaces every [bracket] placeholder with a concrete reference to their actual work

${pillarBlock}

Ordering:
- Q1-2: Warmest, easiest — get them talking about something they're already proud of or actively doing
- Q3-6: Substance — their expertise, opinions, stories. Pillar-specific questions go here.
- Q7-9: Deepest — philosophy, bold takes, dilemmas they haven't resolved yet

Style rules:
- 1 sentence per question, under 15 words — short and direct
- No buildup, no context-setting before the question, no "I noticed that..." preamble
- Never start with "What's your"
- No compound or multi-part questions
- Ask about ONE specific thing — never list multiple topics or areas
- If the context has multiple expertise areas, pick the single most interesting one
${!isFirstSession ? '- Continue from where they left off — reference prior answers if relevant, don\'t restart from the beginning' : ''}

Return ONLY a JSON array:
[
  { "templateId": "uuid", "category": "...", "question": "personalized question text", "extractionGoal": "..." },
  ...
]`;

  let raw: string;
  try {
    raw = await callAI({ model: MODEL_EXTRACT, prompt, temperature: 0.7, maxTokens: 1500 });
  } catch {
    raw = await callAI({ model: MODEL_CREATIVE, prompt, temperature: 0.7, maxTokens: 1500 });
  }

  const arr = parseJSON<GeneratedQuestion[]>(raw) ?? [];

  if (arr.length < SESSION_QUESTION_COUNT) {
    const used = new Set(arr.map(q => q.templateId));
    const fallbacks = templates
      .filter(t => !used.has(t.id))
      .slice(0, SESSION_QUESTION_COUNT - arr.length)
      .map(t => ({
        question: substituteBrackets(t.baseQuestion, context ?? undefined),
        category: t.category,
        extractionGoal: t.extractionGoal,
        templateId: t.id,
      }));
    arr.push(...fallbacks);
  }

  // Defense in depth: scrub any [brackets] the AI left in its rewrites
  for (const q of arr) {
    if (q.question && q.question.includes('[')) {
      q.question = substituteBrackets(q.question, context ?? undefined);
    }
  }

  return arr.slice(0, SESSION_QUESTION_COUNT);
}

// Substitute any [bracketed placeholder] in a question template with sensible defaults
// derived from brand context. Catches every known pattern + a catch-all.
function substituteBrackets(
  text: string,
  context?: { name?: string | null; niche?: string | null; whatYouDo?: string | null },
): string {
  const niche = context?.niche?.trim();
  const name = context?.name?.trim();
  const placeholderText = 'Will be learned';
  const realWhatYouDo =
    context?.whatYouDo && !context.whatYouDo.startsWith(placeholderText)
      ? context.whatYouDo.trim()
      : null;

  // Use || not ??, empty strings should fall through to the default
  const nicheVal = niche || 'your field';
  const nameVal = name || 'your work';
  const whatVal = realWhatYouDo || 'what you do best';

  return text
    // Niche-style
    .replace(/\[(their|your) (field|industry|niche|space|world)\]/gi, nicheVal)
    // Project / brand
    .replace(/\[(their|your) (project|brand|company|business|product)\]/gi, nameVal)
    // "What they do" style
    .replace(/\[the core thing (they're|you're|theyre|youre) known for\]/gi, whatVal)
    .replace(/\[(their|your) (specialty|craft|expertise|skill|work|role|profession|trade)\]/gi, whatVal)
    .replace(/\[what (they|you) (make|build|create|sell|teach|offer)\]/gi, whatVal)
    // Audience-style
    .replace(/\[(their|your) (audience|customers|users|clients|community|readers)\]/gi, 'your audience')
    // Generic catch-all: any remaining [stuff] becomes "your work"
    .replace(/\[[^\]\n]{2,80}\]/g, 'your work');
}

// ── Replacement question (for skips) ─────────────────────────────────────────

export async function generateReplacementQuestion(
  brandId: string,
  userId: string,
  usedTemplateIds: (string | undefined)[],
): Promise<GeneratedQuestion | null> {
  const [context, templates] = await Promise.all([
    loadBrandContext(brandId, userId),
    db.select({
      id: questionTemplates.id,
      category: questionTemplates.category,
      baseQuestion: questionTemplates.baseQuestion,
      extractionGoal: questionTemplates.extractionGoal,
    }).from(questionTemplates).where(eq(questionTemplates.isActive, true)),
  ]);

  const usedIds = new Set(usedTemplateIds.filter(Boolean) as string[]);
  const available = templates.filter(t => !usedIds.has(t.id));
  if (!available.length) return null;

  const template = available[Math.floor(Math.random() * Math.min(available.length, 8))];
  const nameStr = context?.name ?? 'this creator';
  const contextHint = [
    context?.niche ? `Niche: ${context.niche}` : null,
    context?.briefMd ? context.briefMd.slice(0, 400) : context?.voiceDocument ? context.voiceDocument.slice(0, 400) : null,
  ].filter(Boolean).join('\n');

  const prompt = `Generate one personalized interview question for ${nameStr}.

Context: ${contextHint || 'No profile data.'}

Template category: ${template.category}
Base question: ${template.baseQuestion}

Rewrite to reference something specific about their work. 1 short sentence, under 15 words. No brackets, no preamble.

Return ONLY: { "question": "...", "category": "${template.category}", "extractionGoal": "..." }`;

  try {
    const raw = await callAI({ model: MODEL_EXTRACT, prompt, temperature: 0.8, maxTokens: 150 });
    const parsed = parseJSON<{ question: string; category: string; extractionGoal: string }>(raw);
    if (!parsed?.question) return null;
    // Strip any brackets the AI failed to substitute
    if (parsed.question.includes('[')) {
      parsed.question = substituteBrackets(parsed.question, {
        name: context?.name,
        niche: context?.niche,
        whatYouDo: context?.briefMd ?? null,
      });
    }
    return { ...parsed, templateId: template.id };
  } catch {
    return null;
  }
}

// ── Follow-up logic ───────────────────────────────────────────────────────────

export function shouldFollowUp(answer: string, followUpCount: number): boolean {
  if (followUpCount >= MAX_FOLLOW_UPS) return false;
  return answer.trim().split(/\s+/).length > 50;
}

export async function generateFollowUp(question: string, answer: string, category: string): Promise<string> {
  const prompt = `You are conducting a content interview. The interviewer asked a question and got a response.

Question: "${question}"
Answer: "${answer}"
Category: ${category}

Generate ONE follow-up question. One short sentence, under 15 words. Reference something specific they said and push for a concrete story, number, or example. No preamble.

Return only the question text, nothing else.`;

  return callAI({ model: MODEL_EXTRACT, prompt, temperature: 0.7, maxTokens: 150 });
}

// ── Synthesis helpers ─────────────────────────────────────────────────────────

interface ContentAngle {
  angle: string;
  hook: string;
  category: string;
  source: string;
}

function buildTranscriptFromQA(qa: QuestionAsked[]): string {
  return qa.map((q, i) => `Q${i + 1} [${q.category}]: ${q.question}\nA: ${q.answer}`).join('\n\n');
}

async function extractAngles(transcript: string, isPartial: boolean): Promise<ContentAngle[]> {
  const count = isPartial ? '3-4' : '5-7';
  const prompt = `You are a content strategist. Below is ${isPartial ? 'a partial' : 'a complete'} interview transcript with a content creator.

${transcript}

Extract ${count} distinct content angles — each one a post idea that could be written immediately from this interview.

For each angle:
- "angle": one-line description (e.g. "The moment they almost quit and why they stayed")
- "hook": a draft opening line for the post — punchy, first-person, specific to what they said
- "category": hot_take | story | lesson | prediction | how_to | values
- "source": the key quote or moment this draws from (10-20 words)

${SHORT_TEXT_BANS}

Return ONLY a JSON array:
[{ "angle": "...", "hook": "...", "category": "...", "source": "..." }]`;

  let raw: string;
  try {
    raw = await callAI({ model: MODEL_CREATIVE, prompt, temperature: 0.7, maxTokens: 1500 });
  } catch (primaryErr) {
    console.warn('[extractAngles] Primary model failed, trying fallback:', primaryErr instanceof Error ? primaryErr.message : primaryErr);
    try {
      raw = await callAI({ model: MODEL_EXTRACT, prompt, temperature: 0.7, maxTokens: 1500 });
    } catch (fallbackErr) {
      console.error('[extractAngles] Both models failed:', fallbackErr instanceof Error ? fallbackErr.message : fallbackErr);
      return [];
    }
  }
  const angles = parseJSON<ContentAngle[]>(raw) ?? [];
  if (angles.length === 0) {
    console.warn('[extractAngles] AI returned no parseable angles. Raw:', raw?.slice(0, 200));
  }
  // Fix rule violations in all hooks in parallel
  const fixedAngles = await Promise.all(
    angles.map(async (a) => ({ ...a, hook: await applyRulesFix(a.hook) }))
  );
  return fixedAngles;
}

async function suggestPillarsFromTranscript(transcript: string): Promise<string[]> {
  const CATEGORY_OPTIONS = 'build-in-public, educational, storytelling, case-study, contrarian-take, hot-take, authority, thought-leadership, thesis-building';
  const prompt = `You are a content strategist. Based on this interview transcript, suggest exactly 3 content categories that best match what this person naturally shared — their strengths, stories, and what would resonate with their audience.

${transcript.slice(0, 3000)}

Choose 3 from: ${CATEGORY_OPTIONS}

Return ONLY a JSON array of 3 strings, using the exact hyphenated names above: ["category1", "category2", "category3"]`;

  const VALID = new Set(['build-in-public','educational','storytelling','case-study','contrarian-take','hot-take','authority','thought-leadership','thesis-building']);
  const raw = await callAI({ model: MODEL_EXTRACT, prompt, temperature: 0.3, maxTokens: 80 });
  const result = parseJSON<string[]>(raw);
  return Array.isArray(result) ? result.filter(c => VALID.has(c)).slice(0, 3) : [];
}

// ── Partial synthesis (on pause) ─────────────────────────────────────────────

export async function partialSynthesis(sessionId: string): Promise<void> {
  const [session] = await db
    .select({ userId: interviewSessions.userId, brandId: interviewSessions.brandId, questionsAsked: interviewSessions.questionsAsked })
    .from(interviewSessions)
    .where(eq(interviewSessions.id, sessionId));

  if (!session?.brandId) {
    console.error(`[partialSynthesis] No brandId for session ${sessionId}`);
    return;
  }

  const qa = (session.questionsAsked as QuestionAsked[]) ?? [];
  if (qa.length < MIN_ANSWERS_FOR_SYNTHESIS) return;

  const transcript = buildTranscriptFromQA(qa);
  const angles = await extractAngles(transcript, true);
  if (angles.length === 0) {
    console.error(`[partialSynthesis] extractAngles returned empty for session ${sessionId}`);
    return;
  }

  const tag = SESSION_TAG(sessionId);
  await db.insert(drafts).values(
    angles.map(a => ({
      brandId: session.brandId!,
      userId: session.userId,
      content: `${a.hook}\n\n[Expand from interview: ${a.angle}]\n\nSource: "${a.source}"`,
      status: 'idea' as const,
      contentCategory: ANGLE_TO_CONTENT_CATEGORY[a.category] ?? null,
      notes: `${tag} Partial — from interview in progress. Category: ${a.category}`,
    }))
  );
}

// ── Full synthesis (on completion) ───────────────────────────────────────────

// Rough hook similarity check: compares first lines using word overlap (Jaccard-style).
// Returns true when two hooks likely represent the same idea.
function hooksAreSimilar(hookA: string, hookB: string): boolean {
  const words = (s: string) => new Set(
    s.split(/\W+/).map(w => w.toLowerCase()).filter(w => w.length > 3)
  );
  const a = words(hookA.split('\n')[0] ?? hookA);
  const b = words(hookB.split('\n')[0] ?? hookB);
  if (a.size === 0 || b.size === 0) return false;
  let intersection = 0;
  for (const w of a) { if (b.has(w)) intersection++; }
  const union = a.size + b.size - intersection;
  return intersection / union >= 0.4;
}

export async function synthesizeInterview(sessionId: string): Promise<void> {
  // Mark synthesis as in-progress so the UI can surface it
  await db.update(interviewSessions)
    .set({ synthesisStatus: 'pending' })
    .where(eq(interviewSessions.id, sessionId));

  try {
    const [session] = await db
      .select({ userId: interviewSessions.userId, brandId: interviewSessions.brandId, questionsAsked: interviewSessions.questionsAsked })
      .from(interviewSessions)
      .where(eq(interviewSessions.id, sessionId));

    if (!session?.brandId) {
      console.error(`[synthesizeInterview] No brandId for session ${sessionId}`);
      await db.update(interviewSessions).set({ synthesisStatus: 'failed' }).where(eq(interviewSessions.id, sessionId));
      return;
    }

    const qa = (session.questionsAsked as QuestionAsked[]) ?? [];
    if (qa.length === 0) {
      console.error(`[synthesizeInterview] No answers found for session ${sessionId}`);
      await db.update(interviewSessions).set({ synthesisStatus: 'failed' }).where(eq(interviewSessions.id, sessionId));
      return;
    }

    const transcript = buildTranscriptFromQA(qa);
    const angles = await extractAngles(transcript, false);
    if (angles.length === 0) {
      console.error(`[synthesizeInterview] extractAngles returned empty for session ${sessionId}`);
      await db.update(interviewSessions).set({ synthesisStatus: 'failed' }).where(eq(interviewSessions.id, sessionId));
      return;
    }

    const tag = SESSION_TAG(sessionId);
    const now = new Date();

    const [existingTagged, [brand]] = await Promise.all([
      db.select({ id: drafts.id, content: drafts.content, notes: drafts.notes })
        .from(drafts)
        .where(and(eq(drafts.brandId, session.brandId), like(drafts.notes, `%${tag}%`))),
      db.select({ briefMd: brands.briefMd, selectedCategories: brands.selectedCategories })
        .from(brands)
        .where(eq(brands.id, session.brandId)),
    ]);

    // Split into partial drafts (created during pause) vs any full ones
    const partialDrafts = existingTagged.filter(d => d.notes?.includes('Partial'));
    const nonPartialDrafts = existingTagged.filter(d => !d.notes?.includes('Partial'));

    // Merge: only insert new angles whose hook doesn't duplicate an existing partial
    const anglesForInsert = angles.filter(newAngle =>
      !partialDrafts.some(existing =>
        hooksAreSimilar(newAngle.hook, existing.content)
      )
    );

    const anglesSummary = angles.map(a => `- **${a.angle}**: ${a.source}`).join('\n');
    const appendix = `\n\n## Interview Insights (${now.toLocaleDateString()})\n${anglesSummary}`;

    // If this brand has no content pillars set yet, auto-suggest from this transcript
    const hasPillars = (brand?.selectedCategories?.length ?? 0) > 0;
    const suggestedPillars = hasPillars ? [] : await suggestPillarsFromTranscript(transcript).catch(() => []);

    const brandUpdate: { briefMd: string; updatedAt: Date; selectedCategories?: string[] } = {
      briefMd: (brand?.briefMd ?? '') + appendix,
      updatedAt: now,
    };
    if (suggestedPillars.length > 0) {
      brandUpdate.selectedCategories = suggestedPillars;
    }

    await Promise.all([
      // Delete non-partial tagged drafts (stale full-synthesis leftovers from a prior run)
      nonPartialDrafts.length > 0
        ? db.delete(drafts).where(inArray(drafts.id, nonPartialDrafts.map(d => d.id)))
        : Promise.resolve(),
      // Upgrade partials: strip "Partial" from their notes so they read as final
      partialDrafts.length > 0
        ? Promise.all(partialDrafts.map(d =>
            db.update(drafts)
              .set({ notes: (d.notes ?? '').replace(' Partial —', '').replace('Partial', '').trim() })
              .where(eq(drafts.id, d.id))
          ))
        : Promise.resolve(),
      // Insert only truly new angles
      anglesForInsert.length > 0
        ? db.insert(drafts).values(
            anglesForInsert.map(a => ({
              brandId: session.brandId!,
              userId: session.userId,
              content: `${a.hook}\n\n[Expand from interview: ${a.angle}]\n\nSource: "${a.source}"`,
              status: 'idea' as const,
              contentCategory: ANGLE_TO_CONTENT_CATEGORY[a.category] ?? null,
              notes: `${tag} Full interview. Category: ${a.category}`,
            }))
          )
        : Promise.resolve(),
      db.update(brands)
        .set(brandUpdate)
        .where(eq(brands.id, session.brandId)),
      db.update(interviewSessions)
        .set({ status: 'completed', completedAt: now, transcriptMarkdown: transcript, synthesisStatus: 'completed' })
        .where(eq(interviewSessions.id, sessionId)),
    ]);

    // Fire-and-forget: re-synthesize voice document with new interview material
    const appUrl = process.env.NEXT_PUBLIC_APP_URL ?? process.env.NEXTAUTH_URL ?? '';
    if (appUrl) {
      fetch(`${appUrl}/api/cron/consolidate-skills`, {
        method: 'POST',
        headers: { 'x-cron-secret': process.env.CRON_SECRET ?? '', 'Content-Type': 'application/json' },
        // Scope re-synthesis to this interview's brand. An empty body re-ran EVERY brand.
        body: JSON.stringify({ brandId: session.brandId }),
      }).catch(() => {});
    }
  } catch (err) {
    console.error(`[synthesizeInterview] Unexpected error for session ${sessionId}:`, err instanceof Error ? err.message : err);
    await db.update(interviewSessions).set({ synthesisStatus: 'failed' }).where(eq(interviewSessions.id, sessionId));
  }
}

export function buildTranscriptMarkdown(qa: QuestionAsked[]): string {
  return qa.map((q, i) => `**Q${i + 1}**: ${q.question}\n\n${q.answer}`).join('\n\n---\n\n');
}

export interface ContentIdea {
  id: string;
  angle: string;
  hook: string;
  category: string;
  source: string;
}

export async function generateIdeasFromLatestInterview(brandId: string): Promise<ContentIdea[] | null> {
  const [session] = await db
    .select({
      questionsAsked: interviewSessions.questionsAsked,
      transcriptMarkdown: interviewSessions.transcriptMarkdown,
    })
    .from(interviewSessions)
    .where(and(eq(interviewSessions.brandId, brandId), eq(interviewSessions.status, 'completed')))
    .orderBy(desc(interviewSessions.completedAt))
    .limit(1);

  if (!session) return null;

  const qa = (session.questionsAsked as QuestionAsked[]) ?? [];
  const transcript = session.transcriptMarkdown ?? buildTranscriptFromQA(qa);
  if (!transcript.trim()) return null;

  const angles = await extractAngles(transcript, false);
  return angles.map((a, i) => ({ id: String(i + 1), ...a }));
}
