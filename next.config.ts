/** Next.js configuration -- enables standalone output for Docker deployment. */
import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  output: "standalone",
};

export default nextConfig;
