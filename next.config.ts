import { fileURLToPath } from "node:url";
import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // This folder is the app: never pick up a lockfile from a parent folder.
  turbopack: { root: fileURLToPath(new URL(".", import.meta.url)) },
  devIndicators: false,
  // Let phones on the local network use the dev server (`npm run dev:lan`).
  allowedDevOrigins: ["192.168.*.*", "10.*.*.*", "172.16.*.*"],
  poweredByHeader: false,
  // The camera for this app only, and never inside someone else's frame.
  async headers() {
    return [
      {
        source: "/:path*",
        headers: [
          { key: "Content-Security-Policy", value: "frame-ancestors 'none'" },
          { key: "X-Frame-Options", value: "DENY" },
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "Referrer-Policy", value: "no-referrer" },
          { key: "Permissions-Policy", value: "camera=(self), microphone=(), geolocation=(), payment=()" },
        ],
      },
    ];
  },
};

export default nextConfig;
