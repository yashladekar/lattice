import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    include: ["src/**/*.test.ts"],
    setupFiles: ["./test/setup.ts"],
    // Each file owns a throwaway workspace, so parallel files are safe. Keeping
    // concurrency low avoids opening many Prisma pools against a dev database.
    pool: "forks",
    maxWorkers: 2,
    testTimeout: 30_000,
    hookTimeout: 30_000,
  },
});
