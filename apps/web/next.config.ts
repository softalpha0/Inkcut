import path from "node:path";
import type { NextConfig } from "next";

const config: NextConfig = {
  // Workspace packages are TypeScript sources; Next compiles them.
  transpilePackages: ["@inkcut/shared", "@inkcut/db"],
  // BullMQ/ioredis run only in route handlers on the Node.js server.
  serverExternalPackages: ["bullmq", "ioredis"],
  // The shared packages use NodeNext-style "./x.js" imports for TypeScript files;
  // webpack's extensionAlias resolves them (Turbopack does not yet).
  webpack: (webpackConfig: { resolve: { extensionAlias?: Record<string, string[]> } }) => {
    webpackConfig.resolve.extensionAlias = {
      ".js": [".ts", ".tsx", ".js"],
      ".mjs": [".mts", ".mjs"],
    };
    return webpackConfig;
  },
  outputFileTracingRoot: path.resolve(import.meta.dirname, "../.."),
};

export default config;
