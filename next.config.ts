import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  experimental: {
    authInterrupts: true,
    reactDebugChannel: false,
    serverComponentsHmrCache: false,
  },
};

export default nextConfig;
