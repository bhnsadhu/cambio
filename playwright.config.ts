import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: "./e2e",
  workers: 1,
  timeout: 90_000,
  expect: { timeout: 10_000 },
  use: { baseURL: "http://localhost:3100", viewport: { width: 1440, height: 1000 }, screenshot: "only-on-failure", trace: "retain-on-failure" },
});
