import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Next writes AGENTS.md and CLAUDE.md into the project on `next dev` by
  // default. Lore does not ship those, so keep them out of every install.
  agentRules: false,
  poweredByHeader: false,
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
