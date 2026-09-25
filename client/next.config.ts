import type { NextConfig } from "next";

const nextConfig: NextConfig = {
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
