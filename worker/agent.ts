// Free text goes through Lore's real agent loop
// (lib/telegram-agent.ts) instead of being treated as a bare draft topic.
// Haiku routes the message to a typed tool with the chat's rolling history and
// the brand's recent ideas/drafts as context; validation in runAgent already
// guards against hallucinated ids. This file only executes the chosen action
// with the worker's own primitives, always against the chat's explicit binding.

import { eq } from 'drizzle-orm';
import { db } from '@/lib/db';
import { brands, drafts } from '@/lib/db/schema';
import { appendHistory, loadAgentContext, runAgent, type AgentAction } from '@/lib/telegram-agent';
import { quickGenerate } from '@/lib/telegram-generate';
import { brandTag, send } from './telegram';
import { consumeBudget, type ChatBinding } from './state';
import { dailyOpsCap, modelSemaphore } from './limits';

type AgentContext = Awaited<ReturnType<typeof loadAgentContext>>;

function firstLine(s: string, n = 70): string {
  const line = s.split('\n')[0];
  return line.length > n ? `${line.slice(0, n)}…` : line;
}

async function saveIdea(b: ChatBinding, content: string): Promise<string> {
  await db.insert(drafts).values({
    userId: b.userId,
    brandId: b.brandId,
    content: content.trim().slice(0, 4000),
    status: 'idea' as const,
    notes: JSON.stringify({ platform: 'both', source: 'telegram-agent' }),
  });
  return `saved. it's on the board as an idea, and tomorrow's brief can pick it up. say "draft it" whenever you want it written.`;
}

async function generatePost(
  b: ChatBinding,
  topic: string,
  platform: 'twitter' | 'linkedin' | 'both',
): Promise<string | null> {
  const used = await consumeBudget(b.brandId, dailyOpsCap());
  if (used === null) {
    return `i'm at today's budget cap for this brand (${dailyOpsCap()} runs), holding drafts until tomorrow. /budget has the details.`;
  }
  const started = Date.now();
  const result = await modelSemaphore.run(() =>
    quickGenerate(b.brandId, topic, { userId: b.userId, platform }),
  ).catch(() => null);
  if (!result) return `couldn't draft that one right now. try again in a minute or rephrase the topic.`;

  const secs = Math.round((Date.now() - started) / 1000);
  if (result.twitter) await send(b.chatId, `${brandTag(b.brandName)}for X:\n\n${result.twitter}`);
  if (result.linkedin) await send(b.chatId, `${brandTag(b.brandName)}for LinkedIn${result.templateName ? ` (${result.templateName} shape)` : ''}:\n\n${result.linkedin}`);
  await send(b.chatId, `${brandTag(b.brandName)}${secs}s. edit anything and i learn the rule.`);
  return null; // already sent the content itself
}

async function executeAction(b: ChatBinding, action: AgentAction, ctx: AgentContext): Promise<string | null> {
  switch (action.tool) {
    case 'save_idea':
      return saveIdea(b, action.content);

    case 'generate_post':
      return generatePost(b, action.topic, action.platform ?? 'both');

    case 'show_draft': {
      const d = ctx.recentDrafts.find(x => x.id === action.draftId);
      if (!d) return `can't find that draft anymore, say "drafts" for the current list.`;
      return `${d.content}${d.linkedinContent ? `\n\nlinkedin version:\n${d.linkedinContent}` : ''}`;
    }

    case 'show_idea': {
      const i = ctx.recentIdeas.find(x => x.id === action.ideaId);
      if (!i) return `can't find that idea anymore, say "ideas" for the current list.`;
      return i.content;
    }

    case 'list_ideas':
      if (ctx.recentIdeas.length === 0) return `no ideas parked right now. send me one in plain words and i'll hold it.`;
      return `parked ideas:\n${ctx.recentIdeas.map((i, n) => `${n + 1}. ${firstLine(i.content)}`).join('\n')}\n\nsay "draft number 2" or similar and i'll write it.`;

    case 'list_drafts':
      if (ctx.recentDrafts.length === 0) return `nothing in drafts right now. give me a topic and there will be.`;
      return `recent drafts:\n${ctx.recentDrafts.map((d, n) => `${n + 1}. ${firstLine(d.content)} (${d.status})`).join('\n')}`;

    case 'help':
      return `talk to me in plain words. i park ideas, draft posts for X and LinkedIn, and show you what's queued. "brief now" and "report now" run the rituals, and /brand changes what this chat drives.`;

    case 'reply':
      return action.text;

    default:
      return `didn't catch that, /help has the shape of things.`;
  }
}

// Entry point from chat.ts for free-text messages on bound chats.
export async function handleFreeText(b: ChatBinding, text: string): Promise<void> {
  const [brandRow] = await db
    .select({ name: brands.name })
    .from(brands)
    .where(eq(brands.id, b.brandId))
    .limit(1);

  const ctx = await loadAgentContext(b.userId, b.brandId);
  const action = await runAgent(b.userId, text, ctx, brandRow?.name ?? b.brandName);

  await appendHistory(b.userId, 'user', text);
  const reply = await executeAction(b, action, ctx);
  if (reply) {
    await send(b.chatId, `${brandTag(b.brandName)}${reply}`);
    await appendHistory(b.userId, 'assistant', reply.slice(0, 600));
  } else {
    await appendHistory(b.userId, 'assistant', `[sent drafts for: ${text.slice(0, 120)}]`);
  }
}
