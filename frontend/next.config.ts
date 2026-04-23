import type { NextConfig } from "next";
import { dirname } from "node:path";
import { fileURLToPath } from "node:url";

const projectRoot = dirname(fileURLToPath(import.meta.url));

const nextConfig: NextConfig = {
  allowedDevOrigins: ["*.tunnelmole.net"],
  turbopack: {
    root: projectRoot,
  },
};

export default nextConfig;
