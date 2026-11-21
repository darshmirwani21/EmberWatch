import { devices, expect, test } from '@playwright/test';

const fires = [
  ['eaton', 375, 667], ['park', 390, 844], ['mosquito', 430, 932],
] as const;

for (const [caseId, width, height] of fires) test(`draws a working ${caseId} barrier at ${width}×${height}`, async ({ browser, baseURL, isMobile }, info) => {
  test.skip(!isMobile);
  test.setTimeout(90_000);
  const page = await browser.newPage({ ...devices['iPhone 13'], viewport: { width, height }, screen: { width, height }, baseURL });
  try {
    await page.goto('/historical-replay/' + caseId);
    await expect(page.getByRole('combobox', { name: 'Historical fire' })).toHaveValue(caseId);
    await page.getByRole('button', { name: 'View replay map' }).tap();
    const dock = page.getByRole('region', { name: 'Simulation timeline' });
    const clock = dock.getByRole('slider', { name: 'Historical timeline' });
    await expect(dock.getByRole('button', { name: 'Play', exact: true })).toBeEnabled();
    await dock.getByRole('button', { name: 'Play', exact: true }).tap();
    await expect(clock).not.toHaveValue('0');
    await dock.getByRole('button', { name: 'Pause', exact: true }).tap();
    await clock.press('Home');
    await clock.press('ArrowRight');
    await dock.getByRole('button', { name: 'Practice Intervention' }).tap();
    await expect(page.getByRole('button', { name: 'Draw a line' })).toBeEnabled();
    await page.getByRole('button', { name: 'Close sheet' }).tap();
    await page.getByRole('button', { name: 'Wind shift', exact: true }).tap();
    await page.getByRole('slider', { name: 'Hypothetical wind FROM' }).press('Home');
    await page.getByRole('slider', { name: 'Hypothetical wind speed' }).press('End');
    await page.getByRole('slider', { name: 'Experiment horizon' }).press('Home');
    await page.getByRole('button', { name: 'Close sheet' }).tap();
    const map = page.getByRole('region', { name: 'Scenario map' });
    await page.getByRole('button', { name: 'Fireline tools', exact: true }).tap();
    await page.getByRole('button', { name: 'Draw a line', exact: true }).tap();
    await expect(page.getByRole('dialog')).toHaveCount(0);
    const instructions = map.getByText(/Tap the map to place fireline points/);
    await expect(instructions).toContainText('0 vertices');
    const cdp = await page.context().newCDPSession(page);
    let box = (await map.locator('canvas').boundingBox())!;
    const x = box.x + box.width * .4, y = box.y + box.height * .70;
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x, y }] });
    for (let i = 1; i <= 5; i++) await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: x + i * 6, y }] });
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
    await expect(instructions).toContainText('0 vertices');
    await map.getByRole('button', { name: 'Center on ignition' }).tap();
    await map.getByRole('button', { name: 'Zoom in' }).tap();
    await map.getByRole('button', { name: 'Zoom in' }).tap();
    await page.waitForTimeout(500);
    box = (await map.locator('canvas').boundingBox())!;
    for (const x of [.25, .5, .75]) await page.touchscreen.tap(box.x + box.width * x, box.y + box.height * .67);
    await expect(instructions).toContainText('3 vertices');
    await map.getByRole('button', { name: 'Undo', exact: true }).tap();
    await expect(instructions).toContainText('2 vertices');
    await page.touchscreen.tap(box.x + box.width * .75, box.y + box.height * .67);
    await page.screenshot({ path: info.outputPath(caseId + '-drawing.png'), scale: 'css' });
    await map.getByRole('button', { name: 'Finish line' }).tap();
    await expect(page.getByRole('button', { name: 'Drawn line', exact: true })).toBeVisible();
    await page.getByRole('button', { name: 'Run Intervention', exact: true }).tap();
    await expect(dock.getByText('Intervention ready', { exact: true })).toBeVisible({ timeout: 30_000 });
    await dock.getByRole('button', { name: 'Play', exact: true }).tap();
    await expect(clock).not.toHaveValue('0');
    await dock.getByRole('button', { name: 'Pause', exact: true }).tap();
    await clock.press('End');
    await page.getByRole('button', { name: 'Analysis', exact: true }).tap();
    const impact = page.getByText(/Difference in modeled burned area under idealized barrier assumptions/);
    await expect(impact).toBeVisible();
    expect(Number((await impact.locator('strong').textContent())!.replace(/[^.0-9-]/g, ''))).toBeGreaterThan(0);
    await page.screenshot({ path: info.outputPath(caseId + '-results.png'), scale: 'css' });
    await page.getByRole('button', { name: 'Close sheet' }).tap();
    if (caseId === 'eaton') {
      await page.getByRole('button', { name: 'Wind shift', exact: true }).tap();
      const wind = page.getByRole('slider', { name: 'Hypothetical wind FROM' });
      await wind.press('Home');
      for (let i = 0; i < 4; i++) await wind.press('PageUp');
      await page.getByRole('button', { name: 'Close sheet' }).tap();
      await expect(dock.getByText('Intervention ready', { exact: true })).toBeVisible({ timeout: 30_000 });
      await expect(clock).toHaveValue('30');
    }
    await page.getByRole('button', { name: 'Fireline tools', exact: true }).tap();
    await page.getByRole('button', { name: 'Drawn line', exact: true }).tap();
    await page.getByRole('button', { name: 'Remove line' }).tap();
    await expect(page.getByRole('button', { name: 'Run Intervention', exact: true })).toBeDisabled();
    await page.getByRole('button', { name: 'Draw a line', exact: true }).tap();
    await expect(instructions).toContainText('0 vertices');
  } finally { await page.close(); }
});
