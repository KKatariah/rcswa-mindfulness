import type { NextConfig } from "next";

// Allow the dev server to accept WebSocket (HMR) connections from tunnel hosts.
// Set DEV_ALLOWED_ORIGINS in client/.env (comma-separated hostnames, no protocol).
// e.g. DEV_ALLOWED_ORIGINS=xxx.trycloudflare.com
const devAllowedOrigins = process.env.DEV_ALLOWED_ORIGINS
  ? process.env.DEV_ALLOWED_ORIGINS.split(",").map((s) => s.trim()).filter(Boolean)
  : [];

const nextConfig: NextConfig = {
  // Lets the Playwright run use its own build folder alongside a normal dev server.
  distDir: process.env.NEXT_DIST_DIR ?? ".next",
  allowedDevOrigins: devAllowedOrigins,
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
