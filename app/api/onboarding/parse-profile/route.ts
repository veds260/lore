import { NextRequest, NextResponse } from 'next/server';
import { auth } from '@/lib/auth';
import { callAI, parseJSON, MODEL_EXTRACT } from '@/lib/ai';
import { modelAvailable, modelErrorBody } from '@/lib/providers';

export async function POST(req: NextRequest) {
  const session = await auth();
  if (!session?.user?.id) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { markdown } = await req.json().catch(() => ({}));
  if (!markdown || typeof markdown !== 'string') {
    return NextResponse.json({ error: 'No markdown provided' }, { status: 400 });
  }
  if (!(await modelAvailable())) {
    return NextResponse.json({ error: 'No model backend is set up. Open /setup to connect one.' }, { status: 503 });
  }

  const prompt = `You are extracting structured information from a personal bio, resume, LinkedIn export, or portfolio document to pre-fill an onboarding form for a content creation tool called Lore.

Read the document carefully and extract as much as you can. Return ONLY a valid JSON object with these fields. Use null for anything you cannot confidently extract — never fabricate.

FIELDS TO EXTRACT:

Basic info:
- name: Their name or brand name (string | null)
- twitterHandle: Twitter/X handle without @ (string | null)
- linkedinHandle: LinkedIn slug/username without the URL prefix (string | null)

Voice & positioning:
- whatYouDo: What they do and who they help, in plain conversational language — synthesize from the doc, 1-3 sentences, no jargon (string | null)
- recentWin: A specific concrete achievement or result from the doc — something with a number, client outcome, or measurable impact. 2-4 sentences. (string | null)
- strongBelief: The most opinionated, specific contrarian take they hold about their field that you can infer from the document. Make it sharp. (string | null)

Deeper context (use these to enrich the brand's writing system):
- expertise: Array of 3-6 specific topics they know deeply, based on what they write/talk about (string[] | null)
- audience: Who they write for — be specific (e.g. "early-stage B2B SaaS founders", not just "founders") (string | null)
- positioning: What makes their approach different or their unique angle — a contrarian point of view on their field, or how they do things differently (string | null)
- credibilityMarkers: Array of 2-4 key facts that establish their authority — years of experience, notable clients, measurable outcomes, credentials (string[] | null)
- writingTone: Array of 3-5 adjectives that describe their writing style as you'd observe it in this document (string[] | null)
- contentThemes: Recurring topics or angles they keep returning to — what are the underlying threads? (string[] | null)
- backgroundSummary: 2-3 sentence summary of their professional journey and what shaped them (string | null)

Quality signal:
- missingFields: Array of field names from [name, whatYouDo, audience, recentWin, strongBelief] that you could NOT extract and are important (string[])
- confidence: How complete the profile is overall — "high", "medium", or "low" (string)

Document:
---
${markdown.slice(0, 12000)}
---

Return only the JSON object. No markdown fences, no explanation.`;

  try {
    const text = await callAI({ model: MODEL_EXTRACT, prompt, temperature: 0.2, maxTokens: 1500 });
    const parsed = parseJSON(text);
    if (!parsed) return NextResponse.json({ error: 'Failed to parse model response' }, { status: 500 });
    return NextResponse.json(parsed);
  } catch (err) {
    const { status, body } = modelErrorBody(err);
    return NextResponse.json(body, { status });
  }
}
