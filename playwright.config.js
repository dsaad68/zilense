import { defineConfig } from '@playwright/test'

// E2E smoke test for the built extension. Loads dist/ in Chromium and drives the
// side-panel page directly. Run `npm run build` first (the spec asserts dist/
// exists). Chromium must be headed to load an MV3 extension, so this is kept out
// of `npm test` (unit tests) and run explicitly via `npm run test:e2e`.
export default defineConfig({
  testDir: './e2e',
  timeout: 60_000,
  fullyParallel: false,
  workers: 1,
  reporter: 'list',
})
