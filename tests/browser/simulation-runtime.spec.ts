import { expect, test, type Page } from '@playwright/test';

async function pointOnMap(page: Page, x: number, y: number, mobile: boolean) {
  const canvas = page.getByRole('region', { name: 'Scenario map' }).locator('canvas');
  const bounds = (await canvas.boundingBox())!;
  if (mobile) await page.touchscreen.tap(bounds.x + bounds.width * x, bounds.y + bounds.height * y);
  else await page.mouse.click(bounds.x + bounds.width * x, bounds.y + bounds.height * y);
}

test('all three workspaces run to hour 24 on the shared map', async ({ page, isMobile }) => {
  test.setTimeout(110_000);
  await page.goto('/');
  const dock = page.getByRole('region', { name: 'Simulation timeline' });
  const clock = dock.getByRole('slider', { name: 'Simulation minute' });
  const canvas = await page.getByRole('region', { name: 'Scenario map' }).locator('canvas').elementHandle();
  await expect(clock).toHaveAttribute('max', '1440');
  await dock.getByRole('combobox', { name: 'Playback speed' }).selectOption('60');
  await dock.getByRole('button', { name: 'Play', exact: true }).click();
  await expect(clock).toHaveValue('1440', { timeout: 30_000 });
  await expect(clock).toHaveAttribute('aria-valuetext', /24h 00m/);
  await page.getByRole('button', { name: 'Business', exact: true }).click();
  await expect(clock).toHaveValue('1440');
  expect(await canvas?.evaluate((node) => node.isConnected)).toBe(true);
  if (isMobile) await page.getByRole('button', { name: 'Assets', exact: true }).click();
  await page.getByRole('button', { name: 'Load fictional vineyard demo' }).click();
  await dock.getByRole('button', { name: 'Restart timeline' }).click();
  await expect(clock).toHaveValue('0');
  await dock.getByRole('button', { name: 'Play', exact: true }).click();
  await expect(clock).toHaveValue('1440', { timeout: 30_000 });
  await page.getByRole('button', { name: 'Exposure', exact: true }).click();
  await expect(page.getByText(/Minute 1440/i).first()).toBeVisible();
  if (isMobile) await page.getByRole('button', { name: 'Close sheet' }).click();
  await page.getByRole('button', { name: isMobile ? 'Responders' : 'Responder Lab', exact: true }).click();
  await expect(clock).toHaveValue('1440');
  await dock.getByRole('button', { name: 'Restart timeline' }).click();
  await expect(clock).toHaveAttribute('aria-valuetext', '00:00 / 24:00');
  await dock.getByRole('button', { name: 'Play', exact: true }).click();
  await expect(clock).toHaveValue('1440', { timeout: 30_000 });
  await expect(clock).toHaveAttribute('aria-valuetext', '24:00 / 24:00');
});

