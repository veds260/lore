import { createCipheriv, createDecipheriv, randomBytes } from 'crypto';

const ALG = 'aes-256-gcm';
const PREFIX = 'enc:';

function getKey(): Buffer | null {
  const hex = process.env.SKILLS_ENCRYPTION_KEY;
  if (!hex || hex.length !== 64) return null; // 32 bytes = 64 hex chars
  return Buffer.from(hex, 'hex');
}

// Encrypts skill body text. Returns `enc:iv:tag:data` hex string.
// Throws if SKILLS_ENCRYPTION_KEY is not set, never silently stores plaintext.
export function encryptSkillBody(plaintext: string): string {
  const key = getKey();
  if (!key) throw new Error('SKILLS_ENCRYPTION_KEY is not set — cannot encrypt skill body');

  const iv = randomBytes(12);
  const cipher = createCipheriv(ALG, key, iv);
  const encrypted = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();

  return `${PREFIX}${iv.toString('hex')}:${tag.toString('hex')}:${encrypted.toString('hex')}`;
}

// Decrypts a skill body. Handles both encrypted and legacy plaintext bodies.
// Throws if SKILLS_ENCRYPTION_KEY is not set or decryption fails.
export function decryptSkillBody(stored: string): string {
  if (!stored.startsWith(PREFIX)) return stored; // plaintext or legacy row

  const key = getKey();
  if (!key) throw new Error('SKILLS_ENCRYPTION_KEY is not set — cannot decrypt skill body');

  const inner = stored.slice(PREFIX.length);
  const parts = inner.split(':');
  if (parts.length !== 3) throw new Error('Malformed encrypted skill body');

  const [ivHex, tagHex, dataHex] = parts;
  const iv = Buffer.from(ivHex, 'hex');
  const tag = Buffer.from(tagHex, 'hex');
  const data = Buffer.from(dataHex, 'hex');

  const decipher = createDecipheriv(ALG, key, iv);
  decipher.setAuthTag(tag);

  return decipher.update(data).toString('utf8') + decipher.final('utf8');
}

export function isEncrypted(body: string): boolean {
  return body.startsWith(PREFIX);
}
