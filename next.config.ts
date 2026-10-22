import type { NextConfig } from "next";

// cacheComponents is intentionally off: every page reads the Supabase session,
// so pages render dynamically per request.
const nextConfig: NextConfig = {
  devIndicators: false,
  turbopack: {
    rules: {
      "*.css": {
        loaders: ["@tailwindcss/turbopack"],
        as: "*.css",
      },
    },
  },
};

export default nextConfig;