test('a drawn Responder line changes both the map and the computed comparison', async ({ page, isMobile }, info) => {
  test.setTimeout(110_000);
  await page.goto('/');
  const map = page.getByRole('region', { name: 'Scenario map' });
  const dock = page.getByRole('region', { name: 'Simulation timeline' });
  const clock = dock.getByRole('slider', { name: 'Simulation minute' });
  const tools = () => page.getByRole('button', { name: isMobile ? 'Fireline tools' : 'Control Lines', exact: true }).click();
  const close = () => page.getByRole('button', { name: 'Close sheet' }).click();
  await page.getByRole('button', { name: isMobile ? 'Responders' : 'Responder Lab', exact: true }).click();
  await clock.press('Home');
  await page.getByRole('button', { name: /^(Wind shift|Wind Shift)$/ }).click();
  await page.getByRole('checkbox', { name: 'Enable wind shift' }).uncheck();
  await page.getByRole('slider', { name: 'Wind from', exact: true }).press('Home');
  await page.getByRole('slider', { name: 'Wind speed', exact: true }).press('End');
  await page.getByRole('slider', { name: 'Horizon', exact: true }).press('Home');
  for (let i = 0; i < 5; i++) await page.getByRole('slider', { name: 'Horizon', exact: true }).press('ArrowRight');
  if (isMobile) await close();
  await tools();
  await page.getByRole('button', { name: 'Delete line' }).click();
  await page.getByRole('button', { name: 'Delete line' }).click();
  await page.getByRole('button', { name: 'Draw proposed line' }).click();
  await map.getByRole('button', { name: 'Center on ignition' }).click();
  await map.getByRole('button', { name: 'Zoom in', exact: true }).click();
  await map.getByRole('button', { name: 'Zoom in', exact: true }).click();
  await page.waitForTimeout(500);
  await pointOnMap(page, .22, .66, isMobile);
  await pointOnMap(page, .78, .66, isMobile);
  await page.getByRole('button', { name: 'Finish', exact: true }).click();
  await page.getByRole('button', { name: 'Run Intervention', exact: true }).click();
  await expect(dock.getByRole('button', { name: 'Play', exact: true })).toBeEnabled({ timeout: 30_000 });
  await clock.press('End');
  if (isMobile) await page.getByRole('button', { name: 'Analysis', exact: true }).click();
  const avoided = page.getByText('Modeled burned area avoided', { exact: true }).locator('..').locator('strong');
  await expect(avoided).toBeVisible({ timeout: 30_000 });
  expect(Number((await avoided.textContent())!.replace(/[^0-9.]/g, ''))).toBeGreaterThan(0);
  await expect(page.getByText(/Blocked direct spread/)).toBeVisible();
  if (isMobile) await close();
  await map.getByRole('button', { name: 'Map layers', exact: true }).click();
  const baseline = map.getByRole('checkbox', { name: 'Modeled baseline', exact: true });
  await expect(baseline).toBeChecked();
  await baseline.uncheck();
  await baseline.check();
  await map.getByRole('button', { name: 'Map layers', exact: true }).click();
  await page.screenshot({ path: info.outputPath('barrier-map.png'), scale: 'css' });
  await tools();
  await page.getByRole('button', { name: 'Delete line' }).click();
  if (isMobile) {
    await close();
    await page.getByRole('button', { name: 'Analysis', exact: true }).click();
  }
  await expect(avoided).toHaveText('0.00 ac', { timeout: 30_000 });
});


test('Responder analysis agrees with the final sample of an hour-six branch', async ({ page, isMobile }) => {
  test.setTimeout(105_000);
  await page.goto('/');
  await page.getByRole('button', { name: isMobile ? 'Responders' : 'Responder Lab', exact: true }).click();
  const dock = page.getByRole('region', { name: 'Simulation timeline' });
  const clock = dock.getByRole('slider', { name: 'Simulation minute' });
  await clock.evaluate((input) => {
    const value = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!;
    value.set!.call(input, '360');
    input.dispatchEvent(new Event('input', { bubbles: true }));
    input.dispatchEvent(new Event('change', { bubbles: true }));
  });
  await expect(clock).toHaveAttribute('aria-valuetext', '06:00 / 24:00');
  if (isMobile) await page.getByRole('button', { name: 'Fireline tools', exact: true }).click();
  await page.getByRole('button', { name: 'Run Intervention', exact: true }).click();
  await expect(clock).toHaveValue('360');
  const openAnalysis = () => page.getByRole('button', { name: 'Analysis', exact: true }).click();
  if (isMobile) await openAnalysis();
  await expect(page.getByText('Playback sample · 06:00', { exact: true })).toBeVisible({ timeout: 45_000 });
  await expect(page.getByText('Branch runs from 06:00 to 24:00.')).toBeVisible();
  await page.getByText('End of run · 24:00', { exact: true }).click();
  const measure = (label: string) => page.getByText(label, { exact: true }).locator('..').locator('strong');
  const final = await measure('Final baseline').textContent();
  const initial = await measure('Modeled baseline').textContent();
  expect(Number(final!.replace(/[^0-9.]/g, ''))).toBeGreaterThan(Number(initial!.replace(/[^0-9.]/g, '')));
  if (isMobile) await page.getByRole('button', { name: 'Close sheet' }).click();
  await clock.press('End');
  if (isMobile) await openAnalysis();
  await expect(page.getByText('Final sample · 24:00', { exact: true })).toBeVisible();
  await expect(measure('Modeled baseline')).toHaveText(final!);
});
