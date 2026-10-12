import type { NextConfig } from "next";

// Allow the dev server to accept WebSocket (HMR) connections from tunnel hosts.
// Set DEV_ALLOWED_ORIGINS in client/.env (comma-separated hostnames, no protocol).
// e.g. DEV_ALLOWED_ORIGINS=xxx.trycloudflare.com
const devAllowedOrigins = process.env.DEV_ALLOWED_ORIGINS
  ? process.env.DEV_ALLOWED_ORIGINS.split(",").map((s) => s.trim()).filter(Boolean)
  : [];

const isDev = process.env.NODE_ENV === "development";

// The Django API, which also serves uploaded cover images. A relative URL (the Docker
// setup's "/api") is this site's own origin, which 'self' already allows.
const apiUrl = process.env.NEXT_PUBLIC_API_BASE_URL ?? "http://127.0.0.1:8000/api";
const apiOrigin = apiUrl.startsWith("/") ? "" : new URL(apiUrl).origin;

// Google sign-in (@react-oauth/google loads Google's script, styles and an iframe).
const GOOGLE_SIGN_IN = "https://accounts.google.com/gsi/";
// Module players; ContentEmbed only renders these hosts.
const PLAYERS = ["https://www.youtube.com", "https://www.youtube-nocookie.com", "https://w.soundcloud.com"];

const contentSecurityPolicy = [
  "default-src 'self'",
  // Dev mode evaluates code for fast refresh; production builds never need eval.
  `script-src 'self' ${GOOGLE_SIGN_IN}client${isDev ? " 'unsafe-eval'" : ""}`,
  // React renders style attributes and next/font injects a <style> tag.
  `style-src 'self' 'unsafe-inline' ${GOOGLE_SIGN_IN}style`,
  `img-src 'self' data: blob: ${apiOrigin} https://www.gravatar.com https://images.thewest.com.au`,
  "font-src 'self'",
  // Dev mode's hot reload talks over a websocket.
  `connect-src 'self' ${apiOrigin} ${GOOGLE_SIGN_IN}${isDev ? " ws: wss:" : ""}`,
  `frame-src ${GOOGLE_SIGN_IN} ${PLAYERS.join(" ")}`,
  "worker-src 'self'",
  "manifest-src 'self'",
  "object-src 'none'",
  "base-uri 'self'",
  "form-action 'self'",
  // No other site may put this app in a frame (clickjacking).
  "frame-ancestors 'none'",
].join("; ");

const nextConfig: NextConfig = {
  // Builds a self-contained server in .next/standalone for the Docker image (client/Dockerfile).
  output: "standalone",
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
  async headers() {
    return [
      {
        source: "/:path*",
        headers: [
          { key: "Content-Security-Policy", value: contentSecurityPolicy },
          // For older browsers that don't support frame-ancestors.
          { key: "X-Frame-Options", value: "DENY" },
        ],
      },
    ];
  },
};

export default nextConfig;
