import { defineConfig } from "vite-plus";

export default defineConfig({
  test: {
    // E2E=1 runs the HTTP flows in e2e/ against a running stack; the default runs test/.
    include: process.env.E2E ? ["e2e/**/*.test.ts"] : ["test/**/*.test.ts"],
    // Every test file resets the same test database, so files must not run in parallel.
    fileParallelism: false,
  },
});
