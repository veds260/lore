// Shared post-generation prompt + viral-template engine. Extracted from app/api/generate so the
// connector generates with the EXACT same engine as the native Lore board: one source of
// truth for the prompt, the template/mirror-spec system, and template auto-pick/rotation.
import { db } from '@/lib/db';
import { brands, postPatterns, templateUsage } from '@/lib/db/schema';
import { eq, and, gte, notInArray } from 'drizzle-orm';
import type { PostLength } from '@/components/board/types';
import { GLOBAL_RULES_PROMPT, STRUCTURAL_RULES } from '@/lib/global-rules';
import { buildCraftRules } from '@/lib/craft-rules';
import { isAutoRotationEligible } from './pattern-categories';

export const LENGTH_GUIDE: Record<PostLength, { twitter: string; linkedin: string }> = {
  short:  { twitter: 'One punchy idea. Keep it tight.',         linkedin: 'Short and impactful. Say one thing well.' },
  medium: { twitter: 'One developed idea with room to breathe.', linkedin: 'Story + insight. Give it proper context.' },
  long:   { twitter: 'Numbered thread of 4-6 tweets, format as 1/ 2/ etc.', linkedin: 'Full narrative arc. Long-form storytelling.' },
  auto:   { twitter: 'Let the idea dictate the length. Say what needs to be said, nothing more.', linkedin: 'Let the idea dictate the length. Story-driven.' },
};

export interface FullPattern {
  id: string;
  name: string;
  template: string;
  example: string | null;
  hookType: string | null;
  formatType: string | null;
  bodyStructure: string | null;
  closerType: string | null;
  engagementTarget: string | null;
  coreInsight: string | null;
  viralMechanic: string | null;
  emotionTrigger: string | null;
  postType: string | null;
}

const CONTENT_STYLE_DIRECTIVE: Record<string, string> = {
  'witty-short':  '## Post style preference\nThis creator prefers short, witty, punchy posts. Lean on a sharp hook and memorable closer. Trust the reader to get it fast. If an idea can be said in 3 lines, don\'t stretch it to 5. Avoid lengthy breakdowns.',
  'deep-value':   '## Post style preference\nThis creator prefers posts with substance and depth. Each post should contain a real insight, mechanism, or data point — not just a surface-level observation. Add enough depth that people save and re-read it.',
  'mixed':        '## Post style preference\nVary the style. Some posts should be tight and witty, others more substantive. Let the topic and angle determine which fits — avoid defaulting to only one register.',
};

function deriveMirrorSpec(template: string): string {
  const rawLines = template.split('\n');
  const lines = rawLines.map(l => l.trimEnd());
  const specs: string[] = [];
  let lineNum = 0;
  for (const line of lines) {
    if (line.trim() === '') {
      specs.push(`[blank line]`);
    } else {
      lineNum++;
      const words = line.trim().split(/\s+/).length;
      const isBullet = /^[-*•]/.test(line.trim()) || /^\d+[.)]\s/.test(line.trim());
      const length = words <= 8 ? 'short punch' : words <= 18 ? 'medium' : 'long sentence';
      specs.push(`Line ${lineNum}: ${isBullet ? 'bullet/list item' : length} (~${words} words)`);
    }
  }
  const nonEmpty = lines.filter(l => l.trim() !== '');
  const sections = template.split(/\n\n+/).filter(s => s.trim()).length;
  return `**Mirror spec — match this exactly:**
- ${nonEmpty.length} non-empty lines, ${sections} section${sections !== 1 ? 's' : ''} separated by blank lines
${specs.map(s => `- ${s}`).join('\n')}`;
}

