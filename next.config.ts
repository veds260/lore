import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Next writes AGENTS.md and CLAUDE.md into the project on `next dev` by
  // default. Lore does not ship those, so keep them out of every install.
  agentRules: false,
};

export default nextConfig;
