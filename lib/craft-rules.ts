// Universal craft rules block injected into every LinkedIn (and Twitter) prompt
// across /api/generate, /api/revise, and Telegram quickGenerate. Lives between
// GLOBAL_RULES_PROMPT and the platform-specific instructions so it shapes the
// writing task itself, not just the post-hoc judge pass.
//
// Why a single source: the rules below (hook construction, closer rule, rhythm,
// no fabrication, niche stamping, news-reaction hardening) need to apply to
// EVERY way a LinkedIn post is created. Duplicating the string in three places
// would drift the moment one is updated.

export interface CraftRulesOpts {
  brandNiche?: string | null;
  isNewsReaction?: boolean;
}

export function buildCraftRules(opts: CraftRulesOpts = {}): string {
  const { brandNiche, isNewsReaction = false } = opts;

  const nicheLine = brandNiche
    ? `\n- The brand niche is "${brandNiche}". Name it AT MOST ONCE in the body. After it's named once, the rest of the post talks about the IDEA, not the niche tag.`
    : '';

  const newsReactionBlock = isNewsReaction
    ? `\n## This post is a news reaction\nAssume the reader has already seen the headline. NEVER open with a recap of it. Banned bare-recap openings: "X just launched Y", "X closed a Series A", "X announced Y yesterday".\nDecide first: does the news have THREE genuinely-distinct angles worth separate numbered paragraphs? If yes, you may use a numbered structure. If it has ONE strong claim with supporting context, write a single sharp take — specific hook, two paragraphs of context + proof, a punchline, then a universal-or-founder-authority close. Most news has one strong angle, not three. Do NOT force three numbered points if two of them say the same thing.\nNever invent personal experience with the subject (no "a friend has been using it", no "I spent the morning running it", no "I watched a team ship X with it") unless you can verify it from the topic input. Banned hedges: "reportedly", "according to reports", "per the announcement". State the fact in your own voice or drop it.\n`
    : '';

  return `## Craft rules — apply to every post

## Writing order — follow this sequence, do not skip

1. **Identify your specific take FIRST.** Before any drafting, decide what claim you are making about this topic that someone else WOULDN'T make. A specific observation, a contrarian belief, a number you've seen, a behaviour change you've watched. NOT a summary. NOT "X is important." NOT "X matters more than people think." A claim that earns the post.

2. **Anchor the body in a first-person observation.** The body must contain at least one first-person marker ("I", "we", "my", "our") tied to a specific moment, decision, or thing you've seen. If you cannot anchor in first-person, this post should not be written as a personal take — switch to a third-person analytical post on a different topic. Do not pretend.

3. **Develop the body with concrete detail.** Use named entities, numbers, and behaviours from the topic input. Never invent friends, customers, usage statistics, time-with-product claims, or unnamed testimonies. Public observation only when you have no first-person experience.

4. **Write a specific closer.** End on either (a) a universal takeaway someone outside the brand niche can apply, OR (b) a sharp operator/founder observation that demonstrates deep niche expertise. NEVER close on a vague forward-statement: "teams that adopt X will win", "the future is X", "X will eventually matter", "projects that learn to communicate this will have shorter conversations", "the ones who systematize today will absorb tomorrow's capability" — all banned. These say nothing.

5. **Write the HOOK LAST.** Now that the body knows what it says, the hook teases the strongest specific claim from the body. The hook must work for someone who has not seen the headline AND someone outside the brand niche. Banned hook shapes: news-recap lines ("X just announced Y", "X says Z", "X closed a Series A"), thesis paraphrases of the topic ("Y could become Z, according to X"), opening questions, "I" as the first word, generic openers ("In a world where...", "Most people miss this").

6. **Self-check before finalising.** Reread the hook. If it could appear in the source headline word-for-word, rewrite it. Reread the closer. If a competitor on the opposite side of the niche could write the same closer, rewrite it.

## Rhythm and weight
- X/Twitter: hook \\n\\n body \\n\\n closer — blank lines between sections. Mandatory.
- LinkedIn: spacious paragraphs with single-sentence-line density.
- Vary paragraph length. At least ONE short rhythm-break line (1 sentence, under 14 words) per long-form post.
- Don't force three numbered points when the topic has one strong angle.

## Banned phrases (cut on sight)
- News-channel hedges: "reportedly", "according to reports/sources/[Named Person]", "per the announcement", "the company stated", "as reported by".
- Consultant phrasings: "represents a significant", "remains [limited/real/relevant]", "as X transitions from Y to Z", "establish habits", "operate more efficiently", "connective tissue", "absorb that capability", "scrambling to retrofit", "stitching pieces together", "is positioning itself as", "is built for general", "shows nothing specific to", "genuinely [adjective]".
- Filler: "fundamentally", "essentially", "moreover", "furthermore", "in essence", "crucially", "notably", "arguably".
- AI lexical tells: delve, tapestry, mosaic, realm, testament to, ever-evolving, meticulous, pivotal, seamless, robust, vibrant, intricate, multifaceted, nuanced, transformative, paradigm, harness, foster, cultivate, leverage (as verb), unlock (as metaphor).
- Reframe family: "X sounds like Y until Z", "more important than the word/term Y suggests", "the X framing is more important", "It's not X. It's Y.", "not just X, but Y".${nicheLine}
${newsReactionBlock}`;
}

