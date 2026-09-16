import { NextRequest, NextResponse } from 'next/server';
import { timingSafeEqual } from 'crypto';
import { and, desc, eq, inArray } from 'drizzle-orm';
import { db } from '@/lib/db';
import { users, brands, drafts } from '@/lib/db/schema';
import { sendMessage, downloadFile, transcribeVoice, type TelegramUpdate } from '@/lib/telegram';
import { quickGenerate } from '@/lib/telegram-generate';
import { deductCredits, refundCredits, recordCost, checkOperationalDailyLimit } from '@/lib/credits';
import { pickIdeaByHint, loadRecentContext, type Intent } from '@/lib/telegram-intent';
import { runAgent, loadAgentContext, appendHistory, type AgentAction } from '@/lib/telegram-agent';

const WELCOME = `Lore is connected. ✓

Send me a voice memo or a text and I'll save it as an idea on your board. You can review and turn it into a post when you're ready.

Try it: tap the mic and tell me what you're thinking about right now.`;

const UNLINKED = `This Telegram isn't linked to a Lore account yet. Open Lore → Settings → Telegram and tap "Connect Telegram" to get started.`;

async function findUserByChat(chatId: number): Promise<{ id: string } | null> {
  const [user] = await db
    .select({ id: users.id })
    .from(users)
    .where(eq(users.telegramChatId, String(chatId)))
    .limit(1);
  return user ?? null;
}

async function getActiveBrandForUser(userId: string): Promise<string | null> {
  const [brand] = await db
    .select({ id: brands.id })
    .from(brands)
    .where(and(eq(brands.userId, userId), eq(brands.isActive, true)))
    .orderBy(desc(brands.createdAt))
    .limit(1);
  return brand?.id ?? null;
}

async function saveIdeaDraft(userId: string, brandId: string, content: string, source: 'voice' | 'text'): Promise<void> {
  await db.insert(drafts).values({
    userId,
    brandId,
    content: content.trim().slice(0, 4000),
    status: 'idea' as const,
    notes: JSON.stringify({ platform: 'both', source: `telegram-${source}` }),
  });
}

// Escape user-generated text for Telegram HTML parse_mode.
// Telegram HTML only needs &, <, > escaped. Quotes/etc. pass through.
function escapeHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

// Telegram caps a single message at 4096 chars. Split on paragraph boundaries
// if a post somehow goes over. Rare for an X post, possible for LinkedIn.
function chunkForTelegram(body: string, limit = 3800): string[] {
  if (body.length <= limit) return [body];
  const parts: string[] = [];
  let remaining = body;
  while (remaining.length > limit) {
    let cut = remaining.lastIndexOf('\n\n', limit);
    if (cut < limit / 2) cut = remaining.lastIndexOf('\n', limit);
    if (cut < limit / 2) cut = limit;
    parts.push(remaining.slice(0, cut).trim());
    remaining = remaining.slice(cut).trim();
  }
  if (remaining) parts.push(remaining);
  return parts;
}

