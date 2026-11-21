import { expect, test, type Page } from '@playwright/test';

async function clickMap(page: Page, x: number, y: number, touch = false) {
  const map = page.getByRole('region', { name: 'Scenario map' });
  await map.scrollIntoViewIfNeeded();
  const box = (await map.boundingBox())!;
  const [clientX, clientY] = [box.x + box.width * x, box.y + box.height * y];
  if (touch) await page.touchscreen.tap(clientX, clientY);
  else await page.mouse.click(clientX, clientY);
}

const preparedness = (page: Page, mobile: boolean) => page.getByRole('button', { name: mobile ? 'Preparedness' : 'My Preparedness Plan', exact: true }).click();
const responders = (page: Page, mobile: boolean) => page.getByRole('button', { name: mobile ? 'Responders' : 'Responder Lab', exact: true }).click();
const closeSheet = (page: Page) => page.getByRole('button', { name: 'Close sheet' }).click();

test('rehearsal storage, shared timeline and proposed line editing', async ({ page, isMobile }) => {
  await page.route('https://basemap.nationalmap.gov/**', (route) => route.abort());
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.goto('/');
  await expect(page.getByText('OFFLINE GEOGRAPHIC GRID')).toBeVisible({ timeout: 11_000 });
  if (isMobile) await expect(page.getByRole('button', { name: 'Open scenario metrics' })).toBeVisible();
  else await expect(page.getByText('Modeled footprint', { exact: true }).first()).toBeVisible();
  await preparedness(page, isMobile);
  await page.getByRole('textbox', { name: 'Place nickname' }).fill('Private campus');
  await page.getByRole('button', { name: 'Save selected place' }).click();
  await expect(page.getByRole('button', { name: 'Private campus', exact: true })).toBeVisible();
  for (const index of [0, 1]) {
    await page.getByRole('button', { name: 'Add map points' }).nth(index).click();
    await clickMap(page, .40, .52, isMobile);
    await clickMap(page, .52, .56, isMobile);
    await page.getByRole('button', { name: 'Finish sketch' }).click();
  }
  await expect(page.getByText('2 map points', { exact: true })).toHaveCount(2);
  await expect(page.getByText(/Practice path intersects|No geometric overlap/)).toHaveCount(2);
  await page.reload();
  await preparedness(page, isMobile);
  await expect(page.getByText('2 map points', { exact: true })).toHaveCount(2);
  await page.getByRole('button', { name: 'Clear', exact: true }).first().click();
  await expect(page.getByText('2 map points', { exact: true })).toHaveCount(1);
  await expect(page.getByText('No points yet')).toBeVisible();
  if (isMobile) await closeSheet(page);
  const minute = page.getByRole('slider', { name: 'Simulation minute' });
  await minute.focus();
  await page.keyboard.press('ArrowRight');
  await expect(minute).toHaveValue('40');
  await responders(page, isMobile);
  await expect(minute).toHaveValue('40');
  await expect(page.getByText('Private campus')).toHaveCount(0);
  if (isMobile) await page.getByRole('button', { name: 'Fireline tools', exact: true }).click();
  await page.getByRole('button', { name: 'Draw proposed line' }).click();
  await clickMap(page, .3, .49, isMobile);
  await clickMap(page, .55, .56, isMobile);
  await clickMap(page, .65, .61, isMobile);
  await page.getByRole('button', { name: 'Undo', exact: true }).click();
  await expect((isMobile ? page.locator('.map-action-dock') : page).getByText(/2 vertices/)).toBeVisible();
  await page.getByRole('button', { name: 'Finish', exact: true }).click();
  await page.getByRole('textbox', { name: 'Line name' }).fill('Test polyline');
  await page.getByRole('button', { name: 'Edit vertices' }).click();
  await page.getByRole('button', { name: 'Move vertex 1' }).click();
  await clickMap(page, .37, .72, isMobile);
  await page.getByRole('button', { name: 'Finish', exact: true }).click();
  await expect(page.getByRole('textbox', { name: 'Line name' })).toHaveValue('Test polyline');
  await page.getByRole('button', { name: 'Delete line' }).click();
  await expect(page.getByText('Test polyline')).toHaveCount(0);
  if (isMobile) await closeSheet(page);
  await page.getByRole('button', { name: 'Civilian', exact: true }).click();
  await preparedness(page, isMobile);
  await page.getByRole('button', { name: 'Delete Private campus' }).click();
  await expect(page.getByText('Private campus')).toHaveCount(0);
  const width = await page.evaluate(() => document.documentElement.scrollWidth);
  expect(width).toBeLessThanOrEqual(isMobile ? 390 : 1440);
  expect(errors).toEqual([]);
});