function buildTemplateInstructions(pattern: FullPattern): string {
  const formatLabel = [pattern.formatType, pattern.bodyStructure].filter(Boolean).join(' / ');
  const postTypeLabel = pattern.postType === 'long-post' ? 'long-form post' : pattern.postType ?? 'tweet';
  const mirrorSpec = deriveMirrorSpec(pattern.template);

  return `
## VIRAL TEMPLATE: ${pattern.name}
This is a hard rule. Follow this template to the letter — not just the skeleton but the exact phrasing style, sentence count, sentence length, line breaks, and whether lines are punchy one-liners or flowing sentences.

**Hook type:** ${pattern.hookType ?? 'standard'}
**Format:** ${formatLabel || 'standard'}
**Post type:** ${postTypeLabel}
**Target:** drives ${pattern.engagementTarget ?? 'engagement'}
**Emotion:** ${pattern.emotionTrigger ?? 'curiosity'}
**Viral mechanic:** ${pattern.viralMechanic ?? 'info-asymmetry'}

### Template (fill [brackets] with your content — touch nothing else)
\`\`\`
${pattern.template}
\`\`\`

${mirrorSpec}

${pattern.example ? `### Reference post (same pattern, different topic)
Your output must read like this at the structural level — same rhythm, same sentence lengths, same line density, same closer energy. Different words, same form.

${pattern.example}` : ''}

${pattern.coreInsight ? `### Why this works\n${pattern.coreInsight}` : ''}

### HARD RULES — no exceptions
1. Count the non-empty lines in the template. Your output must have the exact same count.
2. Short lines in the template stay short (under 10 words). Long lines stay long. Do not pad or compress.
3. If the template uses single-line punches, do not merge them into a paragraph.
4. If the template uses prose paragraphs, do not fragment them into bullets.
5. Blank lines between sections are mandatory — place them exactly where the template has them.
6. The closer mirrors the template closer in length and register (punchline stays punchy, open-loop stays open).
7. Do NOT add sentences the template doesn't have. Do NOT drop sentences it does.
8. Fill [brackets] only. The surrounding words, connectives, and phrasing patterns are part of the structure — keep them.
9. Match the phrasing register and sentence construction of each line. If the template opens with a declarative statement, open with a declarative statement — not a question. If it uses "Here's what X means:", carry that framing. If it builds with "First... Then... Finally...", keep that cadence. If sentences are clipped and direct, keep them clipped and direct. If they're flowing and subordinate-clause-heavy, match that. The goal is: someone reading your output and the template side-by-side should see the same phrasing DNA.
${pattern.closerType ? `10. Closer type: ${pattern.closerType}` : ''}`;
}

// If the AI produces a single-paragraph Twitter post with no blank lines, split it into
// hook + body + closer at sentence boundaries.
export function enforceTwitterBreaks(text: string): string {
  if (!text || text.includes('\n\n')) return text;
  if ((text.match(/\n/g) ?? []).length >= 2) return text.replace(/\n/g, '\n\n');
  const sentences = text.match(/[^.!?]+[.!?]+(?:\s|$)/g);
  if (!sentences || sentences.length < 2) return text;
  const trimmed = sentences.map(s => s.trim()).filter(Boolean);
  if (trimmed.length === 2) return trimmed.join('\n\n');
  const hook = trimmed[0];
  const closer = trimmed[trimmed.length - 1];
  const body = trimmed.slice(1, -1).join(' ');
  return [hook, body, closer].filter(Boolean).join('\n\n');
}

// Em/en dashes are banned and the LLM keeps reintroducing them, so strip
// them deterministically: numeric ranges → hyphen, everything else → comma. Applied at every exit.
export function stripEmDashes(text: string): string {
  return text
    .replace(/(\d)\s*[—–]\s*(\d)/g, '$1-$2')
    .replace(/\s*[—–](?!\d)\s*/g, ', ');
}

export function buildPrompt(opts: {
  topic: string;
  context?: string;
  voiceGuide: string;
  brandName: string;
  guide: { twitter: string; linkedin: string };
  chat: boolean;
  directWrite?: boolean;
  pattern?: FullPattern;
  recentPostsContext?: string;
  history?: Array<{ role: 'user' | 'assistant'; content: string }>;
  contentStyle?: string | null;
  platform?: 'twitter' | 'linkedin' | 'both';
  isNewsReaction?: boolean;
  brandNiche?: string | null;
  extraDirectives?: string; // measured layout signature etc. (connector parity)
}) {
  const { topic, context, voiceGuide, brandName, guide, chat, directWrite, pattern, recentPostsContext, history, contentStyle, platform = 'both', isNewsReaction = false, brandNiche, extraDirectives } = opts;
  const styleDirective = CONTENT_STYLE_DIRECTIVE[contentStyle ?? 'mixed'] ?? CONTENT_STYLE_DIRECTIVE['mixed'];
  const craftRules = buildCraftRules({ brandNiche, isNewsReaction });

  const templateAppliesToTwitter = !pattern || pattern.postType === 'tweet' || pattern.postType === 'thread';
  const templateAppliesToLinkedin = !pattern || pattern.postType === 'long-post';
  const effectivePattern = pattern && (
    (platform === 'twitter' && templateAppliesToTwitter) ||
    (platform === 'linkedin' && templateAppliesToLinkedin) ||
    (platform === 'both' && (templateAppliesToTwitter || templateAppliesToLinkedin))
  ) ? pattern : undefined;

  const includeTwitter = platform === 'twitter' || platform === 'both';
  const includeLinkedin = platform === 'linkedin' || platform === 'both';

  const twitterSection = `### X / Twitter version
- Length: ${guide.twitter}
- Platform truth: Twitter rewards directness, speed, and a strong hook in line 1. The reader scrolls fast.
- For complex or niche topics: lead with a well-known person's action, a vivid scenario, a stark comparison, or a counter-intuitive claim. Draw them in THEN reveal the insight.
- No hashtags. No "Thread:". No generic opener. No "I" as the first word.

**HARD FORMAT RULE — non-negotiable:**
Your Twitter output MUST be broken into sections using \\n\\n (a blank line between each section). Structure:
  Line 1 (hook): one punchy standalone line — the scroll-stopper.
  [blank line]
  Middle (body): 1–3 lines developing the idea. Each new beat gets its own line, separated by \\n\\n.
  [blank line]
  Last line (closer): the punchline, conclusion, or open loop — one final standalone line.
A tweet with zero blank lines — one unbroken wall of text — is always wrong. Even a short 2-part tweet needs the hook separated from the rest.`;

  const linkedinSection = `### LinkedIn version
- Length: ${guide.linkedin}
- Platform truth: LinkedIn readers expect more context and respond strongly to personal stories and concrete lessons.
- For niche topics: frame the business or career angle first using a relatable professional scenario or client story.
- Structure: opening hook (1-2 lines that stop the scroll) then narrative or context then core insight then takeaway.
- No hashtag spam at the end. No "As a [title], I...". No generic advice listicles.`;

  const platformInstructions = effectivePattern
    ? (() => {
        const isLongPost = effectivePattern.postType === 'long-post';
        const templateBlock = buildTemplateInstructions(effectivePattern);
        if (isLongPost && includeLinkedin && includeTwitter) return `${twitterSection}\n\n${templateBlock}`;
        if (!isLongPost && includeTwitter && includeLinkedin) return `${templateBlock}\n\n${linkedinSection}`;
        return templateBlock;
      })()
    : `
${includeTwitter ? twitterSection : ''}

${includeLinkedin ? linkedinSection : ''}`.trim();

  const outputSchema = platform === 'twitter' ? `{"twitter":"..."}` : platform === 'linkedin' ? `{"linkedin":"..."}` : `{"twitter":"...","linkedin":"..."}`;
  const writeTask = platform === 'twitter'
    ? `Write ONE X (Twitter) post on this topic.`
    : platform === 'linkedin'
    ? `Write ONE LinkedIn post on this topic.`
    : `Write TWO versions of a post - one for X (Twitter) and one for LinkedIn. They must be DIFFERENT posts, not the same content reformatted. Each platform has a different audience expectation and comfort level.`;

  const historyBlock = history?.length
    ? `## Conversation so far\n${history.map(h => `**${h.role === 'user' ? 'User' : 'Assistant'}:** ${h.content}`).join('\n\n')}\n\n## Current message`
    : `## User input`;
  const hasGeneratedPostInHistory = history?.some(h => h.role === 'assistant' && h.content.startsWith('Generated posts:'));
  const extra = extraDirectives ? `\n${extraDirectives}\n` : '';

  if (chat && directWrite) {
    return `You are a creative ghostwriter generating platform-specific social media posts for ${brandName}.

${STRUCTURAL_RULES}

${GLOBAL_RULES_PROMPT}

${craftRules}

${voiceGuide ? `${voiceGuide}\n` : ''}${styleDirective}
${extra}
${recentPostsContext ? `\n${recentPostsContext}\n` : ''}
## User input
${topic}
${context ? `\n## Additional context\n${context}` : ''}

## Task
${writeTask}
${platformInstructions}

Output ONLY this JSON:
{"type": "posts", ${outputSchema.replace(/[{}]/g, '')}}`;
  }

  if (chat) {
    return `You are a creative ghostwriter generating platform-specific social media posts for ${brandName}.

${STRUCTURAL_RULES}

${GLOBAL_RULES_PROMPT}

${craftRules}

${voiceGuide ? `${voiceGuide}\n` : ''}${styleDirective}
${extra}
${recentPostsContext ? `\n${recentPostsContext}\n` : ''}
${historyBlock}
${topic}
${context ? `\n## Additional context\n${context}` : ''}

## Instructions - follow in order

STEP 0 - Classify the user's intent before anything else.

0A — Twitter/X lookup: user wants to see tweets, search X, check engagement on a tweet, or find what someone is posting.
Signs: mentions @handle + asks about their posts/tweets/content, asks to search/find tweets, contains x.com or twitter.com URL, asks "what are people tweeting about X", "what is @handle posting", "find tweets about X".
If it IS a Twitter lookup, output ONLY this JSON and stop:
{"type": "twitter_lookup", "intent": "profile" or "search" or "tweet_url", "handle": "@handle or null", "query": "search terms or null", "tweetUrl": "full tweet URL or null"}
intent values: "profile" = asking about a specific handle's posts, "search" = topic/keyword search, "tweet_url" = a tweet URL was given to analyze.

0B — News lookup: user wants to know what mainstream tech/AI news is worth posting about today, what's trending, what news could become a LinkedIn post.
Signs: "what news / what's worth posting / find news / mainstream news / what's happening today / news worth a post / any news worth doing it / what should I post about today / any LinkedIn-worthy news".
If it IS a news lookup, output ONLY this JSON and stop:
{"type": "news_lookup"}

0C — Other research / info question (non-Twitter, non-news): user wants information Lore can't provide — web search, Reddit, YouTube, general fact-finding.
If it IS a non-news research question: output ONLY this JSON and stop:
{"type": "info", "text": "A 1-2 sentence response: acknowledge what they're looking for, then explain Lore doesn't have live web access for general queries — guide them to paste content directly (a tweet, thread, Reddit post, YouTube link, or article URL) so you can turn it into posts."}

If the user is clearly asking for posts to be written (even vaguely): proceed to Step 1.

STEP 1 - Evaluate specificity.
${hasGeneratedPostInHistory ? `There are previously generated posts in the conversation history above. The current message is a follow-up or refinement — treat it as specific enough and proceed directly to Step 2. Do not ask a clarifying question.` : `Read the user input above. Ask yourself: can I write a genuinely good, specific social media post from this?

A request needs: a concrete named subject (what exactly happened, was built, or was learned), enough detail to be credible, and a specific angle worth writing about.

The request is TOO VAGUE if it:
- Mentions "a feature", "something I built", "an experience", or similar without saying what it actually is
- References "it", "this", or "the thing" without prior context
- Contains no specifics: no names, no numbers, no examples, no concrete outcomes

If too vague: output ONLY this JSON and stop:
{"type": "question", "text": "One focused question that gets the single most important missing detail"}

If specific enough: proceed to Step 2.`}

STEP 2 - ${writeTask}
${platformInstructions}

Output ONLY this JSON:
{"type": "posts", ${outputSchema.replace(/[{}]/g, '')}}`;
  }

  return `You are a creative ghostwriter generating platform-specific social media posts for ${brandName}.

${STRUCTURAL_RULES}

${GLOBAL_RULES_PROMPT}

${craftRules}

${voiceGuide ? `${voiceGuide}\n` : ''}${styleDirective}
${extra}
${recentPostsContext ? `\n${recentPostsContext}\n` : ''}
## Topic / input
${topic}
${context ? `\n## Additional context\n${context}` : ''}

## Task
${writeTask}
${platformInstructions}

Return ONLY a JSON object:
${outputSchema}`;
}

// Auto-pick a viral template (with 60-day rotation) the same way the native board does, then fetch
// the full pattern. Returns the chosen pattern (or undefined for raw/standard output).
export async function pickTemplate(opts: {
  brandId?: string | null;
  platform: 'twitter' | 'linkedin' | 'both';
  useTemplate?: boolean;
  templateId?: string;
}): Promise<FullPattern | undefined> {
  const { brandId, platform } = opts;
  let templateId = opts.templateId;

  const shouldAutoPick = !templateId && brandId && opts.useTemplate !== false && (
    opts.useTemplate === true || platform === 'linkedin' || platform === 'both'
  );

  if (shouldAutoPick && brandId) {
    const since = new Date(Date.now() - 60 * 24 * 60 * 60 * 1000);
    const recentlyUsed = await db
      .select({ templateId: templateUsage.templateId })
      .from(templateUsage)
      .where(and(eq(templateUsage.brandId, brandId), gte(templateUsage.createdAt, since)));
    const usedIds = recentlyUsed.map(r => r.templateId);

    const [brandFlags] = await db
      .select({ allowUnhingedMode: brands.allowUnhingedMode })
      .from(brands).where(eq(brands.id, brandId)).limit(1);

    const candidates = await db
      .select({ id: postPatterns.id, contentCategory: postPatterns.contentCategory, postType: postPatterns.postType })
      .from(postPatterns)
      .where(and(eq(postPatterns.isActive, true), usedIds.length > 0 ? notInArray(postPatterns.id, usedIds) : undefined))
      .limit(40);

    const eligible = candidates
      .filter(c => isAutoRotationEligible(c.contentCategory, brandFlags?.allowUnhingedMode))
      .filter(c => {
        if (platform === 'twitter') return c.postType === 'tweet' || c.postType === 'thread';
        if (platform === 'linkedin') return c.postType === 'long-post';
        const linkedinPool = candidates.filter(x => x.postType === 'long-post' && isAutoRotationEligible(x.contentCategory, brandFlags?.allowUnhingedMode));
        return linkedinPool.length > 0 ? c.postType === 'long-post' : true;
      });

    if (eligible.length > 0) templateId = eligible[Math.floor(Math.random() * eligible.length)].id;
  }

  if (!templateId) return undefined;
  const [row] = await db
    .select({
      id: postPatterns.id, name: postPatterns.name, template: postPatterns.template, example: postPatterns.example,
      hookType: postPatterns.hookType, formatType: postPatterns.formatType, bodyStructure: postPatterns.bodyStructure,
      closerType: postPatterns.closerType, engagementTarget: postPatterns.engagementTarget, coreInsight: postPatterns.coreInsight,
      viralMechanic: postPatterns.viralMechanic, emotionTrigger: postPatterns.emotionTrigger, postType: postPatterns.postType,
    })
    .from(postPatterns).where(eq(postPatterns.id, templateId)).limit(1);
  return row ?? undefined;
}

export async function recordTemplateUse(brandId: string | null | undefined, templateId: string | undefined) {
  if (!brandId || !templateId) return;
  await db.insert(templateUsage).values({ brandId, templateId }).catch(() => {});
}
