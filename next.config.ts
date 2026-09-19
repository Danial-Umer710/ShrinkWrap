import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  outputFileTracingIncludes: {
    "/api/analyze": ["./src/data/precomputed/**/*"],
  },
};

export default nextConfig;
