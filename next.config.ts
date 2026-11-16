import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Release builds set BUILD_COMMIT (scripts/release/build-candidate.mjs, docs/STAGING_HANDOFF.md):
  // using it as the build id makes the build reproducible. Without it the framework's random id is used.
  generateBuildId: async () => (/^[0-9a-f]{40}$/.test(process.env.BUILD_COMMIT ?? "") ? process.env.BUILD_COMMIT! : null),
};

export default nextConfig;
