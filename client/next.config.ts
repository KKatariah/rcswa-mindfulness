import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Lets the Playwright run use its own build folder alongside a normal dev server.
  distDir: process.env.NEXT_DIST_DIR ?? ".next",
  images: {
    remotePatterns: [
      {
        protocol: "https",
        hostname: "images.thewest.com.au",
      },
    ],
  },
};

export default nextConfig;
