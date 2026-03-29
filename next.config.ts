import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  serverExternalPackages: [
    'playwright',
    'fluent-ffmpeg',
    '@ffmpeg-installer/ffmpeg',
    'better-sqlite3',
  ],
};

export default nextConfig;
