import { defineConfig } from "vitest/config";

// Kept separate from vite.config.ts so tests don't spin up the Cloudflare Worker runtime.
export default defineConfig({ test: { include: ["src/**/*.test.ts"] } });
