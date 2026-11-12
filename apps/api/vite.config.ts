import { defineConfig } from "vite-plus";

export default defineConfig({
  test: {
    include: ["test/**/*.test.ts"],
    // Every test file resets the same test database, so files must not run in parallel.
    fileParallelism: false,
  },
});