test('Nemotron drawer requires consent and displays actual API unavailable responses', async ({ page }) => {
  await page.route('**/api/agent/investigate', (route) => {
    const request = route.request().postDataJSON();
    expect(request).not.toHaveProperty('point');
    expect(request).not.toHaveProperty('places');
    return route.fulfill({ status: 503, contentType: 'application/json', body: JSON.stringify({ error: 'Test API unavailable' }) });
  });
  await page.goto('/');
  await page.getByRole('button', { name: 'Analyze with Nemotron' }).first().click();
  await expect(page.getByRole('dialog')).toBeVisible();
  await expect(page.getByRole('checkbox', { name: /Share the selected point/ })).not.toBeChecked();
  await page.getByRole('button', { name: 'Run investigation', exact: true }).click();
  await expect(page.getByText(/Unavailable · Test API unavailable/)).toBeVisible();
  await page.getByRole('button', { name: 'Close intelligence' }).click();
  await expect(page.getByRole('dialog')).toHaveCount(0);
});

test('changing the basemap keeps the simulation clock and overlays', async ({ page }) => {
  const styles: string[] = [];
  await page.route('https://tiles.openfreemap.org/styles/*', (route) => {
    const name = new URL(route.request().url()).pathname.split('/').at(-1)!;
    styles.push(name);
    return route.fulfill({ json: { version: 8, sources: {}, layers: [{ id: 'background', type: 'background',
      paint: { 'background-color': name === 'dark' ? '#101820' : '#f2ede4' } }] } });
  });
  await page.goto('/');
  await expect(page.getByText('TERRAIN · USGS')).toBeVisible();
  const minute = page.getByRole('slider', { name: 'Simulation minute' });
  await minute.focus();
  await page.keyboard.press('ArrowRight');
  await page.getByRole('button', { name: 'Map layers' }).click();
  await page.getByLabel('Basemap').selectOption('dark');
  await expect(page.getByText('DARK · OPENFREEMAP')).toBeVisible();
  await expect(page.getByRole('checkbox', { name: 'Modeled footprint' })).toBeChecked();
  await expect(minute).toHaveValue('40');
  await page.getByLabel('Basemap').selectOption('streets');
  await expect(page.getByText('STREETS · OPENFREEMAP')).toBeVisible();
  expect(styles).toEqual(['dark', 'liberty']);
});

test('official alert lookup and drill preview have distinct behavior', async ({ page, isMobile }) => {
  let lookups = 0;
  await page.route('**/api/alerts', (route) => {
    lookups++;
    expect(route.request().postDataJSON()).toEqual({ lat: 34.15, lng: -118.55 });
    return route.fulfill({ json: { status: 'ok', source: 'NWS', url: 'https://www.weather.gov/alerts',
      retrievedAt: '2026-11-21T17:34:35Z', data: [] } });
  });
  await page.goto('/');
  await page.getByRole('button', { name: 'Alerts', exact: true }).click();
  expect(lookups).toBe(0);
  await page.getByRole('button', { name: 'Check at ignition' }).click();
  await expect(page.getByText('No matching active NWS records at retrieval.')).toBeVisible();
  await page.getByRole('button', { name: 'Preview drill notification' }).click();
  const toast = page.getByRole('complementary', { name: 'Simulated drill notification' });
  await expect(toast).toContainText('DRILL — SIMULATED');
  await expect(toast).toContainText('At minute 35');
  await page.getByRole('button', { name: 'Scenario', exact: true }).click();
  if (isMobile) await closeSheet(page);
  await expect(toast).toBeVisible();
  await page.getByRole('button', { name: 'Dismiss drill notification' }).click();
  await expect(toast).toHaveCount(0);
  expect(lookups).toBe(1);
});

