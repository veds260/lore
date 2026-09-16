import { db } from '@/lib/db';
import { vaultAssets, agentRuns } from '@/lib/db/schema';
import { eq } from 'drizzle-orm';
import { heuristicTagsFromFilename, createVisualNoteForAsset } from '@/lib/vault/visuals';
import { readStoredFile } from '@/lib/vault/storage';
import { callVisionAI, parseJSON, MODEL_EXTRACT } from '@/lib/ai';
import { recordCost } from '@/lib/credits';

// Visual Librarian: label a freshly-uploaded asset so the visual selector can
// actually find it. Two passes:
//   1. Filename heuristics (instant, free): a floor so the slice works
//      without any API key.
//   2. Vision pass (Gemini Flash via OpenRouter) reads the actual image and
//      writes caption, tags, topics, style, OCR text, and use guidance, so
//      camera-roll uploads (IMG_1234.jpg) end up discoverable instead of
//      dying in needs_review.

const VISION_MIMES = new Set(['image/png', 'image/jpeg', 'image/jpg', 'image/webp']);
const VALID_STYLES = new Set(['candid-photo', 'screenshot', 'chart', 'diagram', 'meme', 'product-shot', 'brand-asset', 'photo', 'graphic']);

interface VisionLabel {
  caption: string;
  tags: string[];
  topics: string[];
  visualStyle: string;
  textInImage: string;
  usableFor: string[];
  sensitive: boolean;
}

async function visionLabel(opts: {
  storageKey: string;
  mimeType: string;
}): Promise<VisionLabel | null> {
  if (!process.env.OPENROUTER_API_KEY) return null;
  if (!VISION_MIMES.has(opts.mimeType)) return null;

  const buffer = await readStoredFile(opts.storageKey);
  if (!buffer) return null;
  const dataUrl = `data:${opts.mimeType};base64,${buffer.toString('base64')}`;

  const prompt = `You are labelling an image for a content library. A ghostwriting tool will later search these labels to suggest the image for social media posts, so labels must describe what a writer would search for.

Return ONLY a JSON object:
{
  "caption": "one sentence describing what the image shows, concrete and specific",
  "tags": ["5-10 lowercase single or hyphenated words: subjects, objects, setting, mood"],
  "topics": ["2-5 post topics this image would fit, e.g. 'build-in-public', 'team culture', 'travel story'"],
  "visualStyle": "candid-photo" | "screenshot" | "chart" | "diagram" | "meme" | "product-shot" | "brand-asset" | "graphic",
  "textInImage": "any readable text in the image, verbatim, or empty string",
  "usableFor": ["1-3 short phrases for the post angles this image suits best"],
  "sensitive": true if the image shows private data (screens with personal info, documents, financial dashboards with real numbers), identifiable third parties who may not have consented, or anything a user would not want auto-posted; otherwise false
}`;

  const out = await callVisionAI({
    model: MODEL_EXTRACT,
    prompt,
    imageDataUrl: dataUrl,
    temperature: 0.2,
    maxTokens: 600,
  });

  const parsed = parseJSON<Partial<VisionLabel>>(out);
  if (!parsed?.caption || !Array.isArray(parsed.tags)) return null;

  return {
    caption: String(parsed.caption).slice(0, 500),
    tags: parsed.tags.filter(t => typeof t === 'string').map(t => t.toLowerCase().trim()).filter(Boolean).slice(0, 12),
    topics: Array.isArray(parsed.topics) ? parsed.topics.filter(t => typeof t === 'string').map(t => t.toLowerCase().trim()).filter(Boolean).slice(0, 6) : [],
    visualStyle: VALID_STYLES.has(parsed.visualStyle ?? '') ? parsed.visualStyle! : 'photo',
    textInImage: typeof parsed.textInImage === 'string' ? parsed.textInImage.slice(0, 1000) : '',
    usableFor: Array.isArray(parsed.usableFor) ? parsed.usableFor.filter(t => typeof t === 'string').slice(0, 4) : [],
    sensitive: parsed.sensitive === true,
  };
}

export async function processAsset(opts: {
  userId: string;
  brandId: string;
  assetId: string;
}): Promise<void> {
  const [run] = await db.insert(agentRuns).values({
    userId: opts.userId,
    brandId: opts.brandId,
    agentName: 'visual_librarian',
    status: 'running',
    input: { assetId: opts.assetId },
  }).returning({ id: agentRuns.id });

  try {
    const [asset] = await db.select().from(vaultAssets).where(eq(vaultAssets.id, opts.assetId)).limit(1);
    if (!asset) throw new Error('asset not found');

    // Pass 1: filename heuristics, the floor.
    const heuristic = heuristicTagsFromFilename(asset.originalFilename, asset.mimeType);
    let tags = Array.from(new Set([...(asset.tags ?? []), ...heuristic.tags]));
    let visualStyle: string = heuristic.visualStyle;
    let status: 'ready' | 'needs_review' = heuristic.status;
    let captionSummary = asset.captionSummary ?? null;
    let topics = asset.topics ?? [];
    let textInImage = asset.textInImage ?? null;
    let usableFor = asset.usableFor ?? [];
    let sensitivity = asset.sensitivity;
    let labelledBy = 'filename-heuristics';

    // Pass 2: vision reads the actual pixels. Failure falls back to pass 1.
    try {
      const vision = await visionLabel({ storageKey: asset.storageKey, mimeType: asset.mimeType });
      if (vision) {
        tags = Array.from(new Set([...(asset.tags ?? []), ...vision.tags]));
        topics = Array.from(new Set([...(asset.topics ?? []), ...vision.topics]));
        visualStyle = vision.visualStyle;
        captionSummary = vision.caption;
        textInImage = vision.textInImage || null;
        usableFor = usableFor.length ? usableFor : vision.usableFor;
        // Vision-labelled images are searchable, so they are ready unless the
        // model flagged something a human should look at first.
        status = vision.sensitive ? 'needs_review' : 'ready';
        if (vision.sensitive && sensitivity === 'safe') sensitivity = 'needs_review';
        labelledBy = 'vision';
        recordCost(opts.userId, 'asset_label', { assetId: asset.id }).catch(() => {});
      }
    } catch (err) {
      console.error('[visual-librarian] vision pass failed, keeping heuristics:', err instanceof Error ? err.message : err);
    }

    await db.update(vaultAssets)
      .set({
        tags,
        topics,
        visualStyle,
        status,
        sensitivity,
        captionSummary: captionSummary ?? `Auto-tagged from filename: ${asset.originalFilename}`,
        textInImage,
        usableFor,
        updatedAt: new Date(),
      })
      .where(eq(vaultAssets.id, asset.id));

    const [updated] = await db.select().from(vaultAssets).where(eq(vaultAssets.id, asset.id)).limit(1);
    if (updated) {
      await createVisualNoteForAsset({ userId: opts.userId, brandId: opts.brandId, asset: updated });
    }

    await db.update(agentRuns)
      .set({ status: 'completed', completedAt: new Date(), output: { tags, visualStyle, status, labelledBy } })
      .where(eq(agentRuns.id, run.id));
  } catch (err) {
    await db.update(agentRuns)
      .set({ status: 'failed', completedAt: new Date(), error: err instanceof Error ? err.message : String(err) })
      .where(eq(agentRuns.id, run.id));
  }
}
