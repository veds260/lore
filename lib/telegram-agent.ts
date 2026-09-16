// Telegram bot agent loop. The user's free-text messages go through this single
// entry point. Haiku decides which tool to call; tools call existing Lore helpers
// (quickGenerate uses Sonnet under the hood, so writing quality matches the
// dashboard, only routing is on the cheap model).

import { and, desc, eq, inArray } from 'drizzle-orm';
import { db } from './db';
import { users, drafts } from './db/schema';
import { callAI, parseJSON, MODEL_AGENT } from './ai';
import { recordCost } from './credits';

const MAX_HISTORY = 20;
const MAX_HISTORY_FOR_AGENT = 12; // recent context shown to the agent
const RECENT_IDEAS = 5;
const RECENT_DRAFTS = 5;

// ── Tool surface area the agent can pick from ──────────────────────────────
// Names are short + verb-shaped. Keep this in sync with the system prompt below.
export type AgentAction =
  | { tool: 'save_idea'; content: string }
  | { tool: 'generate_post'; topic: string; fromIdeaId?: string; platform?: 'twitter' | 'linkedin' | 'both' }
  | { tool: 'show_draft'; draftId: string }
  | { tool: 'show_idea'; ideaId: string }
  | { tool: 'list_ideas' }
  | { tool: 'list_drafts' }
  | { tool: 'help' }
  | { tool: 'reply'; text: string };

interface HistoryEntry {
  role: 'user' | 'assistant';
  content: string;
  ts: string;
}

interface AgentContext {
  recentIdeas: Array<{ id: string; content: string; createdAt: Date }>;
  recentDrafts: Array<{ id: string; content: string; linkedinContent?: string; createdAt: Date; status: string }>;
  history: HistoryEntry[];
}

// Load the rolling chat history + recent ideas/drafts for this brand.
export async function loadAgentContext(userId: string, brandId: string): Promise<AgentContext> {
  const [user] = await db
    .select({ history: users.telegramHistory })
    .from(users)
    .where(eq(users.id, userId))
    .limit(1);
  const history = (user?.history ?? []).slice(-MAX_HISTORY_FOR_AGENT);

  const recentIdeas = await db
    .select({ id: drafts.id, content: drafts.content, createdAt: drafts.createdAt })
    .from(drafts)
    .where(and(eq(drafts.userId, userId), eq(drafts.brandId, brandId), eq(drafts.status, 'idea' as const)))
    .orderBy(desc(drafts.createdAt))
    .limit(RECENT_IDEAS);

  const recentDraftRows = await db
    .select({ id: drafts.id, content: drafts.content, notes: drafts.notes, createdAt: drafts.createdAt, status: drafts.status })
    .from(drafts)
    .where(and(eq(drafts.userId, userId), eq(drafts.brandId, brandId), inArray(drafts.status, ['draft', 'review'] as const)))
    .orderBy(desc(drafts.createdAt))
    .limit(RECENT_DRAFTS);

  const recentDrafts = recentDraftRows.map(d => {
    let linkedin: string | undefined;
    try {
      const n = d.notes ? JSON.parse(d.notes) : null;
      if (n && typeof n.linkedinContent === 'string') linkedin = n.linkedinContent;
    } catch {}
    return { id: d.id, content: d.content, linkedinContent: linkedin, createdAt: d.createdAt, status: d.status };
  });

  return { history, recentIdeas, recentDrafts };
}

// Append a message to the rolling history. Trims to MAX_HISTORY.
export async function appendHistory(userId: string, role: 'user' | 'assistant', content: string): Promise<void> {
  const [row] = await db
    .select({ history: users.telegramHistory })
    .from(users)
    .where(eq(users.id, userId))
    .limit(1);
  const prev = row?.history ?? [];
  const next: HistoryEntry[] = [...prev, { role, content: content.slice(0, 2000), ts: new Date().toISOString() }].slice(-MAX_HISTORY);
  await db.update(users).set({ telegramHistory: next, updatedAt: new Date() }).where(eq(users.id, userId));
}

