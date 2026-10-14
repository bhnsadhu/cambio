import { defineConfig } from "@playwright/test";

/**
 * Logo and motion checks. They need only the Next server, not the test
 * database, so the backend settings are placeholders and every API call
 * fails fast, exactly like a visitor whose requests have not returned yet.
 *
 *   npm run test:brand
 */
const port = Number(process.env.BRAND_PORT ?? 3211);

export default defineConfig({
  testDir: "./e2e",
  testMatch: "brand.spec.ts",
  workers: 1,
  timeout: 60_000,
  use: { baseURL: `http://localhost:${port}`, viewport: { width: 1280, height: 900 } },
  webServer: {
    command: `next dev -p ${port}`,
    url: `http://localhost:${port}`,
    timeout: 120_000,
    reuseExistingServer: false,
    env: { NEXT_PUBLIC_SUPABASE_URL: "http://127.0.0.1:9", NEXT_PUBLIC_SUPABASE_ANON_KEY: "placeholder", CAMBIO_SERVER_SECRET: "placeholder" },
  },
});
