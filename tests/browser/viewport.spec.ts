import { devices, expect, test } from '@playwright/test';

const sizes = [
  ['compact', 360, 800], ['iphone-se', 375, 667], ['iphone-13', 390, 844],
  ['iphone-15', 393, 852], ['iphone-plus', 430, 932], ['android', 412, 915],
  ['tablet-portrait', 768, 1024], ['tablet-landscape', 1024, 768], ['desktop', 1440, 900],
] as const;

test('viewport matrix keeps the embedded map, navigation, and sheets within the screen', async ({ browser, isMobile }, info) => {
  test.skip(isMobile);
  test.setTimeout(120_000);
  for (const [name, width, height] of sizes) {
    const mobile = width <= 780;
    const profile = name === 'android' ? devices['Pixel 7'] : mobile ? devices['iPhone 13'] : devices['Desktop Chrome'];
    const page = await browser.newPage({ ...profile, viewport: { width, height }, screen: { width, height },
      baseURL: 'http://localhost:5173' });
    try {
      await page.goto('/');
      const map = page.getByRole('region', { name: 'Scenario map' });
      const nav = page.getByRole('navigation', { name: 'Primary navigation' });
      await expect(map).toBeVisible();
      await expect(page.getByText(/TERRAIN · USGS|OFFLINE GEOGRAPHIC GRID/)).toBeVisible({ timeout: 12_000 });
      if (['iphone-13','iphone-se','iphone-plus','tablet-portrait','desktop'].includes(name)) await page.waitForTimeout(500);
      expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(width);
      if (mobile) {
        await expect(nav.getByRole('button')).toHaveCount(3);
        const navBounds = (await nav.boundingBox())!;
        expect(navBounds.y + navBounds.height).toBeCloseTo(height, 0);
        const mapBounds = (await map.boundingBox())!;
        expect(mapBounds.height / height).toBeGreaterThan(.43);
        expect(mapBounds.height / height).toBeLessThan(.60);
        if (name === 'iphone-13') {
          await page.screenshot({ path: info.outputPath('390-civilian.png'), scale: 'css' });
          await page.getByRole('button', { name: 'Scenario', exact: true }).tap();
          await expect(page.getByRole('dialog', { name: 'Scenario controls' })).toBeVisible();
          await page.screenshot({ path: info.outputPath('390-scenario-sheet.png'), scale: 'css' });
          await page.getByRole('button', { name: 'Close sheet' }).tap();
          await nav.getByRole('button', { name: 'Responders' }).tap();
          await page.screenshot({ path: info.outputPath('390-responders.png'), scale: 'css' });
          await page.getByRole('button', { name: 'Analyze with Nemotron' }).tap();
          await expect(page.getByRole('dialog', { name: 'Nemotron Intelligence' })).toBeVisible();
          await page.screenshot({ path: info.outputPath('390-nemotron.png'), scale: 'css' });
        }
      } else {
        await expect(nav).toHaveCount(0);
        await expect(page.getByRole('navigation', { name: 'Workspace tools' })).toBeVisible();
        await expect(page.getByRole('complementary', { name: 'Scenario metrics' })).toBeVisible();
      }
      if (['iphone-se','iphone-plus','tablet-portrait','desktop'].includes(name)) {
        await page.screenshot({ path: info.outputPath(name + '.png'), scale: 'css' });
      }
    } finally {
      await page.close();
    }
  }
});

