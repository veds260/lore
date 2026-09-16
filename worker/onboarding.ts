// Conversational onboarding, grounded in Lore's machinery.
//
// Four beats:
//   1. Onboarding IS the conversation, no wizard. One question per message.
//   2. The "it knows me" moment comes first: pull the person's real posts and
//      answer with THEIR numbers before asking anything else.
//   3. Rituals get set inside the same conversation, with a try-now escape hatch.
//   4. Honest when thin: no tape means we say so and interview instead of faking it.
//
// Tenancy: a chat binds to exactly one (userId, brandId) pair at the end of this
// flow. Until bound, nothing model-facing runs for the chat.

import { and, desc, eq, gte, sql as dsql } from 'drizzle-orm';
import { db } from '@/lib/db';
import { brands, ownPosts, users } from '@/lib/db/schema';
import { bootstrapVoiceFromPosts } from '@/lib/bootstrap-voice';
import { fetchUserInfo } from '@/lib/twitterapi';
import { brandTag, editMessage, send, sendReturningId } from './telegram';
import { dayOfWeekInsight } from './insights';
import { loadPlugins } from './plugins';
import { clearOnboarding, getOnboarding, setBinding, setOnboarding, updateBindingHours } from './state';

interface BrandOption { id: string; name: string; handle: string | null; hasVoice: boolean }

export function staggerMinute(brandId: string): number {
  let h = 0;
  for (const c of brandId) h = (h * 31 + c.charCodeAt(0)) >>> 0;
  return h % 45;
}

function fmt(n: number): string {
  if (n >= 1000) return `${(n / 1000).toFixed(n >= 10000 ? 0 : 1)}k`;
  return String(Math.round(n));
}

async function findLinkedUser(chatId: string): Promise<{ id: string; name: string | null } | null> {
  const [u] = await db
    .select({ id: users.id, name: users.name })
    .from(users)
    .where(eq(users.telegramChatId, chatId))
    .limit(1);
  return u ?? null;
}

async function userBrands(userId: string): Promise<BrandOption[]> {
  const rows = await db
    .select({ id: brands.id, name: brands.name, handle: brands.handle, voiceDocument: brands.voiceDocument })
    .from(brands)
    .where(and(eq(brands.userId, userId), eq(brands.isActive, true)))
    .orderBy(desc(brands.createdAt));
  return rows.map(b => ({ id: b.id, name: b.name, handle: b.handle, hasVoice: !!b.voiceDocument }));
}

// ---------- checklist ----------
// One pinned-feel message that gets edited as the conversation covers each
// step, so progress is visible without a wizard.

const CHECKLIST_EXISTING = ['pick the brand this chat drives', 'i read your posting history', 'your one goal', 'when you want the daily brief'];
const CHECKLIST_NEW = ['connect your X handle', 'i read your posting history', 'your one goal', 'when you want the daily brief'];

function renderChecklist(items: string[], done: number): string {
  return `setting up, two minutes:\n${items.map((it, i) => `${i < done ? '✓' : '·'} ${it}`).join('\n')}`;
}

async function updateChecklist(chatId: string, data: Record<string, unknown>, done: number): Promise<void> {
  const msgId = typeof data.checklistMsgId === 'number' ? data.checklistMsgId : null;
  const items = Array.isArray(data.checklistItems) ? data.checklistItems as string[] : CHECKLIST_EXISTING;
  if (!msgId) return;
  await editMessage(chatId, msgId, renderChecklist(items, done)).catch(() => {});
}

// ---------- entry ----------

export async function startOnboarding(chatId: string, tgFirstName?: string): Promise<void> {
  const user = await findLinkedUser(chatId);
  if (!user) {
    await send(chatId,
      `hey${tgFirstName ? ` ${tgFirstName}` : ''}. i'm your head of content, but this chat isn't linked to a Lore account yet.\n\n` +
      `open the Lore dashboard, go to Settings, hit "Link Telegram" and come back. i'll be here.`);
    return;
  }

  const options = await userBrands(user.id);
  const first = (user.name ?? tgFirstName ?? '').split(' ')[0];

  if (options.length === 0) {
    await send(chatId,
      `hey ${first || 'there'}, i'm your head of content, and before i can be useful i need to read how you actually write.`);
    const checklistMsgId = await sendReturningId(chatId, renderChecklist(CHECKLIST_NEW, 0));
    await setOnboarding(chatId, 'new_handle', { userId: user.id, checklistMsgId, checklistItems: CHECKLIST_NEW });
    await send(chatId,
      `send me the X handle you post from (like @${user.name?.toLowerCase().replace(/\s+/g, '') || 'yourhandle'}) and i'll pull your last few months of posts.`);
    return;
  }

  const list = options.map((b, i) => `${i + 1}. ${b.name}${b.handle ? ` (@${b.handle.replace(/^@/, '')})` : ''}`).join('\n');
  await send(chatId,
    `hey ${first || 'there'}. i'm your head of content for this chat, and one chat runs one brand so nothing ever crosses wires.`);
  const checklistMsgId = await sendReturningId(chatId, renderChecklist(CHECKLIST_EXISTING, 0));
  await setOnboarding(chatId, 'pick_brand', { userId: user.id, options, checklistMsgId, checklistItems: CHECKLIST_EXISTING });
  await send(chatId,
    `which brand is this chat for?\n${list}\n\nreply with a number, or send an @handle to add a new one.`);
}

