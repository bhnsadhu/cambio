import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  images: { qualities: [75, 90] },
  // Isolated browser runs change database origins each time, so their disk
  // caches cannot be reused and only consume space between test runs.
  experimental: {
    turbopackFileSystemCacheForDev: !process.env.E2E_APP_ORIGIN,
  },
};

export default nextConfig;