// Heuristic news-reaction detector for surfaces that don't get an explicit
// isNewsReaction flag (e.g. Telegram, revise, chat-mode generate). Catches:
//   1. Funding / launch / partnership announcements (raised, closed Series, acquired, launched, shipped)
//   2. Public-statement signals from named people (says, argues, claims, posts, tweets, writes, predicts, warns)
//   3. Explicit reaction-prompt phrases the user types ("react to:", "reacting to", "thoughts on", "take on")
//
// Returning true makes the news-reaction hardening block fire: no headline-recap hook,
// no fabricated personal experience, no "reportedly" hedges.
const NEWS_REACTION_RX = new RegExp([
  // Funding / launch / partnership / release language
  '\\b(announce[ds]?|launch(?:ed|ing)?|raised?|closed\\s+(?:a\\s+)?(?:seed|series\\s+[a-d]|round)|acquir(?:ed|ing)|debut(?:ed)?|unveil(?:ed)?|shipp?(?:ed|ing)|releas(?:ed|ing)|partner(?:ed|ing)\\s+with|funded?|funding|rolled\\s+out|went\\s+live)\\b',
  // Public statement / opinion signals (someone said / argued / etc.)
  '\\b(says?|said|argues?|argued|claims?|claimed|posts?|posted|tweets?|tweeted|writes?|wrote|believes?|believed|warns?|warned|predicts?|predicted|reveals?|revealed|reports?|reported|states?|stated|comments?|commented|responds?|responded|admits?|admitted|confirms?|confirmed|denies|denied)\\b',
  // Explicit reaction-prompt language the user typed
  '\\b(react(?:ing)?\\s+to|reaction\\s+to|thoughts?\\s+on|take\\s+on|comment\\s+on|riff\\s+on|respond(?:ing)?\\s+to|hot\\s+take\\s+on)\\b',
].join('|'), 'i');

export function looksLikeNewsReaction(text: string | null | undefined): boolean {
  if (!text) return false;
  return NEWS_REACTION_RX.test(text);
}

// Short-text quality bans, for prompts that produce 1-2 sentence user-facing
// text (suggested angles, trend headlines, idea descriptions, rule bodies). The
// full buildCraftRules block is shaped for posts (hook/closer/rhythm); for
// short text we just need the phrase-level bans so the metadata feels like
// it came from a writer, not a deck. Inject into ANY prompt whose output
// appears in the UI but isn't a full post.
export const SHORT_TEXT_BANS = `## Writing bans — apply to this output even though it is short text
- No em dashes (—). Use commas, periods, or restructure.
- No "reportedly", "according to reports", "per the announcement", "the company stated" — state the fact directly or drop it.
- No corporate-analyst phrasings: "represents a significant", "remains limited / real / relevant", "as X transitions from Y to Z", "establish habits", "operate more efficiently", "significant workflow change", "connective tissue", "absorb that capability", "scrambling to retrofit", "stitching pieces together", "is positioning itself as", "is built for general".
- No reframe-family hedges: "X sounds like Y until Z", "X is more important than the word/term Y suggests", "the X framing is more important".
- No filler words: "genuinely", "fundamentally", "essentially", "moreover", "furthermore", "in essence", "crucially", "notably", "arguably".
- No AI lexical tells: delve, tapestry, mosaic, realm, testament to, ever-evolving, meticulous, pivotal, seamless, robust, vibrant, intricate, multifaceted, nuanced, transformative, paradigm, harness, foster, cultivate, leverage (as verb), unlock (as metaphor).
- No vague forward-statements: "teams that adopt X will win", "the future is X", "X will eventually matter", "the ones who systematize today will absorb tomorrow's capability".
- No headline-recap framing: do not paraphrase the source headline as the output. State a specific claim or observation.
- No invented people, friends, customers, time-with-product claims, or unnamed testimonies. Only use names/numbers from the source text.`;
