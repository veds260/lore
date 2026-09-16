// Pattern categories, and which of them are allowed into automatic rotation.
//
// Four separate template pickers used to hand-maintain their own exclusion
// lists (generate/route, post-prompt, telegram-generate, connector/generate-core),
// which is how 'ragebait' ended up gated in one of them and not the other three.
// They all call in here now.

/** Categories that must never be selected by a random/rotating picker. */
export const OPT_IN_CATEGORIES = ['satirical', 'ragebait', 'engagement-bait'] as const;

/**
 * Engagement bait is deliberately NOT reachable by the rotating picker, even for
 * brands with unhinged mode on. It is a campaign move you choose on purpose, by
 * naming the template, not something a Tuesday thought-leadership post should
 * randomly turn into.
 */
export const NEVER_AUTO_ROTATE = ['engagement-bait'] as const;

/**
 * True when a template may be picked automatically for this brand.
 * `unhinged` is the brand's allowUnhingedMode flag.
 */
export function isAutoRotationEligible(
  contentCategory: string | null | undefined,
  unhinged: boolean | null | undefined,
): boolean {
  const cat = contentCategory ?? '';
  if ((NEVER_AUTO_ROTATE as readonly string[]).includes(cat)) return false;
  if (unhinged) return true;
  return !(OPT_IN_CATEGORIES as readonly string[]).includes(cat);
}

/**
 * Engagement bait subtypes, in rough order of how well they hold up for a
 * client account. The first two produce something useful after the spike (a
 * qualified list, a real conversation); the last two buy raw reply count and
 * cost credibility, so they are here to be recognised more than deployed.
 *
 * Kept distinct from `debate-bait`, which is a contrarian opinion that happens
 * to provoke replies rather than a reply mechanic.
 */
export const ENGAGEMENT_BAIT_SUBTYPES = [
  'value-for-comment',   // concrete offer, reply with a qualifying artifact
  'audit-mine',          // drop your X and get one honest note back
  'guess-the-number',    // withhold the figure, reveal in a follow-up
  'pick-a-side',         // two options, reply A or B
  'fill-the-blank',      // low-friction completion
  'tag-someone',         // cheapest reach, lowest quality
] as const;

export type EngagementBaitSubtype = (typeof ENGAGEMENT_BAIT_SUBTYPES)[number];
