import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  experimental: {
    reactDebugChannel: false,
    serverComponentsHmrCache: false,
  },
};

export default nextConfig;
