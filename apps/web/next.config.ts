import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Los paquetes del monorepo se publican como TypeScript sin compilar.
  transpilePackages: ["@precios/db", "@precios/matching"],
};

export default nextConfig;
