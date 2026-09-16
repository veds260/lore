import { and, desc, eq, inArray } from 'drizzle-orm';
import { db } from './db';
import { drafts } from './db/schema';
import { callAI, parseJSON, MODEL_EXTRACT } from './ai';

export type Intent =
  | { kind: 'save_idea' }
  | { kind: 'generate_from_recent'; referenceHint?: string }
  | { kind: 'generate_new'; topic: string }
  | { kind: 'list_ideas' }
  | { kind: 'list_drafts' }
  | { kind: 'pick_from_list'; index: number } // index is 1-based
  | { kind: 'help' }
  | { kind: 'chitchat' };

interface IdeaLite {
  id: string;
  content: string;
  createdAt: Date;
}

// Pull recent ideas + drafts so the classifier has context for "draft my idea about X"
export async function loadRecentContext(userId: string, brandId: string): Promise<{
  ideas: IdeaLite[];
  draftsCount: number;
}> {
  const recentIdeas = await db
    .select({ id: drafts.id, content: drafts.content, createdAt: drafts.createdAt })
    .from(drafts)
    .where(and(
      eq(drafts.userId, userId),
      eq(drafts.brandId, brandId),
      inArray(drafts.status, ['idea'] as const),
    ))
    .orderBy(desc(drafts.createdAt))
    .limit(5);

  const draftCountRow = await db
    .select({ id: drafts.id })
    .from(drafts)
    .where(and(
      eq(drafts.userId, userId),
      eq(drafts.brandId, brandId),
      inArray(drafts.status, ['draft', 'review'] as const),
    ));

  return { ideas: recentIdeas, draftsCount: draftCountRow.length };
}

// Classify what the user is asking for. Falls back to save_idea on failure so we
// never lose a captured thought.
export async function classifyIntent(text: string, ctx: { ideas: IdeaLite[] }): Promise<Intent> {
  const clean = text.trim();
  if (!clean) return { kind: 'chitchat' };

  // Long messages are almost certainly content to capture, not commands.
  // Skip the classifier call, fast path + saves a token.
  if (clean.length > 500) return { kind: 'save_idea' };

  const recentIdeasSummary = ctx.ideas.length === 0
    ? '(none)'
    : ctx.ideas.map((idea, i) => `${i + 1}. "${idea.content.slice(0, 120).replace(/\n+/g, ' ')}"`).join('\n');

  const prompt = `You are a router for a content-writing app's Telegram bot. The user sends a message — decide what they want.

The user has these RECENT IDEAS saved (most recent first):
${recentIdeasSummary}

Classify the message into exactly one intent and return JSON:

INTENTS:
- "save_idea" — they're capturing a thought, observation, or idea for later. The DEFAULT for any substantive content.
- "generate_from_recent" — they're asking to turn a previously-saved idea into a full post. Words like "draft it", "generate that", "make the post", "write the one about X", "give me the post". If they name a topic that matches one of the recent ideas above, include "referenceHint" with that topic phrase.
- "generate_new" — they're asking to write a brand-new post about a topic stated inline AS A COMMAND (e.g., "write me a post about pricing strategy", "draft a post on remote work"). Must be clearly imperative AND short (under ~40 words). Long messages explaining a thought = save_idea, not this.
- "list_ideas" — they want to see their saved ideas ("what ideas do I have", "show my ideas", "what's in my idea pool", "list my ideas")
- "list_drafts" — they want to see their drafts ("show my drafts", "what's ready", "what posts are queued")
- "pick_from_list" — they're picking a numbered item from a recently shown list ("show me the 2nd one", "the second one", "show me 3", "open the first", "give me #2"). Include "index" as a 1-based number. This intent ALSO fires for picks that mean "draft this one" — the executor figures out whether to draft or show based on which list was last sent.
- "help" — they're asking how the bot works ("what can you do", "how do I use this", "help")
- "chitchat" — pure greeting or off-topic ("hi", "thanks", "ok"). Use sparingly.

RULES:
- When in doubt between save_idea and generate_new, prefer save_idea. Generating spends real credits.
- If the message includes both a thought AND a request to generate ("here's an idea, draft it") → save_idea (we save first, they can say "draft it" after).
- "draft it" / "generate it" / "give me the post" with no inline topic → generate_from_recent.
- referenceHint should only appear for generate_from_recent.
- Ordinal words (first, second, third, fourth, fifth) and "#N" both map to pick_from_list with index.

USER MESSAGE:
"""${clean}"""

Return ONLY JSON like one of:
{"kind":"save_idea"}
{"kind":"generate_from_recent"}
{"kind":"generate_from_recent","referenceHint":"authenticity in content"}
{"kind":"generate_new","topic":"why remote work is broken"}
{"kind":"list_ideas"}
{"kind":"list_drafts"}
{"kind":"pick_from_list","index":2}
{"kind":"help"}
{"kind":"chitchat"}`;

  try {
    const out = await callAI({
      model: MODEL_EXTRACT,
      prompt,
      temperature: 0,
      maxTokens: 200,
    });
    const parsed = parseJSON<Intent>(out);
    if (!parsed || typeof (parsed as { kind?: unknown }).kind !== 'string') {
      return { kind: 'save_idea' };
    }
    // Validate kind is one of ours
    const ok: Intent['kind'][] = ['save_idea', 'generate_from_recent', 'generate_new', 'list_ideas', 'list_drafts', 'pick_from_list', 'help', 'chitchat'];
    if (!ok.includes((parsed as Intent).kind)) return { kind: 'save_idea' };
    // Validate pick_from_list index is a sane number
    if ((parsed as Intent).kind === 'pick_from_list') {
      const idx = (parsed as { index?: unknown }).index;
      if (typeof idx !== 'number' || !Number.isFinite(idx) || idx < 1 || idx > 10) {
        return { kind: 'save_idea' };
      }
    }
    return parsed as Intent;
  } catch (err) {
    console.error('[telegram-intent] classify failed, defaulting to save_idea:', err);
    return { kind: 'save_idea' };
  }
}

// Pick the best idea match given a hint. Substring match against the hint words,
// falls back to most recent if nothing matches.
export function pickIdeaByHint(ideas: IdeaLite[], hint: string | undefined): IdeaLite | null {
  if (ideas.length === 0) return null;
  if (!hint) return ideas[0];

  const hintWords = hint.toLowerCase().split(/\s+/).filter(w => w.length > 3);
  if (hintWords.length === 0) return ideas[0];

  let best: IdeaLite | null = null;
  let bestScore = 0;
  for (const idea of ideas) {
    const haystack = idea.content.toLowerCase();
    const score = hintWords.filter(w => haystack.includes(w)).length;
    if (score > bestScore) {
      best = idea;
      bestScore = score;
    }
  }
  // Require at least one matching word, otherwise fall back to most recent
  return best ?? ideas[0];
}
