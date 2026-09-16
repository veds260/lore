// Module-level singleton, survives React component unmounts and client-side navigation.
// React refs reset on unmount; this map persists for the lifetime of the JS session.
export const ttsPrefetchCache = new Map<string, string>(); // text → blob URL

export async function prefetchTTSIntoCache(text: string, sessionToken: string): Promise<void> {
  if (!text || ttsPrefetchCache.has(text)) return;
  try {
    const res = await fetch('/api/voice/tts', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text, sessionToken }),
    });
    if (!res.ok) return;
    const blob = await res.blob();
    ttsPrefetchCache.set(text, URL.createObjectURL(blob));
  } catch {}
}
