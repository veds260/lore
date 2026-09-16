import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';

// Runs outside Next, so nothing has loaded the env file yet.
for (const file of ['.env.local', '.env']) {
  try {
    process.loadEnvFile(file);
    break;
  } catch {
    // not there, try the next one
  }
}

const { and, desc, eq } = await import('drizzle-orm');
const { db } = await import('../lib/db');
const { brands, drafts, skills, users } = await import('../lib/db/schema');
const { quickGenerate } = await import('../lib/telegram-generate');

type Text = { content: Array<{ type: 'text'; text: string }> };
const text = (s: string): Text => ({ content: [{ type: 'text', text: s }] });

// The owner is whoever claimed the instance. ADMIN_EMAIL wins when it is set,
// otherwise the oldest account, so a multi-account database resolves the same
// way every time instead of taking whatever row comes back first.
async function ownerId(): Promise<string | null> {
  const admin = process.env.ADMIN_EMAIL?.trim().toLowerCase();
  if (admin) {
    const [row] = await db.select({ id: users.id }).from(users).where(eq(users.email, admin)).limit(1);
    if (row) return row.id;
  }
  const [row] = await db.select({ id: users.id }).from(users).orderBy(users.createdAt).limit(1);
  return row?.id ?? null;
}

async function resolveBrand(nameOrId?: string) {
  const owner = await ownerId();
  if (!owner) return null;

  const rows = await db
    .select({
      id: brands.id,
      name: brands.name,
      handle: brands.handle,
      userId: brands.userId,
      voiceSummary: brands.voiceSummary,
      isActive: brands.isActive,
    })
    .from(brands)
    .where(eq(brands.userId, owner));

  if (!rows.length) return null;
  if (!nameOrId) return rows.find((b) => b.isActive) ?? rows[0];

  const needle = nameOrId.trim().toLowerCase();
  return (
    rows.find((b) => b.id === nameOrId) ??
    rows.find((b) => b.name.toLowerCase() === needle) ??
    rows.find((b) => b.name.toLowerCase().includes(needle)) ??
    rows.find((b) => (b.handle ?? '').toLowerCase().replace(/^@/, '') === needle.replace(/^@/, '')) ??
    null
  );
}

const server = new McpServer({ name: 'lore', version: '1.0.0' });

server.tool(
  'list_brands',
  'List the brands on this Lore instance, with their handle and whether they are the active one.',
  {},
  async () => {
    const owner = await ownerId();
    if (!owner) return text('This Lore instance has no owner yet. Open the claim link the server printed.');

    const rows = await db
      .select({ name: brands.name, handle: brands.handle, isActive: brands.isActive })
      .from(brands)
      .where(eq(brands.userId, owner));

    if (!rows.length) return text('No brands yet. Finish onboarding in the app first.');
    return text(
      rows
        .map((b) => `${b.name}${b.handle ? ` (@${b.handle.replace(/^@/, '')})` : ''}${b.isActive ? '  [active]' : ''}`)
        .join('\n'),
    );
  },
);

server.tool(
  'get_voice',
  'Read how a brand writes: its voice summary and the rules Lore has learned from edits.',
  { brand: z.string().optional().describe('Brand name or handle. Defaults to the active brand.') },
  async ({ brand }) => {
    const b = await resolveBrand(brand);
    if (!b) return text('No matching brand. Call list_brands to see what exists.');

    const rules = await db
      .select({ name: skills.name })
      .from(skills)
      .where(and(eq(skills.brandId, b.id), eq(skills.status, 'active')))
      .orderBy(desc(skills.createdAt))
      .limit(25);

    const lines = [
      `Brand: ${b.name}`,
      '',
      'Voice:',
      b.voiceSummary?.trim() || 'Not established yet. Connect a handle so Lore can read real posts.',
      '',
      `Rules learned from edits (${rules.length}):`,
      rules.length ? rules.map((r) => `- ${r.name}`).join('\n') : '- none yet',
    ];
    return text(lines.join('\n'));
  },
);

server.tool(
  'list_drafts',
  'List recent drafts for a brand.',
  {
    brand: z.string().optional().describe('Brand name or handle. Defaults to the active brand.'),
    status: z.enum(['idea', 'draft', 'review', 'approved', 'posted']).optional(),
    limit: z.number().int().min(1).max(50).optional(),
  },
  async ({ brand, status, limit }) => {
    const b = await resolveBrand(brand);
    if (!b) return text('No matching brand. Call list_brands to see what exists.');

    const where = status
      ? and(eq(drafts.brandId, b.id), eq(drafts.status, status))
      : eq(drafts.brandId, b.id);

    const rows = await db
      .select({ content: drafts.content, status: drafts.status, createdAt: drafts.createdAt })
      .from(drafts)
      .where(where)
      .orderBy(desc(drafts.createdAt))
      .limit(limit ?? 10);

    if (!rows.length) return text('Nothing on the board yet.');
    return text(
      rows
        .map((d, i) => {
          const when = d.createdAt ? d.createdAt.toISOString().slice(0, 10) : '';
          const head = d.content.split('\n')[0].slice(0, 120);
          return `${i + 1}. [${d.status}] ${when}  ${head}`;
        })
        .join('\n'),
    );
  },
);

server.tool(
  'generate_post',
  "Write a post in the brand's voice, using the rules it has learned. Returns the draft without saving it.",
  {
    topic: z.string().min(3).describe('What the post is about.'),
    brand: z.string().optional().describe('Brand name or handle. Defaults to the active brand.'),
    platform: z.enum(['twitter', 'linkedin', 'both']).optional(),
  },
  async ({ topic, brand, platform }) => {
    const b = await resolveBrand(brand);
    if (!b) return text('No matching brand. Call list_brands to see what exists.');

    const result = await quickGenerate(b.id, topic, {
      userId: b.userId,
      platform: platform ?? 'both',
    });
    if (!result) {
      return text('Could not write that one. Check the model backend with `npm run doctor`.');
    }

    const parts: string[] = [];
    if (result.twitter) parts.push(`For X:\n\n${result.twitter}`);
    if (result.linkedin) {
      parts.push(`For LinkedIn${result.templateName ? ` (${result.templateName})` : ''}:\n\n${result.linkedin}`);
    }
    return text(parts.join('\n\n---\n\n'));
  },
);

server.tool(
  'save_idea',
  'Park an idea on the board so a later brief or draft can pick it up.',
  {
    content: z.string().min(3).describe('The idea, in plain words.'),
    brand: z.string().optional().describe('Brand name or handle. Defaults to the active brand.'),
  },
  async ({ content, brand }) => {
    const b = await resolveBrand(brand);
    if (!b) return text('No matching brand. Call list_brands to see what exists.');

    await db.insert(drafts).values({
      userId: b.userId,
      brandId: b.id,
      content: content.trim().slice(0, 4000),
      status: 'idea',
      notes: JSON.stringify({ platform: 'both', source: 'mcp' }),
    });
    return text(`Saved to ${b.name}.`);
  },
);

const transport = new StdioServerTransport();
await server.connect(transport);