// Build the agent prompt. Returns a single string: we use plain JSON tool-calling,
// not OpenRouter's native function calling, so the prompt has to be explicit.
function buildAgentPrompt(userMessage: string, ctx: AgentContext, brandName: string): string {
  const ideasBlock = ctx.recentIdeas.length === 0
    ? '(none saved yet)'
    : ctx.recentIdeas.map((i, idx) => `${idx + 1}. id=${i.id}\n   "${i.content.slice(0, 200).replace(/\n+/g, ' ')}"`).join('\n');

  const draftsBlock = ctx.recentDrafts.length === 0
    ? '(none yet)'
    : ctx.recentDrafts.map((d, idx) => `${idx + 1}. id=${d.id} status=${d.status}\n   X: "${d.content.slice(0, 180).replace(/\n+/g, ' ')}"`).join('\n');

  const historyBlock = ctx.history.length === 0
    ? '(this is the first message)'
    : ctx.history.map(h => `${h.role === 'user' ? 'USER' : 'BOT'}: ${h.content.slice(0, 350).replace(/\n+/g, ' ')}`).join('\n');

  return `You are the AI agent behind a Telegram bot for Lore, a writing tool. You help ${brandName} capture ideas and turn them into posts.

The user just sent a message. Decide what to do. Pick exactly ONE tool to call. Read the conversation history carefully — phrases like "the 2nd one", "show me that", "draft it" refer to things mentioned in earlier turns.

## TOOLS

1. save_idea — capture a thought, observation, voice memo transcript, or any substantive content for later.
   Args: { "tool": "save_idea", "content": "<the thought, verbatim>" }
   Use when the user is sharing an idea, not commanding an action.

2. generate_post — generate a post. Uses real AI credits (10 cr per call). Charges + saves a draft + renders the result.
   Args: { "tool": "generate_post", "topic": "<what the post is about>", "fromIdeaId": "<optional idea id if drafting from a saved idea>", "platform": "twitter" | "linkedin" | "both" }
   Use when the user says: "draft it", "generate the post", "write me one about X", "make a post about that idea". If a saved idea matches, set fromIdeaId.
   Platform default is "both" — generates X + LinkedIn together. Set "twitter" if user said "draft a tweet / X post / Twitter post / for X". Set "linkedin" if user said "draft a LinkedIn post / LI post / write something for LinkedIn".

3. show_draft — read back the full text of a saved draft (no AI call, free).
   Args: { "tool": "show_draft", "draftId": "<id from RECENT DRAFTS below>" }
   Use when user says: "show me draft 2", "the 2nd one" (after a draft list), "open that draft".

4. show_idea — read back the full text of a saved idea.
   Args: { "tool": "show_idea", "ideaId": "<id from RECENT IDEAS below>" }

5. list_ideas — show the recent saved ideas as a numbered list. Use when user asks "what ideas do I have", "show my ideas".

6. list_drafts — show the recent drafts. Use when user asks "show my drafts", "what's ready".

7. help — show the bot's menu / capabilities. Use when user asks "what can you do", "help".

8. reply — just send a chat message. No DB action.
   Args: { "tool": "reply", "text": "<message to send>" }
   Use for: greetings, clarifying questions back, "I don't understand" responses, casual back-and-forth.

## RULES

- Default to save_idea for any substantive content. Only generate_post when the user explicitly commands a draft.
- "Draft it" / "generate it" / "write the post" — they're talking about the MOST RECENT idea unless they reference a specific one.
- "Show me the 2nd one" / "show me #3" — look at the LAST BOT MESSAGE in history. If it showed a list of drafts, use show_draft with the matching id. If it was a list of ideas, use show_idea.
- Never invent ids — only use ids that appear in RECENT IDEAS or RECENT DRAFTS below.
- If the user is being conversational ("thanks", "hi", "ok"), use reply with a short friendly response.
- Return ONLY a JSON object. No markdown, no explanation, no prose. Just the JSON.

Examples for generate_post platform inference:
- "draft a linkedin post about pricing" → platform: "linkedin"
- "make me a tweet about that idea" → platform: "twitter"
- "draft it" → platform: "both" (no explicit signal)
- "write the LinkedIn version" → platform: "linkedin"
- "generate something for X" → platform: "twitter"

## CONVERSATION HISTORY (most recent last)
${historyBlock}

## RECENT IDEAS (most recent first)
${ideasBlock}

## RECENT DRAFTS (most recent first)
${draftsBlock}

## USER'S NEW MESSAGE
"""${userMessage}"""

## YOUR JSON RESPONSE`;
}

// Run one agent turn. Returns the action to execute.
export async function runAgent(userId: string, userMessage: string, ctx: AgentContext, brandName: string): Promise<AgentAction> {
  const prompt = buildAgentPrompt(userMessage, ctx, brandName);

  try {
    const out = await callAI({ model: MODEL_AGENT, prompt, temperature: 0.1, maxTokens: 600 });
    // Telemetry: one Haiku call per free-text Telegram message
    recordCost(userId, 'agent_route').catch(() => {});
    const parsed = parseJSON<AgentAction>(out);
    if (!parsed || typeof (parsed as { tool?: unknown }).tool !== 'string') {
      return { tool: 'save_idea', content: userMessage };
    }
    return validateAction(parsed, ctx, userMessage);
  } catch (err) {
    console.error('[telegram-agent] runAgent failed, defaulting to save_idea:', err);
    return { tool: 'save_idea', content: userMessage };
  }
}

// Guard against hallucinated ids and missing required args.
function validateAction(action: AgentAction, ctx: AgentContext, userMessage: string): AgentAction {
  switch (action.tool) {
    case 'save_idea':
      if (!action.content || typeof action.content !== 'string') {
        return { tool: 'save_idea', content: userMessage };
      }
      return action;

    case 'generate_post': {
      if (!action.topic || typeof action.topic !== 'string') {
        return { tool: 'reply', text: "I'd need a topic to draft from. What should the post be about?" };
      }
      // Validate platform, fall back to 'both' on bad values
      const validPlatform: 'twitter' | 'linkedin' | 'both' =
        action.platform === 'twitter' || action.platform === 'linkedin' ? action.platform : 'both';
      if (action.fromIdeaId && !ctx.recentIdeas.some(i => i.id === action.fromIdeaId)) {
        return { tool: 'generate_post', topic: action.topic, platform: validPlatform };
      }
      return { ...action, platform: validPlatform };
    }

    case 'show_draft':
      if (!action.draftId || !ctx.recentDrafts.some(d => d.id === action.draftId)) {
        return { tool: 'reply', text: "I'm not sure which draft you mean. Tap /drafts and reply with a number." };
      }
      return action;

    case 'show_idea':
      if (!action.ideaId || !ctx.recentIdeas.some(i => i.id === action.ideaId)) {
        return { tool: 'reply', text: "I'm not sure which idea you mean. Tap /ideas and reply with a number." };
      }
      return action;

    case 'list_ideas':
    case 'list_drafts':
    case 'help':
      return action;

    case 'reply':
      if (!action.text || typeof action.text !== 'string') {
        return { tool: 'reply', text: "Got it." };
      }
      return action;

    default:
      return { tool: 'save_idea', content: userMessage };
  }
}