// Generate a full X+LinkedIn post from a topic. Deducts credits, refunds on failure.
// Returns true if a draft was saved, false otherwise (already messaged the user).
async function generateAndSave(
  userId: string,
  brandId: string,
  chatId: number,
  topic: string,
  source: 'telegram-reply' | 'telegram-followup' | 'telegram-intent',
  prefix: string,
  platform: 'twitter' | 'linkedin' | 'both' = 'both',
): Promise<boolean> {
  // Charge credits up-front (same pattern as /api/generate chat path)
  const { ok, balance, required } = await deductCredits(userId, 'chat_generate');
  if (!ok) {
    await sendMessage(
      chatId,
      `You're out of credits — need ${required}, you have ${balance}. Top up in Lore → Settings → Plan, then try again.`,
    );
    return false;
  }

  await sendMessage(chatId, `${prefix}…`);

  let result: { twitter: string; linkedin: string } | null = null;
  try {
    result = await quickGenerate(brandId, topic, { userId, platform });
  } catch {
    result = null;
  }

  if (!result) {
    // Refund, we didn't deliver
    await refundCredits(userId, 'chat_generate').catch(() => {});
    await sendMessage(chatId, `Couldn't draft right now. Credits refunded. Try again or open Lore.`);
    return false;
  }

  // The draft's primary `content` field stores whichever platform we have. If only
  // LinkedIn is generated, content gets the LinkedIn copy and notes.platform = 'linkedin'.
  const primaryContent = platform === 'linkedin' && !result.twitter
    ? result.linkedin
    : result.twitter || result.linkedin;
  const draftPlatform: 'twitter' | 'linkedin' | 'both' = platform;

  await db.insert(drafts).values({
    userId,
    brandId,
    content: primaryContent,
    status: 'draft' as const,
    notes: JSON.stringify({
      platform: draftPlatform,
      linkedinContent: result.linkedin || undefined,
      source,
    }),
  });

  // ── Render the post(s) directly in chat, only what was actually requested ──
  if (result.twitter?.trim() && (platform === 'twitter' || platform === 'both')) {
    const xChunks = chunkForTelegram(result.twitter);
    for (let i = 0; i < xChunks.length; i++) {
      const header = i === 0 ? `<b>X post</b>\n\n` : '';
      await sendMessage(chatId, `${header}${escapeHtml(xChunks[i])}`, { parse_mode: 'HTML' });
    }
  }

  if (result.linkedin?.trim() && (platform === 'linkedin' || platform === 'both')) {
    const liChunks = chunkForTelegram(result.linkedin);
    for (let i = 0; i < liChunks.length; i++) {
      const header = i === 0 ? `<b>LinkedIn post</b>\n\n` : '';
      await sendMessage(chatId, `${header}${escapeHtml(liChunks[i])}`, { parse_mode: 'HTML' });
    }
  }

  // Confirmation + deep link to board for editing/publishing
  const appUrl = process.env.NEXT_PUBLIC_APP_URL ?? process.env.NEXTAUTH_URL ?? '';
  const boardLink = appUrl ? `\n\n<a href="${appUrl}/board">Open on board</a> to edit, regenerate, or publish.` : '\n\nOpen Lore to edit, regenerate, or publish.';
  await sendMessage(chatId, `Saved as a draft. ✓${boardLink}`, { parse_mode: 'HTML' });

  return true;
}

// Map a slash command typed by the user (or tapped from the menu) to an Intent.
// Returns null if it's not a recognized slash command, falls through to the LLM classifier.
function parseSlashCommand(text: string): Intent | null {
  // Telegram strips the @botname suffix in groups, so handle both forms
  const match = text.trim().match(/^\/(\w+)(?:@\w+)?(?:\s+(.*))?$/);
  if (!match) return null;
  const cmd = match[1].toLowerCase();
  const arg = match[2]?.trim() ?? '';

  switch (cmd) {
    case 'draft':
      // /draft → most recent idea
      // /draft <hint> → match against recent ideas by hint
      return { kind: 'generate_from_recent', referenceHint: arg || undefined };
    case 'new':
    case 'write':
      // /new <topic>: generate a fresh post about an inline topic
      if (!arg) return { kind: 'help' }; // empty /new → show usage
      return { kind: 'generate_new', topic: arg };
    case 'ideas':
      return { kind: 'list_ideas' };
    case 'drafts':
      return { kind: 'list_drafts' };
    case 'help':
      return { kind: 'help' };
    default:
      return null;
  }
}

