// Message router for bound chats. Everything here runs against the chat's
// binding (explicit userId + brandId). No ambient brand anywhere.

import { and, desc, eq, sql as dsql } from 'drizzle-orm';
import { db } from '@/lib/db';
import { brands, skills, users } from '@/lib/db/schema';
import { quickGenerate } from '@/lib/telegram-generate';
import { brandTag, send } from './telegram';
import { budgetUsedToday, consumeBudget, setPaused, type ChatBinding } from './state';
import { runEveningReport, runMorningBrief } from './jobs';
import { dailyOpsCap, modelSemaphore } from './limits';
import { loadPlugins } from './plugins';
import { handleFreeText } from './agent';
import { startOnboarding } from './onboarding';

const HELP_LINES = [
  `send any topic and i draft it in your voice for X and LinkedIn.`,
  ``,
  `"brief now" runs the morning brief, "report now" runs the evening wrap.`,
  `/brand switches which brand this chat drives`,
  `/pause and /resume control the daily rhythm`,
  `/voice shows what i've learned about how you write`,
  `/budget shows today's usage`,
];

async function helpText(): Promise<string> {
  const extra = (await loadPlugins()).flatMap((p) => p.help ?? []);
  return [...HELP_LINES, ...extra].join('\n');
}

async function draftTopic(b: ChatBinding, topic: string): Promise<void> {
  const used = await consumeBudget(b.brandId, dailyOpsCap());
  if (used === null) {
    await send(b.chatId, `${brandTag(b.brandName)}i'm at today's budget cap for this brand (${dailyOpsCap()} runs), so i'm holding drafts until tomorrow. /budget has the details.`);
    return;
  }

  await send(b.chatId, `${brandTag(b.brandName)}on it, drafting.`);
  const started = Date.now();
  const result = await modelSemaphore.run(() =>
    quickGenerate(b.brandId, topic, { userId: b.userId, platform: 'both' }),
  ).catch(() => null);

  if (!result) {
    await send(b.chatId, `${brandTag(b.brandName)}couldn't draft that one right now. try again in a minute or rephrase the topic.`);
    return;
  }
  const secs = Math.round((Date.now() - started) / 1000);
  if (result.twitter) await send(b.chatId, `${brandTag(b.brandName)}for X:\n\n${result.twitter}`);
  if (result.linkedin) await send(b.chatId, `${brandTag(b.brandName)}for LinkedIn${result.templateName ? ` (${result.templateName} shape)` : ''}:\n\n${result.linkedin}`);
  await send(b.chatId, `${brandTag(b.brandName)}${secs}s, written against your voice doc and checked before you saw it. edit anything and i learn the rule.`);
}

// A bare number replies to the last brief's numbered ideas (same contract the
// old webhook flow used, ideas are stored on users.telegramLastIdeas).
async function ideaByNumber(b: ChatBinding, n: number): Promise<string | null> {
  const [u] = await db
    .select({ ideas: users.telegramLastIdeas })
    .from(users)
    .where(eq(users.id, b.userId))
    .limit(1);
  const idea = u?.ideas?.ideas?.find(i => i.index === n);
  return idea?.content ?? null;
}

export async function handleBoundMessage(b: ChatBinding, text: string): Promise<void> {
  const t = text.trim();
  const lower = t.toLowerCase();

  if (lower === '/start') {
    await send(b.chatId, `${brandTag(b.brandName)}this chat is already set up. ${await helpText()}`);
    return;
  }
  if (lower === '/help') {
    await send(b.chatId, `${brandTag(b.brandName)}${await helpText()}`);
    return;
  }
  if (lower === '/brand') {
    await startOnboarding(b.chatId); // re-runs the pick-brand flow and rebinds explicitly
    return;
  }
  if (lower === '/pause') {
    await setPaused(b.chatId, true);
    await send(b.chatId, `${brandTag(b.brandName)}paused. no briefs or wraps until you /resume. drafts on demand still work.`);
    return;
  }
  if (lower === '/resume') {
    await setPaused(b.chatId, false);
    await send(b.chatId, `${brandTag(b.brandName)}back on. the daily rhythm picks up from the next scheduled slot.`);
    return;
  }
  if (lower === '/voice') {
    const [brand] = await db
      .select({ voiceSummary: brands.voiceSummary, voiceDocument: brands.voiceDocument, updatedAt: brands.voiceDocumentUpdatedAt })
      .from(brands)
      .where(eq(brands.id, b.brandId))
      .limit(1);
    const ruleRows = await db
      .select({ name: skills.name })
      .from(skills)
      .where(and(eq(skills.brandId, b.brandId), eq(skills.status, 'active')))
      .orderBy(desc(skills.createdAt))
      .limit(5);
    const [ruleCount] = await db
      .select({ n: dsql<number>`count(*)::int` })
      .from(skills)
      .where(and(eq(skills.brandId, b.brandId), eq(skills.status, 'active')));

    const summary = brand?.voiceSummary || brand?.voiceDocument?.slice(0, 500) || null;
    if (!summary) {
      await send(b.chatId, `${brandTag(b.brandName)}no voice document yet for this brand. connect a handle with real posts, or keep editing drafts and i'll build one from your corrections.`);
      return;
    }
    const rules = ruleRows.length > 0
      ? `\n\nrules learned from your edits (${ruleCount?.n ?? ruleRows.length} active), latest:\n${ruleRows.map(r => `- ${r.name}`).join('\n')}`
      : '';
    await send(b.chatId,
      `${brandTag(b.brandName)}how i currently read your voice:\n\n${summary}${rules}\n\n` +
      `this updates every week from your edits and corrections. if something in here is wrong, tell me and it becomes a correction.`);
    return;
  }
  if (lower === '/budget') {
    const used = await budgetUsedToday(b.brandId);
    await send(b.chatId, `${brandTag(b.brandName)}${used} of ${dailyOpsCap()} runs used today. each brief, wrap, or draft counts as one. resets at midnight.`);
    return;
  }
  for (const plugin of await loadPlugins()) {
    if (plugin.onMessage && (await plugin.onMessage(b, lower))) return;
  }
  if (lower === 'brief now' || lower === '/brief') {
    await runMorningBrief(b, { manual: true });
    return;
  }
  if (lower === 'report now' || lower === '/report') {
    await runEveningReport(b, { manual: true });
    return;
  }

  const asNumber = /^\d{1,2}$/.test(t) ? parseInt(t, 10) : null;
  if (asNumber !== null) {
    const idea = await ideaByNumber(b, asNumber);
    if (idea) {
      await draftTopic(b, idea);
      return;
    }
    await send(b.chatId, `${brandTag(b.brandName)}no idea list is live right now. run "brief now" first, or just send the topic in words.`);
    return;
  }

  if (t.length < 3) {
    await send(b.chatId, `${brandTag(b.brandName)}${await helpText()}`);
    return;
  }

  // Everything else goes through the real agent loop: Haiku routes the message
  // to a typed tool (park idea, draft, show/list, or just answer) with the
  // chat's rolling history as context.
  await handleFreeText(b, t);
}
