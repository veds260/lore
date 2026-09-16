export type EditPlatform = 'twitter' | 'linkedin' | 'both' | string;

export interface EditPreferenceInput {
  original?: string | null;
  revised?: string | null;
  instruction?: string | null;
  platform?: EditPlatform | null;
}

export interface LearningSuggestion {
  title: string;
  observation: string;
  reason: string;
  confidence: number;
  tags: string[];
  platform: string;
}

function words(text: string): string[] {
  return text.trim().split(/\s+/).filter(Boolean);
}

function normalized(text: string): string {
  return text.toLowerCase().replace(/\s+/g, ' ').trim();
}

function emojiCount(text: string): number {
  return (text.match(/[\p{Emoji_Presentation}\p{Extended_Pictographic}]/gu) ?? []).length;
}

function hypeCount(text: string): number {
  const matches = text.match(/\b(insane|crazy|massive|game[- ]?changing|revolutionary|unlock|skyrocket|dominate|crush|secret|ultimate)\b/gi);
  return matches?.length ?? 0;
}

function numberCount(text: string): number {
  return (text.match(/\b\d+(?:[.,]\d+)?%?\b/g) ?? []).length;
}

function ctaCount(text: string): number {
  return (text.match(/\b(follow|subscribe|dm me|book a call|comment|share|like|reply|click|sign up)\b/gi) ?? []).length;
}

function sentenceCount(text: string): number {
  return (text.match(/[.!?](?:\s|$)/g) ?? []).length;
}

function lineCount(text: string): number {
  return text.split('\n').filter(l => l.trim()).length;
}

function buildSuggestion(input: EditPreferenceInput, kind: string, title: string, body: string, confidence = 0.74): LearningSuggestion {
  const platform = input.platform && typeof input.platform === 'string' ? input.platform : 'post';
  const instruction = input.instruction?.trim();
  const observation = [
    `Preference: ${body}`,
    instruction ? `User edit instruction: ${instruction}` : null,
    `Apply when writing ${platform} drafts unless a newer tenant rule conflicts.`,
  ].filter(Boolean).join('\n');

  return {
    title,
    observation,
    reason: kind,
    confidence,
    tags: ['edit-feedback', kind, platform].filter(Boolean),
    platform,
  };
}

export function detectEditPreference(input: EditPreferenceInput): LearningSuggestion | null {
  const original = input.original?.trim() ?? '';
  const revised = input.revised?.trim() ?? '';
  const instruction = input.instruction?.trim().toLowerCase() ?? '';
  if (!original || !revised) return null;
  if (normalized(original) === normalized(revised)) return null;

  const originalWords = words(original).length;
  const revisedWords = words(revised).length;
  const deltaRatio = originalWords > 0 ? (originalWords - revisedWords) / originalWords : 0;
  const tooSmall = Math.abs(original.length - revised.length) < 12 && instruction.length < 8;
  if (tooSmall) return null;

  if (instruction.match(/shorter|tighter|concise|trim|cut|less wordy/) || deltaRatio >= 0.2) {
    return buildSuggestion(input, 'concise', 'Prefers tighter drafts', 'Make drafts tighter and remove extra setup before the point.', 0.82);
  }

  if (instruction.match(/less hype|less salesy|tone down|calmer|more grounded/) || hypeCount(original) > hypeCount(revised)) {
    return buildSuggestion(input, 'grounded-tone', 'Prefers grounded wording', 'Avoid hype-heavy phrasing. Use grounded, specific language over salesy claims.', 0.8);
  }

  if (instruction.match(/specific|concrete|numbers|example|proof|detail/) || numberCount(revised) > numberCount(original)) {
    return buildSuggestion(input, 'concrete-proof', 'Prefers concrete proof', 'Use concrete examples, numbers, proof points, or named details when the draft feels abstract.', 0.78);
  }

  if (instruction.match(/no emoji|remove emoji|without emoji/) || emojiCount(original) > emojiCount(revised)) {
    return buildSuggestion(input, 'no-emoji', 'Avoids emoji in drafts', 'Do not use emoji unless explicitly requested.', 0.86);
  }

  if (instruction.match(/direct|blunt|clearer|less fluffy|straight/) || (revisedWords < originalWords && sentenceCount(revised) <= sentenceCount(original))) {
    return buildSuggestion(input, 'directness', 'Prefers direct phrasing', 'Lead with the point and avoid fluffy setup.', 0.72);
  }

  if (instruction.match(/structure|format|line break|scan|readable/) || Math.abs(lineCount(revised) - lineCount(original)) >= 2) {
    return buildSuggestion(input, 'structure', 'Prefers scannable structure', 'Use line breaks and structure deliberately so the post is easier to scan.', 0.72);
  }

  if (instruction.match(/no cta|remove cta|less pushy|soft cta/) || ctaCount(original) > ctaCount(revised)) {
    return buildSuggestion(input, 'soft-cta', 'Prefers softer CTAs', 'Avoid pushy CTAs. End with the idea when that is stronger than asking for engagement.', 0.76);
  }

  return null;
}