// Execute the agent's chosen tool. Returns a short summary string to log in chat history.
async function executeAgentAction(
  action: AgentAction,
  userId: string,
  brandId: string,
  chatId: number,
  originalText: string,
  ctx: Awaited<ReturnType<typeof loadAgentContext>>,
): Promise<string> {
  switch (action.tool) {
    case 'save_idea': {
      await saveIdeaDraft(userId, brandId, action.content, 'text');
      const msg = `Saved as an idea. ✓ Say "draft it" or tap /draft to turn it into a full post.`;
      await sendMessage(chatId, msg);
      return msg;
    }

    case 'generate_post': {
      // If the agent named a saved idea, use its full content as the topic
      let topic = action.topic;
      if (action.fromIdeaId) {
        const idea = ctx.recentIdeas.find(i => i.id === action.fromIdeaId);
        if (idea) topic = idea.content;
      }
      const platform = action.platform ?? 'both';
      const platformLabel = platform === 'twitter' ? 'X' : platform === 'linkedin' ? 'LinkedIn' : 'X + LinkedIn';
      const ok = await generateAndSave(userId, brandId, chatId, topic, 'telegram-intent', `Drafting ${platformLabel}`, platform);
      return ok ? `[generated ${platform} post about "${topic.slice(0, 60)}"]` : `[generation failed]`;
    }

    case 'show_draft': {
      const d = ctx.recentDrafts.find(r => r.id === action.draftId);
      if (!d) {
        const msg = `That draft isn't on your recent list anymore.`;
        await sendMessage(chatId, msg);
        return msg;
      }
      const idx = ctx.recentDrafts.indexOf(d) + 1;
      await sendDraftBack(chatId, idx, d.content, d.linkedinContent);
      return `[showed draft #${idx}]`;
    }

    case 'show_idea': {
      const i = ctx.recentIdeas.find(r => r.id === action.ideaId);
      if (!i) {
        const msg = `That idea isn't on your recent list anymore.`;
        await sendMessage(chatId, msg);
        return msg;
      }
      const idx = ctx.recentIdeas.indexOf(i) + 1;
      const msg = `<b>Idea #${idx}</b>\n\n${escapeHtml(i.content)}`;
      await sendMessage(chatId, msg, { parse_mode: 'HTML' });
      return `[showed idea #${idx}]`;
    }

    case 'list_ideas': {
      await executeIntent({ kind: 'list_ideas' }, userId, brandId, chatId, originalText);
      return `[listed ideas]`;
    }

    case 'list_drafts': {
      await executeIntent({ kind: 'list_drafts' }, userId, brandId, chatId, originalText);
      return `[listed drafts]`;
    }

    case 'help': {
      await executeIntent({ kind: 'help' }, userId, brandId, chatId, originalText);
      return `[showed help]`;
    }

    case 'reply': {
      await sendMessage(chatId, action.text);
      return action.text;
    }
  }
}