// ---------- step handlers ----------

async function handlePickBrand(chatId: string, text: string, data: Record<string, unknown>): Promise<void> {
  const userId = String(data.userId);
  const options = (data.options as BrandOption[] | undefined) ?? [];

  if (text.startsWith('@') || /^[A-Za-z0-9_]{2,15}$/.test(text.trim())) {
    await handleNewHandle(chatId, text, data);
    return;
  }

  const n = parseInt(text.trim(), 10);
  const pick = Number.isFinite(n) ? options[n - 1] : undefined;
  if (!pick) {
    await send(chatId, `didn't catch that, reply with a number from the list or an @handle for a new brand.`);
    return;
  }
  await bindAndIngest(chatId, userId, pick, null, data);
}

async function handleNewHandle(chatId: string, text: string, data: Record<string, unknown>): Promise<void> {
  const userId = String(data.userId);
  const handle = text.trim().replace(/^@/, '').replace(/^https?:\/\/(x|twitter)\.com\//, '').split(/[/?\s]/)[0];
  if (!/^[A-Za-z0-9_]{2,15}$/.test(handle)) {
    await send(chatId, `that doesn't look like an X handle. send it like @naval and i'll take it from there.`);
    return;
  }

  const info = await fetchUserInfo(handle).catch(() => null);
  const [created] = await db
    .insert(brands)
    .values({ userId, name: info?.name || handle, handle, avatarUrl: info?.avatarUrl ?? null })
    .returning({ id: brands.id, name: brands.name, handle: brands.handle });

  await bindAndIngest(chatId, userId, { id: created.id, name: created.name, handle: created.handle, hasVoice: false }, info?.followerCount ?? null, data);
}

// The "it knows me" beat: bind, ingest tape, answer with real numbers.
async function bindAndIngest(
  chatId: string,
  userId: string,
  brand: BrandOption,
  followerCount: number | null = null,
  obData: Record<string, unknown> = {},
): Promise<void> {
  await setBinding(chatId, { userId, brandId: brand.id }, brand.name);
  await updateChecklist(chatId, obData, 1);
  await send(chatId, `${brandTag(brand.name)}locked in. give me a minute, i'm reading the actual posting history, not asking you to describe it.`);

  let tapeOk = false;
  if (brand.handle) {
    const boot = await bootstrapVoiceFromPosts(brand.id, {}).catch(() => null);
    tapeOk = !!boot?.ok || boot?.reason === 'voice document already exists';
  }

  // Real numbers from the last 90 days of their own posts.
  const since = new Date(Date.now() - 90 * 24 * 60 * 60 * 1000);
  const [stats] = await db
    .select({
      count: dsql<number>`count(*)::int`,
      avgViews: dsql<number>`coalesce(avg(${ownPosts.viewCount}), 0)::float`,
      avgLikes: dsql<number>`coalesce(avg(${ownPosts.likeCount}), 0)::float`,
    })
    .from(ownPosts)
    .where(and(eq(ownPosts.brandId, brand.id), gte(ownPosts.postedAt, since)));

  const [top] = await db
    .select({ content: ownPosts.content, views: ownPosts.viewCount, likes: ownPosts.likeCount })
    .from(ownPosts)
    .where(and(eq(ownPosts.brandId, brand.id), gte(ownPosts.postedAt, since)))
    .orderBy(desc(dsql`${ownPosts.likeCount} + ${ownPosts.retweetCount} * 2 + ${ownPosts.replyCount}`))
    .limit(1);

  if (stats && stats.count >= 5 && top) {
    const mult = stats.avgViews > 0 && top.views > 0 ? (top.views / stats.avgViews) : 0;
    const hook = top.content.split('\n')[0].slice(0, 90);
    const dow = await dayOfWeekInsight(brand.id).catch(() => null);
    await send(chatId,
      `${brandTag(brand.name)}okay, read ${stats.count} posts from the last 90 days${followerCount ? ` (${fmt(followerCount)} followers)` : ''}.\n\n` +
      `your usual post does about ${fmt(stats.avgViews)} views and ${fmt(stats.avgLikes)} likes. ` +
      `the one that broke out was "${hook}" at ${fmt(top.views)} views${mult >= 1.5 ? `, roughly ${mult.toFixed(1)}x your normal` : ''}. ` +
      `that gap between your baseline and your best is what i'll be working.\n\n` +
      `${dow ? `${dow}\n\n` : ''}` +
      `one question before the rhythm gets set: what's the single outcome you want from posting right now? clients, a job, an audience for a launch, say it plainly.`);
  } else if (tapeOk) {
    await send(chatId,
      `${brandTag(brand.name)}pulled the history and built a first read of the voice. the engagement data is still thin, so numbers come once the daily sync has run for a bit.\n\n` +
      `meanwhile: what's the single outcome you want from posting right now? clients, a job, an audience for a launch, say it plainly.`);
  } else {
    // Tape gate: no usable posts. Honest, so it interviews instead of faking a voice.
    await send(chatId,
      `${brandTag(brand.name)}honest read: there isn't enough posting history for me to learn your voice from tape${brand.handle ? '' : ' (no X handle on this brand yet)'}. ` +
      `i won't fake it, so i'll draft carefully and learn from your edits.\n\n` +
      `to start me off: what do you do, and who do you want reading your posts?`);
  }

  await updateChecklist(chatId, obData, 2);
  await setOnboarding(chatId, 'goal', {
    userId, brandId: brand.id, brandName: brand.name,
    checklistMsgId: obData.checklistMsgId, checklistItems: obData.checklistItems,
  });
}

async function handleGoal(chatId: string, text: string, data: Record<string, unknown>): Promise<void> {
  const brandId = String(data.brandId);
  const brandName = String(data.brandName ?? '');
  const answer = text.trim().slice(0, 1500);

  const [row] = await db.select({ briefMd: brands.briefMd }).from(brands).where(eq(brands.id, brandId)).limit(1);
  const appended = `${row?.briefMd ? row.briefMd + '\n\n' : ''}### Goal (Telegram onboarding, ${new Date().toISOString().slice(0, 10)})\n${answer}`;
  await db.update(brands).set({ briefMd: appended, updatedAt: new Date() }).where(eq(brands.id, brandId));

  await updateChecklist(chatId, data, 3);
  await setOnboarding(chatId, 'brief_time', { ...data });
  await send(chatId,
    `${brandTag(brandName)}noted, and that goal now sits under every draft i write for this brand.\n\n` +
    `last thing: i send a morning brief (your numbers vs your own baseline, plus what to post) and an evening wrap. ` +
    `what hour do you want the morning one? just say 8, 9, or whatever fits. i stay silent outside these unless something is actually worth your attention.`);
}

async function handleBriefTime(chatId: string, text: string, data: Record<string, unknown>): Promise<void> {
  const brandId = String(data.brandId);
  const brandName = String(data.brandName ?? '');

  const m = text.trim().match(/(\d{1,2})(?::(\d{2}))?\s*(am|pm)?/i);
  let hour = 8;
  if (m) {
    hour = parseInt(m[1], 10);
    const mer = m[3]?.toLowerCase();
    if (mer === 'pm' && hour < 12) hour += 12;
    if (mer === 'am' && hour === 12) hour = 0;
  }
  if (hour < 0 || hour > 23) hour = 8;
  const eveningHour = Math.min(23, Math.max(hour + 10, 19));

  await updateBindingHours(chatId, hour, eveningHour);
  await updateChecklist(chatId, data, 4);
  await clearOnboarding(chatId);

  const minute = staggerMinute(brandId);
  await send(chatId,
    `${brandTag(brandName)}done. morning brief lands around ${hour}:${String(minute).padStart(2, '0')}, evening wrap around ${eveningHour}:${String(minute).padStart(2, '0')}.\n\n` +
    `you don't have to wait for tomorrow, say "brief now" and i'll run the first one right away.\n\n` +
    `day to day: send me any topic and i draft it in your voice for X and LinkedIn. "report now" pulls the evening wrap early, /pause stops the rhythm, /help shows the rest.`);
}

// ---------- router ----------

export async function handleOnboardingMessage(chatId: string, text: string): Promise<boolean> {
  const ob = await getOnboarding(chatId);
  if (!ob) return false;

  switch (ob.step) {
    case 'pick_brand': await handlePickBrand(chatId, text, ob.data); return true;
    case 'new_handle': await handleNewHandle(chatId, text, ob.data); return true;
    case 'goal': await handleGoal(chatId, text, ob.data); return true;
    case 'brief_time': await handleBriefTime(chatId, text, ob.data); return true;
    default:
      for (const plugin of await loadPlugins()) {
        if (plugin.onOnboardingStep && (await plugin.onOnboardingStep(chatId, ob.step, text, ob.data))) return true;
      }
      await clearOnboarding(chatId);
      return false;
  }
}