test('the main wind slider turns the arrow at and before the wind shift', async ({ page, isMobile }) => {
  await page.goto('/');
  const bearing = page.getByRole('slider', { name: /^Wind from/ });
  const minute = page.getByRole('slider', { name: 'Simulation minute' });
  const wind = page.getByRole('group', { name: 'Wind at current simulation time' });
  const arrow = wind.locator('[aria-hidden="true"]');
  await expect(minute).toHaveValue('35');
  const openScenario = () => page.getByRole('button', { name: 'Scenario', exact: true }).click();
  if (isMobile) await openScenario();
  await expect(bearing).toHaveValue('180');
  await expect(wind).toContainText('TOWARD 0°');
  await bearing.press('Home');
  if (isMobile) await closeSheet(page);
  await expect(wind).toContainText('FROM 0° · TOWARD 180°');
  await expect(arrow).toHaveAttribute('style', /rotate\(180deg\)/);

  await minute.press('ArrowLeft');
  await expect(wind).toContainText('TOWARD 135°');
  if (isMobile) await openScenario();
  await expect(bearing).toHaveValue('315');
  await bearing.press('ArrowRight');
  if (isMobile) await closeSheet(page);
  await expect(wind).toContainText('FROM 316° · TOWARD 136°');
  await minute.press('ArrowRight');
  await expect(wind).toContainText('TOWARD 180°');
  if (isMobile) await openScenario();
  await expect(bearing).toHaveValue('0');
});

test('Responder Lab shows line overlap and the expansion rate at the selected minute', async ({ page, isMobile }) => {
  await page.route('https://tiles.openfreemap.org/**', (route) => route.abort());
  await page.goto('/');
  await responders(page, isMobile);
  if (isMobile) {
    await page.getByRole('button', { name: 'Scenario presets' }).click();
    await page.getByRole('button', { name: /Santa Rosa Control Lines/ }).click();
  } else await page.getByRole('button', { name: 'Launch Demo' }).click();
  const metrics = isMobile ? page.getByRole('dialog', { name: 'Scenario insights' }) : page.getByRole('complementary', { name: 'Scenario metrics' });
  const minute = page.getByRole('slider', { name: 'Simulation minute' });
  const openMetrics = () => page.getByRole('button', { name: 'Open scenario metrics' }).click();
  if (isMobile) {
    await page.getByRole('button', { name: 'Map legend' }).click();
    await expect(page.getByText('Selected line inside footprint', { exact: true })).toBeVisible();
    await page.getByRole('button', { name: 'Map legend' }).click();
    await openMetrics();
  }
  const rate = metrics;
  await expect(rate.getByText('Current expansion rate')).toBeVisible();
  await expect(rate.getByText('Minutes 45–50 · modeled average')).toBeVisible();
  await expect(metrics.getByText('100.0% inside footprint')).toBeVisible();
  if (!isMobile) await expect(page.getByText('Selected line inside footprint', { exact: true })).toBeVisible();
  await metrics.getByRole('button', { name: 'Jump to first contact' }).click();
  await expect(minute).toHaveValue('20');
  await expect(rate.getByText('Minutes 20–25 · modeled average')).toBeVisible();
  if (isMobile) { await closeSheet(page); await page.getByRole('button', { name: 'Map legend' }).click(); }
  await expect(page.getByText('Perimeter intersection', { exact: true })).toBeVisible();
  if (isMobile) await page.getByRole('button', { name: 'Map legend' }).click();
  await minute.press('Home');
  if (isMobile) await openMetrics();
  await expect(metrics.getByText('0.0% inside footprint')).toBeVisible();
  if (isMobile) await closeSheet(page);
  await minute.press('End');
  if (isMobile) await openMetrics();
  await expect(rate.getByText('Last expansion rate')).toBeVisible();
  await expect(rate.getByText('Minutes 115–120 · modeled average')).toBeVisible();
});