// Run an Intent. Shared between the slash-command path and the LLM-classifier path.
async function executeIntent(
  intent: Intent,
  userId: string,
  brandId: string,
  chatId: number,
  originalText: string,
  ctxRecent?: Awaited<ReturnType<typeof loadRecentContext>>,
): Promise<void> {
  // Lazy-load context only if the intent needs it
  const ctx = ctxRecent ?? (intent.kind === 'generate_from_recent' || intent.kind === 'list_ideas' ? await loadRecentContext(userId, brandId) : null);

  if (intent.kind === 'generate_from_recent') {
    const ideas = ctx?.ideas ?? [];
    const idea = pickIdeaByHint(ideas, intent.referenceHint);
    if (idea) {
      const matchedByHint = !!intent.referenceHint && idea !== ideas[0];
      const prefix = matchedByHint
        ? `Drafting the one about "${intent.referenceHint}"`
        : `Drafting from your last idea`;
      await generateAndSave(userId, brandId, chatId, idea.content, 'telegram-intent', prefix);
      return;
    }
    await sendMessage(
      chatId,
      `I don't see any saved ideas yet. Send me one first (voice memo or text), then say "draft it" or /draft.`,
    );
    return;
  }

  if (intent.kind === 'generate_new') {
    await generateAndSave(userId, brandId, chatId, intent.topic, 'telegram-intent', `Drafting a post about "${intent.topic.slice(0, 60)}"`);
    return;
  }

  if (intent.kind === 'pick_from_list') {
    // Read the most recent list context. If none, the user is referencing nothing, explain.
    const [row] = await db
      .select({ ctx: users.telegramLastIdeas })
      .from(users)
      .where(eq(users.id, userId))
      .limit(1);
    const listCtx = row?.ctx;
    if (!listCtx?.ideas?.length || (listCtx.type !== 'list_ideas' && listCtx.type !== 'list_drafts')) {
      await sendMessage(chatId, `I don't have a recent list to pick from. Tap /ideas or /drafts first, then say "show me the 2nd one".`);
      return;
    }
    const idx = Math.max(0, Math.min(listCtx.ideas.length - 1, intent.index - 1));
    const item = listCtx.ideas[idx];
    if (!item) {
      await sendMessage(chatId, `That list only has ${listCtx.ideas.length} item${listCtx.ideas.length === 1 ? '' : 's'}. Pick a number from 1 to ${listCtx.ideas.length}.`);
      return;
    }
    if (listCtx.type === 'list_ideas') {
      // Pick from /ideas → draft it (charges credits, saves a draft)
      await generateAndSave(userId, brandId, chatId, item.content, 'telegram-intent', `Drafting #${idx + 1}`);
    } else {
      // Pick from /drafts → just read it back (free, no AI call)
      await sendDraftBack(chatId, idx + 1, item.content, item.linkedinContent);
    }
    await db.update(users)
      .set({ telegramLastIdeas: null, updatedAt: new Date() })
      .where(eq(users.id, userId));
    return;
  }

  if (intent.kind === 'list_ideas') {
    const ctx2 = ctx ?? await loadRecentContext(userId, brandId);
    const ideas = ctx2.ideas;
    const list = formatList(
      ideas,
      `No ideas saved yet. Send me a voice memo or a text and I'll save it as an idea.`,
      `Recent ideas`,
    );
    // Persist as a pickable context so a follow-up "1"/"2"/"3" (or "show me the 2nd") drafts that idea.
    if (ideas.length > 0) {
      await db.update(users)
        .set({
          telegramLastIdeas: {
            type: 'list_ideas',
            sentAt: new Date().toISOString(),
            ideas: ideas.slice(0, 5).map((idea, i) => ({
              index: i + 1,
              content: idea.content,
              draftId: idea.id,
            })),
          },
          updatedAt: new Date(),
        })
        .where(eq(users.id, userId));
      await sendMessage(chatId, list + `\n\n<i>Reply with a number (or "show me the 2nd") to draft that idea.</i>`, { parse_mode: 'HTML' });
    } else {
      await sendMessage(chatId, list, { parse_mode: 'HTML' });
    }
    return;
  }

  if (intent.kind === 'list_drafts') {
    const recentDrafts = await db
      .select({ id: drafts.id, content: drafts.content, notes: drafts.notes, createdAt: drafts.createdAt })
      .from(drafts)
      .where(and(
        eq(drafts.userId, userId),
        eq(drafts.brandId, brandId),
        inArray(drafts.status, ['draft', 'review'] as const),
      ))
      .orderBy(desc(drafts.createdAt))
      .limit(5);
    const list = formatList(
      recentDrafts,
      `No drafts yet. Save an idea and say "draft it" to generate your first post.`,
      `Recent drafts`,
    );
    if (recentDrafts.length > 0) {
      // Persist as a pickable context so "2" or "show me the 2nd one" reads the draft back.
      // Parse linkedinContent out of the notes JSON so it survives the pick.
      await db.update(users)
        .set({
          telegramLastIdeas: {
            type: 'list_drafts',
            sentAt: new Date().toISOString(),
            ideas: recentDrafts.slice(0, 5).map((d, i) => {
              let linkedin: string | undefined;
              try {
                const n = d.notes ? JSON.parse(d.notes) : null;
                if (n && typeof n.linkedinContent === 'string') linkedin = n.linkedinContent;
              } catch {}
              return {
                index: i + 1,
                content: d.content,
                draftId: d.id,
                linkedinContent: linkedin,
              };
            }),
          },
          updatedAt: new Date(),
        })
        .where(eq(users.id, userId));
      await sendMessage(chatId, list + `\n\n<i>Reply with a number (or "show me the 2nd") to see the full post.</i>`, { parse_mode: 'HTML' });
    } else {
      await sendMessage(chatId, list, { parse_mode: 'HTML' });
    }
    return;
  }

  if (intent.kind === 'help') {
    await sendMessage(
      chatId,
      `Here's what I can do:\n\n<b>Menu commands</b>\n/draft — turn your last idea into a full post\n/new &lt;topic&gt; — draft a brand-new post inline\n/ideas — show your recent saved ideas\n/drafts — show your recent drafts\n/help — show this menu\n\n<b>Or just talk to me</b>\n• Send a voice memo or text — I save it as an idea\n• Say "draft it" or "draft the one about X"\n• Say "write a post about Y"\n• Say "show my ideas" or "show my drafts"\n\nEverything lands on your Lore board.`,
      { parse_mode: 'HTML' },
    );
    return;
  }

  if (intent.kind === 'chitchat') {
    await sendMessage(chatId, `Hey. Send me a voice memo or a thought and I'll save it as an idea. Tap /help for the menu.`);
    return;
  }

  // ── Default (save_idea) ───────────────────────────────────────────────────
  await saveIdeaDraft(userId, brandId, originalText, 'text');
  await sendMessage(chatId, `Saved as an idea. ✓ Send "draft it" or tap /draft to turn it into a full post.`);
}

