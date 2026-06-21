import { fileURLToPath } from "url";
import { dirname } from "path";

const __dirname = dirname(fileURLToPath(import.meta.url));

/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  // Pin the workspace root to this app so stray parent lockfiles don't confuse tracing.
  turbopack: { root: __dirname },
};

export default nextConfig;
