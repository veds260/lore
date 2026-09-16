// Tiny YAML-frontmatter parser/writer. Deliberately limited: only the shapes
// the vault notes need (strings, numbers, booleans, ISO dates, flat string lists).
// Avoids a paid YAML dep. Malformed frontmatter is treated as no frontmatter
// rather than throwing.

export interface ParsedFrontmatter {
  data: Record<string, unknown>;
  body: string;
}

const FM_RE = /^---\s*\n([\s\S]*?)\n---\s*\n?([\s\S]*)$/;

function coerce(raw: string): unknown {
  const v = raw.trim();
  if (v === '') return '';
  if (v === 'null' || v === '~') return null;
  if (v === 'true') return true;
  if (v === 'false') return false;
  if (/^-?\d+$/.test(v)) return Number(v);
  if (/^-?\d+\.\d+$/.test(v)) return Number(v);
  // Quoted string
  if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) {
    return v.slice(1, -1);
  }
  // Inline list: [a, b, c]
  if (v.startsWith('[') && v.endsWith(']')) {
    const inner = v.slice(1, -1).trim();
    if (!inner) return [];
    return inner.split(',').map(s => {
      const t = s.trim();
      if ((t.startsWith('"') && t.endsWith('"')) || (t.startsWith("'") && t.endsWith("'"))) return t.slice(1, -1);
      return t;
    });
  }
  return v;
}

export function parseFrontmatter(raw: string): ParsedFrontmatter {
  const match = raw.match(FM_RE);
  if (!match) return { data: {}, body: raw };

  const [, block, body] = match;
  const data: Record<string, unknown> = {};
  const lines = block.split('\n');

  let pendingKey: string | null = null;
  const pendingList: string[] = [];

  const flushPending = () => {
    if (pendingKey) {
      data[pendingKey] = [...pendingList];
      pendingKey = null;
      pendingList.length = 0;
    }
  };

  for (const line of lines) {
    if (!line.trim()) { flushPending(); continue; }
    // Block list item ("- foo")
    if (pendingKey && /^\s+-\s+/.test(line)) {
      pendingList.push(line.replace(/^\s+-\s+/, '').replace(/^['"]|['"]$/g, '').trim());
      continue;
    }
    flushPending();
    const m = line.match(/^([a-zA-Z0-9_]+):\s*(.*)$/);
    if (!m) continue;
    const [, key, value] = m;
    if (value === '') {
      // Block list will follow
      pendingKey = key;
      continue;
    }
    data[key] = coerce(value);
  }
  flushPending();

  return { data, body: body ?? '' };
}

function stringify(value: unknown): string {
  if (value === null || value === undefined) return 'null';
  if (typeof value === 'boolean') return String(value);
  if (typeof value === 'number') return String(value);
  if (Array.isArray(value)) {
    if (value.length === 0) return '[]';
    const items = value.map(v => {
      const s = String(v).replace(/"/g, '\\"');
      return `"${s}"`;
    }).join(', ');
    return `[${items}]`;
  }
  if (value instanceof Date) return value.toISOString();
  const s = String(value);
  // Multi-line or special chars → quote
  if (/[:\n#]/.test(s)) return `"${s.replace(/"/g, '\\"')}"`;
  return s;
}

export function writeFrontmatter(data: Record<string, unknown>, body: string): string {
  const keys = Object.keys(data);
  if (keys.length === 0) return body;
  const block = keys
    .filter(k => data[k] !== undefined)
    .map(k => `${k}: ${stringify(data[k])}`)
    .join('\n');
  return `---\n${block}\n---\n\n${body.trimStart()}`;
}