// Detect short affirmative or single-digit replies meant to pick from a previous push/list.
// Supports 1-5 because /ideas can return up to 5 items.
function detectSmartReply(text: string): { kind: 'pick'; index: number } | { kind: 'yes' } | null {
  const clean = text.trim().toLowerCase();
  const numMatch = clean.match(/^([1-5])$/);
  if (numMatch) return { kind: 'pick', index: parseInt(numMatch[1], 10) - 1 };
  // Affirmative
  if (/^(yes|y|yep|yeah|sure|do it|draft it?|generate|go|please)$/i.test(clean)) return { kind: 'yes' };
  return null;
}

// Render a saved draft's full content back to the chat (X + LinkedIn).
// No credit charge: this is a read-back, not a generation.
async function sendDraftBack(chatId: number, index: number, twitter: string, linkedin?: string): Promise<void> {
  const xChunks = chunkForTelegram(twitter);
  for (let i = 0; i < xChunks.length; i++) {
    const header = i === 0 ? `<b>Draft #${index} — X post</b>\n\n` : '';
    await sendMessage(chatId, `${header}${escapeHtml(xChunks[i])}`, { parse_mode: 'HTML' });
  }
  if (linkedin?.trim()) {
    const liChunks = chunkForTelegram(linkedin);
    for (let i = 0; i < liChunks.length; i++) {
      const header = i === 0 ? `<b>Draft #${index} — LinkedIn post</b>\n\n` : '';
      await sendMessage(chatId, `${header}${escapeHtml(liChunks[i])}`, { parse_mode: 'HTML' });
    }
  }
}

// Format a list of recent items into a short Telegram message.
function formatList(items: { content: string; createdAt: Date }[], emptyMsg: string, label: string): string {
  if (items.length === 0) return emptyMsg;
  const lines = items.slice(0, 5).map((d, i) => {
    const flat = d.content.replace(/\n+/g, ' ').replace(/\s+/g, ' ').trim();
    const preview = flat.length > 110 ? flat.slice(0, 110) + '…' : flat;
    const age = relativeAge(d.createdAt);
    return `${i + 1}. ${escapeHtml(preview)}\n   <i>${age}</i>`;
  });
  return `<b>${label}</b> (${items.length})\n\n${lines.join('\n\n')}`;
}

function relativeAge(d: Date): string {
  const ms = Date.now() - d.getTime();
  const m = Math.floor(ms / 60000);
  if (m < 1) return 'just now';
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  const days = Math.floor(h / 24);
  return `${days}d ago`;
}

function safeEqual(a: string, b: string): boolean {
  const ab = Buffer.from(a);
  const bb = Buffer.from(b);
  if (ab.length !== bb.length) return false;
  return timingSafeEqual(ab, bb);
}

