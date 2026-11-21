import { expect, test } from '@playwright/test';

test('generates and edits candidate lines without replacing edits when wind changes', async ({ page, isMobile }) => {
  await page.route('https://tiles.openfreemap.org/**', (route) => route.abort());
  await page.goto('/');
  const button = (name: string) => page.getByRole('button', { name, exact: true });
  const open = () => button('Fireline Intelligence').click();
  const close = () => button('Close sheet').click();
  const candidate = () => page.getByRole('button', { name: /Crosswind transect/ });
  await button(isMobile ? 'Responders' : 'Responder Lab').click();
  if (isMobile) {
    await button('Scenario presets').click();
    await page.getByRole('button', { name: /Santa Rosa Control Lines/ }).click();
  } else await button('Launch Demo').click();
  await open();
  await button('Generate Geometrically').click();
  await expect(page.getByRole('heading', { name: 'Candidate comparison' })).toBeVisible();
  await expect(page.getByRole('button', { name: /Perimeter offset/ })).toBeVisible();
  await expect(page.getByRole('button', { name: /Wind-shift corridor/ })).toBeVisible();
  await expect(candidate()).toContainText(/m from perimeter/);
  await candidate().click();
  await button('Zoom to line').click();
  const map = page.getByRole('region', { name: 'Scenario map' });
  await map.scrollIntoViewIfNeeded();
  const hit = async (fractionX: number, fractionY: number) => {
    const { x, y, width, height } = (await map.boundingBox())!;
    if (isMobile) await page.touchscreen.tap(x + width * fractionX, y + height * fractionY);
    else await page.mouse.click(x + width * fractionX, y + height * fractionY);
  };
  if (isMobile) {
    await hit(.5, .5);
    await expect(page.getByRole('dialog', { name: 'Fireline Intelligence' })).toBeVisible();
  }
  await button('Edit candidate').click();
  await button('Candidate vertex 1').click();
  await map.scrollIntoViewIfNeeded();
  await hit(.48, .58);
  await button(isMobile ? 'Finish' : 'Finish edit').click();
  await expect(candidate()).toContainText('Edited');

  await button('Generate Geometrically').click();
  await expect(button('Replace candidates')).toBeVisible();
  await button('Keep edits').click();
  await expect(candidate()).toContainText('Edited');
  if (isMobile) await close();
  await button(isMobile ? 'Wind shift' : 'Operations Lab').click();
  const wind = page.getByRole('slider', { name: 'Wind from', exact: true });
  await wind.press('Home');
  for (let i = 0; i < 4; i++) await wind.press('ArrowRight');
  if (isMobile) await close();
  await open();
  await expect(candidate()).toContainText('Edited');
  await page.getByRole('checkbox', { name: 'Calculate five-run sensitivity' }).check();
  await expect(page.getByText(/modeled footprints overlap/).first()).toBeVisible();
  await button('Revert').click();
  await expect(candidate()).not.toContainText('Edited');
});

test('a failed Nemotron request keeps existing geographic candidates correctly labeled', async ({ page, isMobile }) => {
  await page.route('https://tiles.openfreemap.org/**', (route) => route.abort());
  await page.route('**/api/agent/firelines', (route) => route.fulfill({
    status: 503, json: { error: 'Nemotron test service unavailable' },
  }));
  await page.goto('/');
  await page.getByRole('button', { name: isMobile ? 'Responders' : 'Responder Lab', exact: true }).click();
  await page.getByRole('button', { name: 'Fireline Intelligence', exact: true }).click();
  await page.getByRole('button', { name: 'Generate Geometrically' }).click();
  const candidate = page.getByRole('button', { name: /Crosswind transect/ });
  await expect(candidate).toContainText('Geometric');
  await page.getByRole('button', { name: 'Generate with Nemotron' }).click();
  await expect(page.getByRole('status').filter({ hasText: 'Nemotron test service unavailable' })).toBeVisible();
  await expect(candidate).toContainText('Geometric');
});
