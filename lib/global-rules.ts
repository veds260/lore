export interface GlobalRule {
  id: string;
  name: string;
  body: string;
}

export const GLOBAL_RULES: GlobalRule[] = [
  // ── Structure / pattern bans ─────────────────────────────────────────────────
  {
    id: 'g1',
    name: 'No em dashes',
    body: 'Never use em dashes (—) in any context. Use a comma, period, or restructure the sentence instead.',
  },
  {
    id: 'g2',
    name: 'No opening question',
    body: 'Never open a post with any question — rhetorical or otherwise. Open with a direct statement, a specific number, or a concrete observation.',
  },
  {
    id: 'g3',
    name: 'No staccato or parallel fragment lists',
    body: 'Avoid stacking multiple short sentences in a row that end with full stops, especially when they share the same structure ("Same mindset. Same result. Same loop." / "No plan. No team. No shot." / "Not this. Not that. Not ever."). This reads as choppy AI filler. Vary sentence length and rhythm instead.',
  },
  {
    id: 'g4',
    name: 'No "isn\'t X / is Y" substitution framing',
    body: 'Never use substitution framing in any form. This covers identity framing ("It\'s not X. It\'s Y." / "This isn\'t X. This is Y." / "It isn\'t about X. It\'s more about Y." / "Not X. Y.") AND the verb-state variant where a negated verb is immediately reversed ("The gap isn\'t closing. It\'s accelerating." / "They aren\'t slowing down. They\'re speeding up." / "X isn\'t [verb-ing]. It\'s [verb-ing].") AND the inline appositive correction where a clause ends in ", not Y" ("built on broadcast, not relationship." / "it\'s about the work, not the title." / "a marathon, not a sprint."). These are all the same tired correction pattern — state the real point directly without the negate-then-reverse wrapper.',
  },
  {
    id: 'g5',
    name: 'No "not just X, but Y"',
    body: 'Never use the "not just X, but Y" construction. It signals filler and reads as inflated.',
  },
  {
    id: 'g6',
    name: 'No "Not because X — but because Y"',
    body: 'Never write sentences structured as "Not because [reason A] — but because [reason B]." This is a recognizable AI writing pattern. State the real reason directly instead.',
  },
  {
    id: 'g7',
    name: 'No "the ones... the ones" contrast',
    body: 'Never use repeated "the ones" as a rhetorical contrast device. Example of what to avoid: "They\'re not the ones hiring friends. They\'re the ones hiring people who..." Find a more direct way to make the contrast.',
  },
  {
    id: 'g8',
    name: 'No consecutive parallel lines starting with the same word',
    body: 'Never write 3 or more consecutive lines that start with the same word (except "I" in a genuine narrative). Patterns like "They do X. They do Y. They do Z." or "You need A. You need B. You need C." are banned.',
  },
  // ── Opener bans ──────────────────────────────────────────────────────────────
  {
    id: 'g9',
    name: 'No "in today\'s world" openers',
    body: 'Never open with or use "in today\'s world / landscape / market / economy / era / age." It is empty framing.',
  },
  {
    id: 'g10',
    name: 'No news-brief openers',
    body: 'Never open with "Just launched / just announced / breaking: / news: / update: / announcement:" These belong in press releases, not posts.',
  },
  {
    id: 'g11',
    name: 'No permission-asking intros',
    body: 'Never open with "Let me tell you / I want to share / Can I share something / Let me break it down / Here\'s what most people miss." These are filler. Get straight to the point.',
  },
  {
    id: 'g12',
    name: 'No humble brag openers',
    body: 'Never use "Humbled to announce / So grateful to have / Excited to share / Thrilled to be." These are performative and undermine credibility.',
  },
  // ── Language bans ────────────────────────────────────────────────────────────
  {
    id: 'g13',
    name: 'No generic motivational phrases',
    body: 'Skip phrases circulated to meaninglessness: "believe in yourself / success will follow / you got this / dream big / hustle harder / your network is your net worth." If it could appear on a stock-photo LinkedIn poster, rewrite it.',
  },
  {
    id: 'g14',
    name: 'No easy-promise language',
    body: 'Never use "one simple trick / effortlessly / hack your way / in just 5 minutes / you won\'t believe." These signal low-quality content.',
  },
  {
    id: 'g15',
    name: 'No corporate jargon',
    body: 'Avoid hollow corporate language: "leverage / synergize / utilize (use instead) / navigate (as a metaphor) / delve / craft (when you mean make) / pivot / ecosystem / scalable / impactful." Use plain words.',
  },
  {
    id: 'g16',
    name: 'No overused AI transition phrases',
    body: 'Never use these filler transitions: "Here\'s the thing: / Here\'s the kicker: / Here\'s the reality: / Here\'s what most people don\'t realize: / Let me break this down: / The tell is always / Full stop. / Period. / And that\'s exactly why / Plot twist:" These are recognizable AI writing patterns. Make the point directly without announcing it.',
  },
  {
    id: 'g17',
    name: 'No validation stamps',
    body: 'Never instruct the reader to re-read or save the post: "Read that again. / Bookmark this. / Save this. / Screenshot this." It is condescending and performative.',
  },
  {
    id: 'g18',
    name: 'No "people think X but they\'re wrong" framing',
    body: 'Avoid "People think X. But they\'re wrong." / "Some people X, others Y." These are overused debate-frame patterns. Make the argument directly instead.',
  },
  {
    id: 'g19',
    name: 'No "at the end of the day"',
    body: 'Never use "at the end of the day." It is empty and clichéd.',
  },
  // ── Formatting bans ──────────────────────────────────────────────────────────
  {
    id: 'g20',
    name: 'No hashtags',
    body: 'Never include hashtags in any post — Twitter or LinkedIn. No exceptions.',
  },
  {
    id: 'g21',
    name: 'No engagement bait',
    body: 'Never use engagement bait: "Drop a 🔥 if / Comment below if / Like if you agree / Follow for more / Tag someone who needs this." Let the content earn engagement on its own.',
  },
  {
    id: 'g22',
    name: 'No emoji clusters',
    body: 'Never use 3 or more emojis in sequence or as decoration. Single purposeful emoji is acceptable only if the brand voice uses them.',
  },
  {
    id: 'g23',
    name: 'No rhetorical setup-and-knockdown',
    body: 'Never build a hypothetical scenario just to knock it down ("You might think X. You\'d be wrong." / "Most people believe X. But here\'s what actually happens."). This is a rhetorical trick that reads as condescending. State the real argument directly.',
  },
  {
    id: 'g24',
    name: 'No neatly balanced comparisons',
    body: 'Never write sentences that package both sides of a comparison in tidy parallel form: "X is great at A but terrible at B." / "Some founders do X, others do Y." These feel artificially constructed. Make a specific point instead of staging a fake balance.',
  },
  {
    id: 'g25',
    name: 'No grand pattern announcements',
    body: 'Never announce that a pattern exists before stating it: "The pattern is always the same." / "They all had one thing in common." / "Every time, without exception." / "There\'s a common thread here." Just state the insight — don\'t announce that you\'re about to state it.',
  },
  {
    id: 'g26',
    name: 'No forced CTAs',
    body: 'Never end a post with a forced call to action: "What do you think? / Share this if you agree / Drop your thoughts below / Let me know in the comments / Follow for more." The content earns engagement on its own merits.',
  },
  {
    id: 'g27',
    name: 'No hallucinated number 47',
    body: 'Never use the number 47 (as in "47 seconds", "47 people", "47%", etc.) unless it was explicitly stated by the client in their interview answers or appears in their own published posts. 47 is a known AI hallucination tell — it sounds specific but is fabricated. Use numbers that are actually grounded in the content.',
  },
  // ── 2026 expansion: corporate-philosopher buzzwords ──────────────────────
  {
    id: 'g28',
    name: 'No ghostwriter buzzwords',
    body: 'Never use: compound, compounding, distribution beats production, asymmetric upside, leverage (as a noun), moat, alpha (as in "real alpha"), signal vs noise, first principles, second-order, north star, force multiplier, high-agency, skin in the game, chop wood carry water, "the game is X", "the meta is X", "play long-term games". These are Twitter-ghostwriter cliches — say the actual specific thing instead.',
  },
  {
    id: 'g29',
    name: 'No classic AI lexical tells',
    body: 'Never use: delve, delves, delving, tapestry, mosaic, realm, landscape (as a metaphor), testament to, ever-evolving, ever-changing, ever-shifting, treasure trove, embark, meticulous, meticulously, pivotal, seamless, seamlessly, streamline, robust, vibrant, intricate, multifaceted, nuanced, comprehensive, showcasing, underscores, unleash, unlock (as metaphor), harness, foster, cultivate, transformative, paradigm. Use plain concrete words.',
  },
  {
    id: 'g30',
    name: 'No filler connectors',
    body: 'Never use: moreover, furthermore, in essence, essentially, fundamentally, ultimately (as sentence opener), in conclusion, in summary, it is important to note, it\'s worth noting, that being said, with that said, crucially, notably, arguably. Cut them — the next sentence carries itself.',
  },
  {
    id: 'g31',
    name: 'No reveal/truth openers',
    body: 'Never open or pivot with: "the truth is", "the reality is", "the secret is", "the real reason", "here\'s the truth", "here\'s the secret", "what nobody tells you", "what they won\'t tell you", "the brutal truth", "hard truth". State the thing without announcing that it\'s the truth.',
  },
  {
    id: 'g32',
    name: 'No "X beats Y" buzzword framing',
    body: 'Never write "distribution beats production / consistency beats talent / speed beats perfection / attention beats reach / trust beats tactics". This is recognizable ghostwriter slop. Make the specific argument instead.',
  },
  {
    id: 'g33',
    name: 'No "didn\'t X. they Y." pattern',
    body: 'Never write the lowercase-fragment AI tell "didn\'t [verb]. they [verb]." Example to avoid: "they didn\'t pick the right one. they built something real." Combine into one sentence or restructure.',
  },
  {
    id: 'g34',
    name: 'No listicle hook openers',
    body: 'Never open with "unpopular opinion:", "hot take:", "nobody\'s talking about", "people sleep on", "they don\'t teach you", "controversial take:", "the 1% do this". These are recycled hook templates.',
  },
  {
    id: 'g35',
    name: 'No fake-precision unsourced numbers',
    body: 'Never use round-feeling specific numbers (3.7x, 7x, 10x, 87%, 73%, 80/20, 99%, "2x your X", "10x your X") unless grounded in a client-supplied source. If unsourced, drop the number or say "roughly".',
  },
  {
    id: 'g36',
    name: 'No "the X, the Y, the Z" triplet lists',
    body: 'Never use the three-item comma list of "the [noun], the [noun], the [noun]" (e.g. "the writer, the editor, the reviewer" / "the hook, the body, the close"). It is a recognizable AI rhythm that signals filler. Rewrite as a single named subject, or expand each item with what it actually does.',
  },
  // ── 2026 expansion (May): voice + hallucination + structure hardening ─────
  {
    id: 'g37',
    name: 'No fabricated personal experience',
    body: 'Never invent personal experience with the subject. Banned: claims like "a friend has been using it for six weeks", "I watched a team ship X with it", "someone I know in [niche] uses it", "I spent the morning running it", any unnamed friend/colleague/client testimony, any specific time-with-product claim. If you do not have verifiable first-person experience, write from public observation and analysis. Cite only named people or facts that appear in the topic input. Hedges like "reportedly" or "according to reports" are also banned because they signal you are laundering an unsourced claim.',
  },
  {
    id: 'g38',
    name: 'No news-channel voice',
    body: 'Never recap or paraphrase the news headline. Assume the reader already saw it. Skip "X announced Y yesterday / closed a $30M Series A / launched Z" as the opening line — that is a news brief, not a POV. Open with the strongest specific claim you have about what the news actually means. Banned words/frames inside news reactions: "reportedly", "according to reports", "per the announcement", "the company stated", "in a statement", "the platform reportedly does X". State what you think, in your own voice.',
  },
  {
    id: 'g39',
    name: 'No niche stamping',
    body: 'Never name the brand niche more than once in the body of a post. Banned: opening with one niche mention, then saying "Web3 teams" / "AI founders" / "DePIN operators" / "[niche] teams" two or three more times in the body. If the niche has been named once, the rest of the post talks about the IDEA without re-stamping. The post is about the insight, not a niche-tag bingo card.',
  },
  {
    id: 'g40',
    name: 'Hook must not recap the headline',
    body: 'The hook is written LAST, after you know the strongest specific claim in the body. The hook is the line a reader sees first; it must create curiosity for someone who has not seen the headline AND for someone outside the brand niche. Banned hook shapes: "X just launched Y" / "X closed a Series A" / "X announced Z yesterday" as the bare opening line. If you must reference the news, tease the strongest specific claim in your post first, then earn the context.',
  },
  {
    id: 'g41',
    name: 'Closer rule — universal or founder-authority, never insider-tactical',
    body: 'Every post must close with ONE of: (a) a universal takeaway someone outside the brand niche can apply, OR (b) a high-level operator/founder observation that demonstrates deep expertise in the brand niche (only allowed when the brand is a founder/operator in that niche). Banned closes: "teams that do X will adapt", "the future is X", "the ones who systematize today win tomorrow", any vague forward-statement that nobody could disagree with. Banned: closes that only insiders in the brand niche care about (e.g. "better onboarding will eventually matter") unless they sharpen founder authority.',
  },
  {
    id: 'g42',
    name: 'Vary paragraph weight and rhythm',
    body: 'A post where every paragraph carries the same density and length reads as analytical drone. Vary it: at least ONE short rhythm-break line (1 sentence, under 14 words) per long-form post. No more than two consecutive paragraphs of 4+ sentences. If using numbered points, do not make all three blocks the same length — let one be tighter than the others. Spacious blank-line separation between every beat (LinkedIn density).',
  },
  {
    id: 'g43',
    name: 'No "X is more important than the word/term Y suggests" hedge',
    body: 'Never write "the X framing is more important than the word \'X\' suggests", "this is more important than the term suggests", "the agentic OS framing is more important than the word agentic suggests". This is a recognizable AI hedge that distances from a claim while making it. Make the specific claim directly.',
  },
  {
    id: 'g44',
    name: 'No "X sounds like Y until Z" reframe',
    body: 'Never write "that number sounds like marketing until you see it", "the claim sounds like hype until you watch the demo", "the line sounds X until Y". Same DNA as the banned "It\'s not X. It\'s Y." substitution — a fake reframe that pretends to deliver an insight by knocking down a strawman. State the actual point without the reframe wrapper.',
  },
  {
    id: 'g45',
    name: 'No extended consultant phrasings',
    body: 'Banned: "connective tissue between [strategy and execution / X and Y]", "absorb that capability / absorb the X", "scrambling to retrofit", "stitching [these pieces / those tools] together", "is positioning itself as [a / the X]", "is built for general [marketers / users / teams]", "the demo shows nothing specific to", "genuinely useful / genuinely important / genuinely valuable / genuinely [adjective]" (drop "genuinely" — it adds nothing). These are analyst-deck phrasings, not operator voice. Cut or rewrite into concrete specifics.',
  },
  {
    id: 'g46',
    name: 'No template-tell openers',
    body: 'Avoid "Three things stand out:" / "Here\'s what stood out:" / "A few things worth noting:" UNLESS the post genuinely has three (or more) distinct, separately-substantive angles. If two of your three numbered points say roughly the same thing, collapse to a single sharp take with a setup, two paragraphs of proof, a punchline, and a close — not three forced numbered blocks.',
  },
  {
    id: 'g47',
    name: 'No tidy aphoristic closer',
    body: 'Do not end on a neat, quotable maxim that resolves the whole post into a life lesson — the classic AI "wise closer". Banned closer shapes: "never the other way around", "X has an expiration date, Y doesn\'t" / "the X doesn\'t" / "the Y does", "rebuild X and you can rebuild anything", "that\'s the difference", "and that\'s the whole point", "the rest takes care of itself". End on something concrete and specific instead — a real example, a number, a blunt aside — or just stop. A post does not need a bow on top.',
  },
  {
    id: 'g48',
    name: 'Vary cadence — not every line a full stop',
    body: 'Do not stack several short-to-medium declarative sentences that each end in a period; it reads as AI cadence even when the words are fine. Let related thoughts run together with commas the way people actually talk, and vary sentence length (some long and flowing, some short). Not every beat needs to be its own full-stopped sentence.',
  },
  // ── 2026 expansion (Jun 27): softer strategist tells + human texture ─────
  {
    id: 'g49',
    name: 'No falsely-inflated / over-definitive statements',
    body: 'Never make a line sound more dramatic, grand, or certain than it is. Banned shapes: "that is the whole game in one", "this is the whole engine for X", "the system eliminates the noise completely", "this is the entire point of X", any over-certain summary that crowns its own importance. A person says "that\'s the main takeaway" or "that\'s why it works better", not a grand over-confident verdict. Flatten the claim to how someone would actually say it out loud.',
  },
  {
    id: 'g50',
    name: 'No colon-zinger summaries',
    body: 'Never compress a point into a formatted punchline after a colon: "lots of hype, lots of screenshots, zero honesty", "the big change is quiet but huge: learning stops disappearing after the tab closes". The colon-plus-neat-payoff is an engineered, screenshot-shaped line. State the thing in a normal sentence instead.',
  },
  {
    id: 'g51',
    name: 'No over-clean explanatory cadence (section-headers pretending to be insight)',
    body: 'Never use polished connective lines that organise the thought instead of advancing it: "The problem starts earlier.", "That is where X matters.", "This is what changes.", "The gap is becoming impossible to ignore.", "Here is where it gets interesting." If a line mostly structures or signposts the thought rather than adding a new specific fact, cut it and let the next concrete sentence carry the weight.',
  },
  {
    id: 'g52',
    name: 'No manufactured / formulaic flat contrarian',
    body: 'A single contrarian line is allowed only with earned, specific context behind it. Never manufacture a reversal just to give a post an edge. Banned formulaic shapes (these are the banned flip in disguise): "X still matters. It just stopped being enough.", "AI didn\'t break Y. It exposed what was already broken.", "The future of X is not A. It is B." If the reversal is not backed by a real observation or number, drop it.',
  },
  {
    id: 'g53',
    name: 'No constructed comparison disguising a "not X but Y"',
    body: 'Beyond the plain substitution ban (g4): never build a two-part comparison that smuggles in the same negate-then-reverse move under different wording. Example to avoid: "The old system was built for signals. The new one needs evidence." It is staccato plus a constructed comparison wearing a costume. Make the single real point directly.',
  },
  {
    id: 'g54',
    name: 'Keep human filler — perfectly efficient is a tell',
    body: 'Do NOT strip every sentence down to maximum efficiency. LLMs delete small spoken words to sound grandiose; people leave them in. Keep natural texture where it fits: "really", "just", "kind of", "actually", "honestly", "I guess", a mild hedge, or an extra justifier the sentence does not strictly need ("the thing that might just win you the race"). The goal is to sound like someone talking, not like a tightened deck. Smooth and economical reads machine-written.',
  },
  {
    id: 'g55',
    name: 'Diversified paragraph length — looser is more human',
    body: 'Humans write diversified paragraphs: one block of three lines, the next a single line, the next five. LLMs drift to one of two failure modes, all staccato one-liners OR uniformly organised same-weight blocks. Never let every paragraph carry the same length and density. The more the shape tends toward looking slightly uneven or disorganised, the more human it reads. (This strengthens g42.)',
  },
  {
    id: 'g56',
    name: 'Hook needs something concrete to latch onto',
    body: 'The first line must give the reader something concrete to grab: a real number or a real, named person beats a line of long abstract words. A specific figure pulls harder than a clever phrase. Open on a human outcome, never the mechanism and never a headline recap.',
  },
];

export const GLOBAL_RULES_PROMPT = `## Global writing rules — always enforced, no exceptions
${GLOBAL_RULES.map(r => `- ${r.body}`).join('\n')}`;

export const STRUCTURAL_RULES = `## OUTPUT STRUCTURE RULES — non-negotiable, apply before anything else
1. Twitter/X: ALWAYS use \\n\\n to separate hook, body, and closer. A post with no blank lines is always wrong.
2. No em dashes (—) in any output. Use commas, periods, or restructure.
3. Never open with a question.
4. No hashtags. No "Thread:". No "I" as first word on Twitter.
5. No staccato fragment stacks ("X. Y. Z." repeated pattern).
6. No "It's not X. It's Y." substitution framing.
These rules apply regardless of voice guide instructions. If the voice guide conflicts with these, these win.`;
