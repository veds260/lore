// Pure regex layer that runs BEFORE the LLM rewriter. Two tiers:
//   Tier 1: hard ban (auto-rewrite via rules-fixer)
//   Tier 2: soft warn (deduct from authenticity score, surface in UI but don't auto-rewrite)
//
// Carve-outs:
// - "compound interest" / "compound labs" / "compound finance": finance terms allowed
// - "leverage" as verb in finance context: allowed (verb-form context-dependent)

export interface PatternHit {
  id: string;
  tier: 1 | 2;
  match: string;
  index: number;
  hint: string;
}

const HARD_PATTERNS: Array<{ id: string; rx: RegExp; hint: string }> = [
  // Punctuation
  { id: 'em-dash', rx: /[—–](?!\d)/g, hint: 'em/en dash' },

  // AI-tell sentence patterns
  { id: 'isnt-x-its-y', rx: /\b(it|this|that)['']s\s+not\s+[^.!?\n]{2,40}[.!?]\s+(it|this|that)['']s\s+/gi, hint: '"isn\'t X. It\'s Y." substitution' },
  // Negated-verb reversal: "The gap isn't closing. It's accelerating." / "They aren't slowing. They're speeding up."
  // / "he isn't running better tactics. he's running a better mindset." / "the ones who win aren't smarter. they just..."
  { id: 'negverb-reversal', rx: /\b(isn['']?t|aren['']?t|wasn['']?t|weren['']?t|don['']?t|doesn['']?t)\s+[^.!?\n]{2,40}[.!?]\s+(it|they|that|this|he|she|we|i)['']?(s|re|m|ve)?\s+/gi, hint: '"X isn\'t A. [pronoun] B." negated-verb reversal / negate-then-assert — same DNA as "isn\'t X. It\'s Y."' },
  { id: 'not-x-y-frag', rx: /^\s*not\s+[a-z][^.!?\n]{1,30}[.!?]\s+[A-Z]/gm, hint: '"Not X. Y." fragment' },
  { id: 'didnt-they', rx: /\b(didn['']t|did not)\s+[^.!?\n]{2,40}[.!?]\s+(they|he|she|we|i)\s+/gi, hint: '"didn\'t X. they Y." pattern' },
  // Appositive substitution correction: "built on broadcast, not relationship." / "it's about the work, not the title." / "a marathon, not a sprint."
  // Same DNA as "isn't X. It's Y." but inline. Only fires when the ", not …" tail ENDS the sentence and isn't a subordinate clause (not because/just/to/when…).
  { id: 'comma-not-correction', rx: /,\s+not\s+(?!only\b|just\b|merely\b|simply\b|because\b|since\b|when\b|if\b|while\b|unless\b|to\s|that\b|knowing\b|sure\b|yet\b|even\b|necessarily\b|always\b|really\b|quite\b|in\b|on\b|at\b|for\b|by\b|out\b)(?:a|an|the|your|their|his|her|its|my|our)?\s*[a-z][\w''-]+(?:\s+[\w''-]+){0,1}\s*[.!?]/gi, hint: '"X, not Y." appositive correction — same DNA as "isn\'t X. It\'s Y.", state the point directly' },
  // Tidy reversal closer: "the external work catches up to the internal. never the other way around."
  { id: 'reversal-closer', rx: /\b(never|not|rarely|seldom)\s+the\s+(other\s+way\s*(a?round)?|reverse|opposite|inverse)\b/gi, hint: '"never the other way around" tidy reversal closer — end on something concrete instead' },

  // Subject-shift substitution. Generalises beyond pronoun form. Allows the optional
  // contraction (They're / It's / They've) between subject pronoun and the negation.
  // Catches: "The tools are good at information. They're not good at presence."
  //          "X works for me. It doesn't work for them."
  //          "The system handles X well. It struggles with Y."
  { id: 'subj-shift-contrast', rx: /\b(is|are|works|handles|does|gets|gives|brings|delivers|provides|offers)\s+[^.!?\n]{2,40}[.!?]\s+(it|they|that|this)['']?(re|ve|s|d)?\s+(not|isn['']?t|aren['']?t|doesn['']?t|don['']?t|won['']?t|wouldn['']?t|fails?|struggles?|can['']?t)\s+/gi, hint: 'subject-shift substitution ("X is good at A. They\'re not good at B.")' },

  // "No X. No Y." or "No X. No Y. No Z." fragment stacks, including the "Just Z" tail variant
  // ("No deck. No pitch. Just a client venting...")
  { id: 'no-x-no-y', rx: /(?:^|[.!?]\s+)No\s+[^.!?\n]{1,25}[.!?]\s+No\s+[^.!?\n]{1,25}[.!?]/gm, hint: '"No X. No Y." fragment stack' },

  // "Same X. Same Y." / "Just X. Just Y." parallel anchor stacks
  { id: 'same-x-same-y', rx: /(?:^|[.!?]\s+)(Same|Just|Only|Always|Every|Still)\s+[^.!?\n]{1,25}[.!?]\s+\1\s+/gim, hint: 'parallel-anchor fragment stack' },

  // "the X, the Y, the Z" three-item comma list, recognizable AI rhythm
  // Catches "the writer, the editor, the reviewer" / "the hook, the body, the close"
  { id: 'the-x-the-y-the-z', rx: /\bthe\s+[a-z]+(?:\s+[a-z]+)?,\s+the\s+[a-z]+(?:\s+[a-z]+)?,\s+(?:and\s+)?the\s+[a-z]+/gi, hint: '"the X, the Y, the Z" triplet list' },

  // Reveal openers
  { id: 'reveal-opener', rx: /(^|[.!?]\s+)(the truth is|the reality is|the secret is|here['']s the truth|here['']s the secret|what nobody tells you|what they won['']t tell you|the brutal truth|hard truth)\b/gim, hint: 'reveal/truth opener' },

  // X-beats-Y buzzword frame
  { id: 'x-beats-y', rx: /\b(distribution|consistency|speed|attention|trust)\s+beats\s+(production|talent|perfection|reach|tactics)\b/gi, hint: '"X beats Y" buzzword frame' },

  // AI lexical tells (single words)
  { id: 'ai-lexical', rx: /\b(delve[sd]?|tapestry|mosaic|realm|testament\s+to|ever-(evolving|changing|shifting)|treasure\s+trove|embark|meticulous(?:ly)?|pivotal|seamless(?:ly)?|streamline[ds]?|robust|vibrant|intricate|multifaceted|nuanced|showcasing|underscores|unleash|harness|foster|cultivate|transformative|paradigm)\b/gi, hint: 'classic AI lexical tell' },

  // Corporate-analyst / consultant-deck phrasings, a different family from "delve/tapestry".
  // Corporate-analyst phrasings.
  { id: 'corp-represents', rx: /\b(represents?\s+(a|an)\s+(significant|major|fundamental|profound|important))\b/gi, hint: '"represents a significant" corporate filler' },
  { id: 'corp-transitions', rx: /\b(as\s+\w+(\s+\w+){0,3}\s+(transitions?|shifts?|evolves?|moves?)\s+from\s+\w+(\s+\w+){0,3}\s+to)\b/gi, hint: '"as X transitions from Y to Z" consultant frame' },
  { id: 'corp-remains-limited', rx: /\b(remains?\s+(limited|difficult|challenging|complex|elusive|unclear|real|relevant|important))\b/gi, hint: '"X remains limited / remains real" passive consultant phrasing' },
  { id: 'corp-establish-habits', rx: /\b(establish(?:ing)?\s+(automation\s+)?habits?\s+early|operate\s+more\s+efficiently|substantial\s+work\s+still\s+requires)\b/gi, hint: 'corporate "establish habits / operate efficiently" filler' },
  { id: 'corp-accelerates', rx: /\b(accelerates?\s+(the\s+)?(building|testing|adoption|deployment|onboarding|growth)\s+(of\s+|process(es)?|workflows?))\b/gi, hint: '"X accelerates the building of Y" consultant phrasing' },
  { id: 'corp-significant-change', rx: /\b((significant|major|profound|fundamental)\s+(workflow|paradigm|operational|behavioral)\s+(change|shift|transformation))\b/gi, hint: '"significant workflow change" consultant phrasing' },

  // Expanded consultant family.
  { id: 'corp-connective-tissue', rx: /\bconnective\s+tissue\b/gi, hint: '"connective tissue" consultant metaphor' },
  { id: 'corp-absorb-capability', rx: /\babsorb\s+(that\s+)?(capability|capabilities|the\s+\w+)\b/gi, hint: '"absorb that capability" consultant phrasing' },
  { id: 'corp-scrambling-retrofit', rx: /\b(scrambl(?:e|ing)\s+to\s+retrofit|scrambling\s+to\s+\w+)\b/gi, hint: '"scrambling to retrofit" consultant phrasing' },
  { id: 'corp-stitching-together', rx: /\b(stitch(?:ing)?\s+(?:these\s+|those\s+|the\s+)?(?:pieces|parts|tools|things|workflows?)\s+together)\b/gi, hint: '"stitching pieces together" consultant phrasing' },
  { id: 'corp-positioning-itself', rx: /\b(is|are)\s+positioning\s+(itself|themselves)\s+as\b/gi, hint: '"is positioning itself as" consultant frame' },
  { id: 'corp-built-for-general', rx: /\b(is\s+built\s+for\s+general|built\s+for\s+(general\s+)?\w+\s+marketers?)\b/gi, hint: '"built for general X" consultant phrasing' },
  { id: 'corp-shows-nothing-specific', rx: /\b(shows?\s+nothing\s+specific\s+to|the\s+demo\s+shows\s+nothing)\b/gi, hint: '"shows nothing specific to" analyst report phrasing' },
  { id: 'genuinely-soft-hedge', rx: /\bgenuinely\s+(useful|important|valuable|interesting|new|different|hard|impressive|good)\b/gi, hint: '"genuinely [adjective]" soft hedge — drop "genuinely"' },

  // Reframe family, same DNA as banned "isn't X. It's Y." substitution.
  { id: 'sounds-like-until', rx: /\b(that\s+)?(number|claim|line|story|stat|figure|framing|word|sentence|paragraph|post|take)\s+sounds\s+like\s+[^.!?\n]{2,40}\s+until\b/gi, hint: '"X sounds like Y until Z" reframe — same DNA as "isn\'t X. It\'s Y."' },
  { id: 'more-important-than-suggests', rx: /\bmore\s+important\s+than\s+(the\s+word\s+["']?[\w-]+["']?\s+|the\s+term\s+|the\s+name\s+|the\s+\w+\s+)?suggests\b/gi, hint: '"X is more important than the word/term suggests" hedge reframe' },
  { id: 'framing-is-more-important', rx: /\bthe\s+\w+\s+framing\s+is\s+(more\s+important|bigger|more\s+significant)/gi, hint: '"the X framing is more important" hedge' },

  // News-channel hedges: source-laundering language that has no place in a POV post.
  { id: 'news-reportedly', rx: /\breportedly\b/gi, hint: '"reportedly" hedge — banned in POV posts, you either know the fact or you don\'t' },
  { id: 'news-according-to-reports', rx: /\b(according\s+to\s+(reports|sources)|per\s+(the\s+)?(announcement|press\s+release|reports))\b/gi, hint: '"according to reports / per the announcement" news-channel hedge' },

  // Filler connectors
  { id: 'filler-connectors', rx: /\b(moreover|furthermore|in\s+essence|essentially|fundamentally)\b/gi, hint: 'filler connector' },

  // "compound" as buzzword (with carve-outs for proper nouns and finance)
  { id: 'compound-buzz', rx: /\bcompound(s|ing|ed)?\b(?!\s+(interest|labs|finance|word))/gi, hint: '"compound" buzzword' },

  // Listicle hook openers
  { id: 'listicle-hook', rx: /^(unpopular opinion|hot take|nobody['']s talking about|controversial take|people sleep on|they don['']t teach you):/gim, hint: 'listicle hook opener' },

  // Ghostwriter buzzwords
  { id: 'ghostwriter-buzz', rx: /\b(asymmetric upside|first principles|second[- ]order|north star|force multiplier|high[- ]agency|skin in the game|signal vs\.? noise|chop wood carry water|moat|alpha)\b/gi, hint: 'ghostwriter buzzword' },
];

const SOFT_PATTERNS: Array<{ id: string; rx: RegExp; hint: string }> = [
  // Fake-precision unsourced numbers
  { id: 'fake-precision', rx: /\b(3\.7x|7x|10x|87%|73%|99%|80\/20|2x your|10x your)\b/gi, hint: 'fake-precision number (unsourced)' },

  // Soft filler connectors
  { id: 'soft-fillers', rx: /\b(crucially|notably|arguably|that being said|with that said|it['']s worth noting|it is important to note)\b/gi, hint: 'soft filler connector' },
];

export function detectPatterns(text: string): PatternHit[] {
  const hits: PatternHit[] = [];
  for (const { id, rx, hint } of HARD_PATTERNS) {
    for (const m of text.matchAll(rx)) {
      hits.push({ id, tier: 1, match: m[0], index: m.index ?? 0, hint });
    }
  }
  for (const { id, rx, hint } of SOFT_PATTERNS) {
    for (const m of text.matchAll(rx)) {
      hits.push({ id, tier: 2, match: m[0], index: m.index ?? 0, hint });
    }
  }
  // Multi-sentence staccato: 3+ short sentences in a row (≤ 6 words each), within
  // a single paragraph. Catches "I listened. Asked a few questions. Let the silence sit."
  hits.push(...detectStaccatoRuns(text));
  return hits;
}

// Detect staccato runs. Two-pass:
//  Tier-A: 3+ consecutive sentences each ≤6 words (typical "X. Y. Z." stack)
//  Tier-B: 2+ consecutive sentences each ≤4 words (the tight "I listened. Asked X." beat)
// Either trips a Tier-1 hit so the rules-fixer runs.
function detectStaccatoRuns(text: string): PatternHit[] {
  const hits: PatternHit[] = [];
  // Bullet lines and headings shouldn't count, only prose paragraphs
  const paragraphs = text.split(/\n\s*\n/);
  let cursor = 0;
  for (const para of paragraphs) {
    const trimmed = para.trim();
    // Skip bullet-style lines so we don't false-positive on listicle posts
    if (/^[-*•\d]/.test(trimmed)) {
      cursor += para.length + 2;
      continue;
    }
    // Split into sentences on . ! ? (preserve original for matching back)
    const sentences = trimmed.split(/(?<=[.!?])\s+/).map(s => s.trim()).filter(Boolean);

    // Pass A: runs of 3+ ≤6-word sentences
    let aStart = -1, aLen = 0;
    for (let i = 0; i < sentences.length; i++) {
      const wc = sentences[i].split(/\s+/).filter(Boolean).length;
      if (wc > 0 && wc <= 6) {
        if (aStart === -1) aStart = i;
        aLen++;
        if (aLen === 3) {
          hits.push({
            id: 'staccato-run-6',
            tier: 1,
            match: sentences.slice(aStart, i + 1).join(' ').slice(0, 120),
            index: cursor,
            hint: '3+ short sentences in a row (≤6 words each) — staccato run',
          });
        }
      } else {
        aStart = -1;
        aLen = 0;
      }
    }

    // Pass B: runs of 2+ ≤4-word sentences (tighter fragment beats)
    let bStart = -1, bLen = 0;
    for (let i = 0; i < sentences.length; i++) {
      const wc = sentences[i].split(/\s+/).filter(Boolean).length;
      if (wc > 0 && wc <= 4) {
        if (bStart === -1) bStart = i;
        bLen++;
        if (bLen === 2) {
          hits.push({
            id: 'staccato-frag-4',
            tier: 1,
            match: sentences.slice(bStart, i + 1).join(' ').slice(0, 120),
            index: cursor,
            hint: '2+ tight fragments in a row (≤4 words each) — staccato beat',
          });
        }
      } else {
        bStart = -1;
        bLen = 0;
      }
    }

    cursor += para.length + 2;
  }
  return hits;
}

// Burstiness: humans vary sentence length, AI is uniform.
// Returns coefficient of variation (std-dev / mean) of sentence word counts.
// <0.3 = robotic uniformity. 0.5+ = healthy variance.
export function burstinessScore(text: string): number {
  const lens = text
    .split(/[.!?]\s+/)
    .map(s => s.trim().split(/\s+/).filter(Boolean).length)
    .filter(n => n > 1);
  if (lens.length < 4) return 1; // not enough sentences to judge
  const mean = lens.reduce((a, b) => a + b, 0) / lens.length;
  if (mean === 0) return 1;
  const variance = lens.reduce((a, b) => a + (b - mean) ** 2, 0) / lens.length;
  return Math.sqrt(variance) / mean;
}

// Format hits for inclusion in the rules-fixer LLM prompt
export function formatHitsForFixer(hits: PatternHit[]): string {
  const tier1 = hits.filter(h => h.tier === 1);
  if (tier1.length === 0) return '';
  const unique = Array.from(new Set(tier1.map(h => `"${h.match}" (${h.hint})`)));
  return `\n## Specific banned strings detected — must be removed or rewritten:\n${unique.map(s => `- ${s}`).join('\n')}`;
}
