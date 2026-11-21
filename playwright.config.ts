import { defineConfig, devices } from '@playwright/test';
export default defineConfig({
  testDir: './tests/browser', timeout: 35_000, use: { baseURL: 'http://localhost:5173', trace: 'retain-on-failure' },
  webServer: { command: 'npm run dev', url: 'http://localhost:5173/api/health', reuseExistingServer: true, timeout: 30_000 },
  projects: [
    { name: 'desktop', use: { ...devices['Desktop Chrome'], viewport: { width: 1440, height: 900 } } },
    { name: 'mobile', use: { ...devices['iPhone 13'], defaultBrowserType: 'chromium' } },
  ],
});