export async function POST(req: NextRequest) {
  // Fails closed: without TELEGRAM_WEBHOOK_SECRET the webhook is unverifiable.
  const secret = process.env.TELEGRAM_WEBHOOK_SECRET;
  if (!secret) {
    return NextResponse.json({ ok: false }, { status: 401 });
  }
  const incoming = req.headers.get('x-telegram-bot-api-secret-token') ?? '';
  if (!incoming || !safeEqual(incoming, secret)) {
    return NextResponse.json({ ok: false }, { status: 401 });
  }

  const update = await req.json().catch(() => null) as TelegramUpdate | null;
  if (!update?.message) return NextResponse.json({ ok: true });

  const msg = update.message;
  const chatId = msg.chat.id;
  const text = msg.text ?? '';

  // ── /start <token> → link Telegram chat to user account ───────────────
  if (text.startsWith('/start')) {
    const linkToken = text.split(/\s+/)[1]?.trim();

    if (!linkToken) {
      // Plain /start (no token), show status
      const user = await findUserByChat(chatId);
      if (user) {
        await sendMessage(chatId, `You're already connected to Lore. Send a voice memo or text and I'll save it as an idea.`);
      } else {
        await sendMessage(chatId, UNLINKED);
      }
      return NextResponse.json({ ok: true });
    }

    // Look up user by link token
    const [user] = await db
      .select({ id: users.id, name: users.name })
      .from(users)
      .where(eq(users.telegramLinkToken, linkToken))
      .limit(1);

    if (!user) {
      await sendMessage(chatId, `That link expired or isn't valid. Open Lore → Settings → Telegram and try again.`);
      return NextResponse.json({ ok: true });
    }

    // Save chat ID, clear the one-time token
    await db.update(users)
      .set({
        telegramChatId: String(chatId),
        telegramLinkToken: null,
        telegramLinkedAt: new Date(),
        updatedAt: new Date(),
      })
      .where(eq(users.id, user.id));

    await sendMessage(chatId, WELCOME);
    return NextResponse.json({ ok: true });
  }

  // For everything else, the chat must be linked
  const user = await findUserByChat(chatId);
  if (!user) {
    await sendMessage(chatId, UNLINKED);
    return NextResponse.json({ ok: true });
  }

  const brandId = await getActiveBrandForUser(user.id);
  if (!brandId) {
    await sendMessage(chatId, `You don't have an active brand yet. Open Lore and complete onboarding first.`);
    return NextResponse.json({ ok: true });
  }

  // ── Voice memo → transcribe → save as idea ────────────────────────────
  if (msg.voice) {
    if (msg.voice.duration > 600) {
      await sendMessage(chatId, `That memo is over 10 minutes. Send something shorter and I'll grab it faster.`);
      return NextResponse.json({ ok: true });
    }

    // Enforce daily voice cap per plan
    const voiceLimit = await checkOperationalDailyLimit(user.id, 'voice_transcribe');
    if (!voiceLimit.allowed) {
      await sendMessage(
        chatId,
        `You've hit your daily voice-memo limit (${voiceLimit.limit}/day on your current plan). Resets at midnight UTC. Send text in the meantime, or upgrade your plan in Lore → Settings.`,
      );
      return NextResponse.json({ ok: true });
    }

    await sendMessage(chatId, `Got it. Transcribing...`);
    const blob = await downloadFile(msg.voice.file_id);
    if (!blob) {
      await sendMessage(chatId, `Couldn't download that audio. Try again?`);
      return NextResponse.json({ ok: true });
    }

    const transcript = await transcribeVoice(blob);
    // Telemetry: Groq Whisper cost per voice memo, scaled by duration
    recordCost(user.id, 'voice_transcribe', { durationSec: msg.voice.duration }).catch(() => {});
    if (!transcript) {
      await sendMessage(chatId, `Couldn't transcribe that. Try again or send as text.`);
      return NextResponse.json({ ok: true });
    }

    await saveIdeaDraft(user.id, brandId, transcript, 'voice');
    const preview = transcript.slice(0, 200).replace(/\n+/g, ' ');
    await sendMessage(
      chatId,
      `Saved as an idea on your board.\n\n"${preview}${transcript.length > 200 ? '…' : ''}"\n\nGenerate the full post when you're ready in Lore.`
    );
    return NextResponse.json({ ok: true });
  }

  // ── Slash commands (typed or tapped from the menu) ────────────────────────
  // These run BEFORE the smart-reply / agent paths so /draft etc. are deterministic.
  if (text.startsWith('/')) {
    const slashIntent = parseSlashCommand(text);
    if (slashIntent) {
      await appendHistory(user.id, 'user', text);
      await executeIntent(slashIntent, user.id, brandId, chatId, text);
      // Log a brief summary of what the bot did so the agent has context on the next turn
      await appendHistory(user.id, 'assistant', `[executed ${slashIntent.kind}]`);
      return NextResponse.json({ ok: true });
    }
    await sendMessage(chatId, `Unknown command. Tap /help to see what I can do.`);
    return NextResponse.json({ ok: true });
  }

  // ── Smart reply: "1" / "2" / "3" / "yes" picks from previously sent ideas ──
  if (text) {
    const smart = detectSmartReply(text);
    if (smart) {
      const [row] = await db
        .select({ ctx: users.telegramLastIdeas })
        .from(users)
        .where(eq(users.id, user.id))
        .limit(1);
      const ctx = row?.ctx;

      // Daily push context: pick by number (or default to idea 1 for "yes")
      if (ctx?.type === 'daily' && ctx.ideas?.length) {
        const idx = smart.kind === 'pick' ? smart.index : 0;
        const idea = ctx.ideas[idx];
        if (idea) {
          await generateAndSave(user.id, brandId, chatId, idea.content, 'telegram-reply', `Drafting #${idx + 1}`);
          await db.update(users)
            .set({ telegramLastIdeas: null, updatedAt: new Date() })
            .where(eq(users.id, user.id));
          return NextResponse.json({ ok: true });
        }
      }

      // Perf ping context: "yes" → write a follow-up to the high-performing post
      if (ctx?.type === 'perf' && smart.kind === 'yes' && ctx.highPostContent) {
        const topic = `Follow-up to my recent post:\n\n"${ctx.highPostContent}"\n\nWrite a follow-up that picks up where this left off — same voice, but advance the argument or share what happened next. Don't repeat the same hook.`;
        await generateAndSave(user.id, brandId, chatId, topic, 'telegram-followup', `Drafting a follow-up`);
        await db.update(users)
          .set({ telegramLastIdeas: null, updatedAt: new Date() })
          .where(eq(users.id, user.id));
        return NextResponse.json({ ok: true });
      }

      // Ideas-list context (set by /ideas): "N" picks the Nth idea and DRAFTS it
      if (ctx?.type === 'list_ideas' && ctx.ideas?.length) {
        const idx = smart.kind === 'pick' ? smart.index : 0;
        const idea = ctx.ideas[idx];
        if (idea) {
          await generateAndSave(user.id, brandId, chatId, idea.content, 'telegram-intent', `Drafting #${idx + 1}`);
          await db.update(users)
            .set({ telegramLastIdeas: null, updatedAt: new Date() })
            .where(eq(users.id, user.id));
          return NextResponse.json({ ok: true });
        }
      }

      // Drafts-list context (set by /drafts): "N" picks the Nth draft and SHOWS its full content
      if (ctx?.type === 'list_drafts' && ctx.ideas?.length) {
        const idx = smart.kind === 'pick' ? smart.index : 0;
        const item = ctx.ideas[idx];
        if (item) {
          await sendDraftBack(chatId, idx + 1, item.content, item.linkedinContent);
          await db.update(users)
            .set({ telegramLastIdeas: null, updatedAt: new Date() })
            .where(eq(users.id, user.id));
          return NextResponse.json({ ok: true });
        }
      }
      // No matching context, fall through to intent detection / "save as idea"
    }

    // ── LLM AGENT: read chat history + recent ideas/drafts, pick a tool to run ──
    // Free-text messages go through Haiku for routing. Post generation tools call
    // quickGenerate internally, which uses Sonnet, same quality as the dashboard.

    // Enforce daily agent-routing cap per plan (rate-limits free-text Telegram usage)
    const agentLimit = await checkOperationalDailyLimit(user.id, 'agent_route');
    if (!agentLimit.allowed) {
      await sendMessage(
        chatId,
        `You've hit your daily Telegram chat limit (${agentLimit.limit}/day on your current plan). Resets at midnight UTC. Tap /draft or /ideas for direct commands, open Lore, or upgrade your plan in Settings.`,
      );
      return NextResponse.json({ ok: true });
    }

    const agentCtx = await loadAgentContext(user.id, brandId);
    const [brandRow] = await db.select({ name: brands.name }).from(brands).where(eq(brands.id, brandId)).limit(1);
    const action = await runAgent(user.id, text, agentCtx, brandRow?.name ?? 'the creator');

    // Record this turn in history BEFORE running the tool, so partial failures
    // still leave a trail the agent can read on the next turn.
    await appendHistory(user.id, 'user', text);

    const reply = await executeAgentAction(action, user.id, brandId, chatId, text, agentCtx);
    if (reply) {
      await appendHistory(user.id, 'assistant', reply);
    }
    return NextResponse.json({ ok: true });
  }

  return NextResponse.json({ ok: true });
}
