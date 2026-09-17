import type { NextConfig } from "next";

// A deploy with its own domain sets LORE_CANONICAL_HOST, and LORE_LEGACY_HOSTS for
// older addresses. Pages on those move to the canonical host; /api stays put so
// installs and webhooks already pointed at an old address keep working.
const canonical = process.env.LORE_CANONICAL_HOST?.trim();
const legacy = (process.env.LORE_LEGACY_HOSTS ?? '').split(',').map((h) => h.trim()).filter(Boolean);

const nextConfig: NextConfig = {
  // Next writes AGENTS.md and CLAUDE.md into the project on `next dev` by
  // default. Lore does not ship those, so keep them out of every install.
  agentRules: false,
  poweredByHeader: false,
  async redirects() {
    if (!canonical) return [];
    return [
      { source: '/:path*', has: [{ type: 'host' as const, value: `www.${canonical}` }], destination: `https://${canonical}/:path*`, permanent: true },
      ...legacy.flatMap((host) => [
        { source: '/', has: [{ type: 'host' as const, value: host }], destination: `https://${canonical}/`, permanent: false },
        { source: '/:path((?!api/).*)', has: [{ type: 'host' as const, value: host }], destination: `https://${canonical}/:path`, permanent: false },
      ]),
    ];
  },
  async headers() {
    return [
      {
        source: '/:path*',
        headers: [
          { key: 'X-Frame-Options', value: 'DENY' },
          { key: 'X-Content-Type-Options', value: 'nosniff' },
          { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
          { key: 'Permissions-Policy', value: 'camera=(), geolocation=(), microphone=(self)' },
        ],
      },
    ];
  },
};

export default nextConfig;
