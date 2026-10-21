import { defineConfig } from "vitest/config";
import path from "node:path";

/**
 * bots.test.ts holds seeded bot tables with a 30 second limit that sits close
 * to its own runtime on a 4 core CI runner, so it runs in a group of its own
 * after every other file, without other test files competing for the CPU.
 */
const TIMED = "src/lib/game/bots.test.ts";

export default defineConfig({
  resolve: { alias: { "@": path.resolve(__dirname, "src") } },
  test: {
    projects: [
      { extends: true, test: { name: "unit", include: ["src/**/*.test.ts"], exclude: [TIMED], sequence: { groupOrder: 0 } } },
      { extends: true, test: { name: "timed", include: [TIMED], sequence: { groupOrder: 1 } } },
    ],
  },
});
