import { NextRequest, NextResponse } from 'next/server';
import { auth } from '@/lib/auth';
import { deductCredits } from '@/lib/credits';
import { callAI, MODEL_EXTRACT } from '@/lib/ai';
import { db } from '@/lib/db';
import { visualInspirations } from '@/lib/db/schema';
import { eq, sql } from 'drizzle-orm';

type ImageSize = 'square' | 'landscape' | 'banner';

const SIZE_MAP: Record<ImageSize, { aspect: string; label: string }> = {
  square:    { aspect: '1:1',  label: '1024×1024' },
  landscape: { aspect: '16:9', label: '1920×1080' },
  banner:    { aspect: '2:1',  label: '1200×628'  },
};

const SIZE_COMPOSITION: Record<ImageSize, string> = {
  square:    'Square composition (1:1). Subject centered, equal visual weight on all sides.',
  landscape: 'Wide landscape composition (16:9). Subject spread horizontally across the full width. Strong left-to-right flow.',
  banner:    'Ultra-wide banner composition (2:1). Panoramic. Sparse focal elements, strong horizontal stretch from edge to edge.',
};

function buildImagePromptSystem(styles: { name: string; stylePrompt: string }[], size: ImageSize): string {
  const styleGuide = styles.length > 0
    ? styles.map((s, i) => `### Style ${i + 1}: ${s.name}\n${s.stylePrompt}`).join('\n\n')
    : `### Style 1: Dark Geometric Diagram
When: Any post about systems, comparisons, or data.
Visual: Pure black background. White geometric lines and shapes. Bold caption text bottom-left.
Example prompt: "Pure black background. White geometric lines and shapes. Bold white caption. Editorial. No people."`;

  return `You are a visual content director writing image generation prompts for social media posts.

## Target frame
${SIZE_COMPOSITION[size]}
Your prompt MUST describe a composition designed for this exact frame. Do not describe a subject that would be cropped or leave dead space.

## Visual Style Guide
The following styles are available. Read each one, then pick the single best match for the post's topic and tone.

${styleGuide}

## Your task
1. Read the post carefully
2. Pick the ONE style from the guide that best fits the post's subject and tone — use the "When:" line to decide
3. Write a precise image generation prompt that follows that style's "Visual:" and "Example prompt:" exactly, adapted to the post's specific subject
4. The image subject must be directly relevant to what the post is actually about — not a generic metaphor
5. Close the prompt with: "${SIZE_COMPOSITION[size]}"

## Hard rules (no exceptions)
- NEVER human faces, bodies, hands, or people — use objects, environments, diagrams, or abstract forms instead
- No text, words, logos, or UI elements inside the image
- Do NOT default to glowing networks, space imagery, bokeh, or generic "digital art" looks
- Under 90 words
- Return ONLY the final image generation prompt — no explanation, no preamble`;
}

interface OpenRouterImageChoice {
  message?: {
    images?: { type: string; image_url?: { url?: string } }[];
    content?: string;
  };
}

export async function POST(req: NextRequest) {
  const session = await auth();
  if (!session?.user?.id) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  if (!process.env.OPENROUTER_API_KEY) {
    return NextResponse.json({ error: 'OPENROUTER_API_KEY not set' }, { status: 500 });
  }

  const body = await req.json().catch(() => ({})) as { content?: string; size?: ImageSize };
  if (!body.content?.trim()) {
    return NextResponse.json({ error: 'content is required' }, { status: 400 });
  }

  const size: ImageSize = body.size ?? 'square';

  const userId = session.user.id;

  const { ok, balance, required } = await deductCredits(userId, 'generate_image');
  if (!ok) {
    return NextResponse.json(
      { error: 'Out of credits', balance, required, type: 'insufficient_credits' },
      { status: 402 },
    );
  }

  // Load all active visual styles to build the style guide
  let activeStyles: { name: string; stylePrompt: string }[] = [];
  try {
    activeStyles = await db
      .select({ stylePrompt: visualInspirations.stylePrompt, name: visualInspirations.name })
      .from(visualInspirations)
      .where(eq(visualInspirations.isActive, true))
      .orderBy(sql`RANDOM()`); // shuffle so no style gets consistently picked first
  } catch {
    // non-fatal, proceed with fallback
  }

  const imagePromptSystem = buildImagePromptSystem(activeStyles, size);

  // Step 1: Write image prompt (composition baked in for the chosen frame size)
  let imagePrompt: string;
  try {
    imagePrompt = await callAI({
      model: MODEL_EXTRACT,
      prompt: `${imagePromptSystem}\n\nPost:\n${body.content.trim().slice(0, 1000)}`,
      temperature: 0.9,
      maxTokens: 200,
    });
    imagePrompt = imagePrompt.trim();
  } catch (err) {
    return NextResponse.json({ error: 'Failed to write image prompt', detail: String(err) }, { status: 500 });
  }

  // Step 2: Generate image
  const { aspect } = SIZE_MAP[size];
  let imageUrl: string | null = null;
  try {
    const res = await fetch('https://openrouter.ai/api/v1/chat/completions', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${process.env.OPENROUTER_API_KEY}`,
        'Content-Type': 'application/json',
        'HTTP-Referer': process.env.NEXT_PUBLIC_APP_URL ?? 'https://uselore.io',
        'X-Title': 'Lore',
      },
      body: JSON.stringify({
        model: 'google/gemini-2.5-flash-image',
        modalities: ['image'],
        messages: [{
          role: 'user',
          content: `Aspect ratio ${aspect}. No human faces, people, or figures. ${imagePrompt}`,
        }],
      }),
      signal: AbortSignal.timeout(60_000),
    });

    if (!res.ok) {
      const errText = await res.text().catch(() => '');
      console.error('[generate-image] OpenRouter error:', res.status, errText.slice(0, 300));
      return NextResponse.json({ error: 'Image generation failed', status: res.status }, { status: 502 });
    }

    const data = await res.json() as { choices?: OpenRouterImageChoice[] };
    const images = data.choices?.[0]?.message?.images ?? [];
    const imgItem = images.find(i => i.type === 'image_url');
    imageUrl = imgItem?.image_url?.url ?? null;
  } catch (err) {
    console.error('[generate-image] Generation error:', err instanceof Error ? err.message : err);
    return NextResponse.json({ error: 'Image generation timed out or failed' }, { status: 502 });
  }

  if (!imageUrl) {
    return NextResponse.json({ error: 'No image returned from generation API' }, { status: 502 });
  }

  return NextResponse.json({ imageUrl, prompt: imagePrompt, size });
}
