import { expect, test, type Page } from '@playwright/test';

async function respond(page: Page, isMobile: boolean) {
  await page.getByRole('button', { name: isMobile ? 'Responders' : 'Responder Lab', exact: true }).click();
}
async function replay(page: Page) {
  await page.getByRole('button', { name: 'Historical Replay', exact: true }).click();
}
const controlPanel = (page: Page, mobile: boolean) => mobile ?
  page.getByRole('dialog', { name: 'Historical Replay' }) : page.getByRole('complementary', { name: 'Scenario controls' });
const closeSheet = async (page: Page, mobile: boolean) => { if (mobile) await page.getByRole('button', { name: 'Close sheet' }).click(); };

test('shares the Terrain map across workspaces and restores the hypothetical view after replay', async ({ page, isMobile }) => {
  let terrainRequests = 0;
  page.on('request', (request) => { if (request.url().includes('USGSTopo/MapServer/tile/')) terrainRequests++; });
  await page.goto('/');
  const map = page.getByRole('region', { name: 'Scenario map' });
  await expect(map.getByText('TERRAIN · USGS', { exact: true })).toBeVisible();
  const canvas = await map.locator('canvas').elementHandle();
  expect(canvas).toBeTruthy();
  expect(terrainRequests).toBeGreaterThan(0);
  await expect(page.getByRole('button', { name: 'Historical Replay', exact: true })).toHaveCount(0);
  await page.getByRole('button', { name: 'Business', exact: true }).click();
  await expect(map.getByText('TERRAIN · USGS', { exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Historical Replay', exact: true })).toHaveCount(0);
  await respond(page, isMobile);
  await expect(page.getByRole('button', { name: 'Compare', exact: true })).toHaveCount(0);
  const minute = page.getByRole('slider', { name: 'Simulation minute' });
  await minute.press('Home');
  await minute.press('ArrowRight');
  await page.getByRole('button', { name: 'Map layers' }).click();
  await page.getByRole('checkbox', { name: '300 m proximity outline' }).uncheck();
  await page.getByRole('button', { name: 'Map layers' }).click();
  const scale = map.locator('.maplibregl-ctrl-scale');
  const initialScale = await scale.textContent();
  await page.getByRole('button', { name: 'Zoom in', exact: true }).click();
  await expect(scale).not.toHaveText(initialScale!);
  await page.waitForTimeout(500);
  const before = await scale.textContent();
  const originalUrl = page.url();
  await replay(page);
  const controls = controlPanel(page,isMobile);
  await expect(controls.getByRole('combobox', { name: 'Historical fire' })).toHaveValue('eaton');
  await expect(controls.getByRole('heading', { name: 'Historical ignition' })).toBeVisible();
  await closeSheet(page,isMobile);
  await expect(page.getByRole('region', { name: 'Scenario map' })).toHaveCount(1);
  expect(await canvas!.evaluate((node) => node.isConnected)).toBe(true);
  expect(page.url()).toBe(originalUrl);
  await expect(map.getByText('Eaton Fire · 2025', { exact: true })).toBeVisible();
  await expect(map.getByText('TERRAIN · USGS', { exact: true })).toBeVisible();
  await expect(scale).not.toHaveText(before!);
  if (isMobile) await page.getByRole('button', { name: 'Replay controls' }).click();
  await controls.getByRole('button', { name: 'Return to hypothetical scenario' }).click();
  await expect(minute).toHaveValue('5');
  await expect(scale).toHaveText(before!);
  await page.getByRole('button', { name: 'Map layers' }).click();
  await expect(page.getByRole('checkbox', { name: '300 m proximity outline' })).not.toBeChecked();
  expect(await canvas!.evaluate((node) => node.isConnected)).toBe(true);
});

test('plays from ignition with aligned weather and presents recorded and archive outlines separately', async ({ page, isMobile }) => {
  test.setTimeout(65_000);
  await page.goto('/historical-replay/park');
  const controls = controlPanel(page,isMobile);
  const fire = controls.getByRole('combobox', { name: 'Historical fire' });
  const map = page.getByRole('region', { name: 'Scenario map' });
  const dock = page.getByRole('region', { name: 'Simulation timeline' });
  const weather = dock.locator('.timeline-end');
  const clock = dock.getByRole('slider', { name: 'Historical timeline' });
  await expect(fire).toHaveValue('park');
  await expect(page).toHaveURL(/\?tab=replay&fire=park$/);
  await expect(controls.getByText(/Approximate WFIGS origin 39.819°/)).toBeVisible();
  await expect(controls.getByText(/2 time-stamped surveys/)).toBeVisible();
  await expect(clock).toHaveAttribute('aria-valuetext', /Jul 24, 2024, 2:52 PM PDT/);
  const parkWeather = await weather.textContent();
  await fire.selectOption('mosquito');
  await expect(controls.getByText(/No time-stamped perimeter progression/)).toBeVisible();
  await expect(clock).toHaveAttribute('aria-valuetext', /Sep 6, 2022, 6:00 PM PDT/);
  await expect(weather).not.toHaveText(parkWeather!);
  await closeSheet(page,isMobile);
  await expect(dock.getByRole('button', { name: 'Play', exact: true })).toBeEnabled();
  await dock.getByRole('button', { name: 'Play', exact: true }).click();
  await expect(clock).not.toHaveValue('0');
  await dock.getByRole('button', { name: 'Pause', exact: true }).click();
  await expect(dock.getByText('Modeled Historical Reconstruction', { exact: true })).toBeVisible();
  await dock.getByRole('button', { name: 'Restart timeline' }).click();
  await expect(clock).toHaveValue('0');
  if (isMobile) await dock.getByRole('button', { name: 'Replay controls' }).click();
  await controls.getByRole('combobox', { name: 'Archive outline overlay' }).selectOption({ index: 1 });
  await expect(controls.locator('p').filter({ hasText: /Archive · observation time unavailable/ })).toBeVisible();
  await fire.selectOption('eaton');
  await expect(controls.getByText(/1 time-stamped survey/)).toBeVisible({ timeout: 15_000 });
  await expect(clock).toHaveAttribute('aria-valuetext', /Jan 7, 2025, 6:18 PM PST/);
  const initial = await weather.textContent();
  await closeSheet(page,isMobile);
  await dock.getByRole('combobox', { name: 'Playback speed' }).selectOption('4');
  await dock.getByRole('button', { name: 'Play', exact: true }).click();
  await expect(weather).not.toHaveText(initial!, { timeout: 15_000 });
  await dock.getByRole('button', { name: 'Pause', exact: true }).click();
  await clock.press('Home');
  await expect(weather).toHaveText(initial!);
  await clock.press('End');
  await expect(clock).toHaveAttribute('aria-valuetext', /Jan 10, 2025, 6:22 AM PST/);
  await expect(dock.getByText('Recorded perimeter', { exact: true })).toBeVisible();
  await map.getByRole('button', { name: 'Map layers' }).click();
  const observedLayer = map.getByRole('checkbox', { name: 'Historical perimeter', exact: true });
  await observedLayer.uncheck();
  await dock.getByRole('button', { name: 'Restart timeline' }).focus();
  await map.getByRole('combobox', { name: 'Basemap' }).selectOption('hybrid');
  await expect(observedLayer).not.toBeChecked();
  await observedLayer.check();
  await expect(map.getByRole('combobox', { name: 'Basemap' })).toHaveValue('hybrid');
});

test('keeps a historical branch and its lines across responder tools', async ({ page, isMobile }) => {
  test.setTimeout(65_000);
  await page.route('**/api/agent/history', async (route) => {
    expect(route.request().postDataJSON()).toMatchObject({ caseId: 'eaton', replayAt: '2025-01-10T14:22:09.000Z', practicing: true, workflow: 'barrier', minute: 0 });
    return route.fulfill({ contentType: 'application/x-ndjson', body: JSON.stringify({ event: 'result', data: {
      status: 'completed', model: 'browser-test-fixture', live: false, detail: 'Replay fixture.', candidates: [], evidence: [],
      trace: [{ id: '1', outcome: 'success', name: 'retrieve_historical_fire', source: 'Fixture', timestamp: '2025-01-10T14:22:09.000Z' }],
    } }) + '\n' });
  });
  await page.goto('/');
  await respond(page,isMobile);
  await replay(page);
  const panel = controlPanel(page,isMobile);
  await panel.getByRole('combobox', { name: 'Jump to recorded survey' }).selectOption('firis-survey');
  await closeSheet(page,isMobile);
  await page.getByRole('button', { name: 'Practice Intervention', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Intervention firelines' })).toBeVisible();
  await closeSheet(page,isMobile);
  await page.getByRole('button', { name: /Wind Shift/i }).click();
  await expect(page.getByRole('heading', { name: 'Intervention wind' })).toBeVisible();
  await page.getByRole('slider', { name: /Hypothetical wind FROM/ }).press('End');
  await closeSheet(page,isMobile);
  await page.getByRole('button', { name: 'Fireline Intelligence', exact: true }).click();
  await page.getByRole('button', { name: 'Generate lines' }).click();
  await expect(page.getByRole('button', { name: 'Crosswind transect', exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Draw a line', exact: true }).click();
  const map = page.getByRole('region', { name: 'Scenario map' });
  const box = (await map.locator('canvas').boundingBox())!;
  for (const [x, y] of [[.43,.56],[.47,.59],[.51,.61]]) {
    if (isMobile) await page.touchscreen.tap(box.x + box.width * x, box.y + box.height * y);
    else await page.mouse.click(box.x + box.width * x, box.y + box.height * y);
  }
  await page.getByRole('button', { name: 'Finish line', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Drawn line', exact: true })).toBeVisible();
  const lengthLabel = page.getByText(/^Length .* m$/);
  const oldLength = await lengthLabel.textContent();
  await page.getByRole('button', { name: 'Edit vertices', exact: true }).click();
  await page.getByRole('button', { name: 'Vertex 2', exact: true }).click();
  const editBox = (await map.locator('canvas').boundingBox())!;
  if (isMobile) await page.touchscreen.tap(editBox.x + editBox.width * .47, editBox.y + editBox.height * .565);
  else await page.mouse.click(editBox.x + editBox.width * .47, editBox.y + editBox.height * .565);
  await page.getByRole('button', { name: 'Finish line', exact: true }).click();
  await expect(lengthLabel).not.toHaveText(oldLength!);
  await page.getByRole('button', { name: 'Run Intervention', exact: true }).click();
  await expect(page.getByText('Intervention ready', { exact: true })).toBeVisible({ timeout: 20_000 });
  await page.getByRole('button', { name: 'Analysis', exact: true }).click();
  if (isMobile) await expect(page.getByText('Model-to-model IoU', { exact: true })).toBeVisible();
  else await expect(page.getByRole('complementary', { name: 'Scenario controls' }).getByText('Model-to-model IoU', { exact: true })).toBeVisible();
  await page.getByText('Historical validation and assumptions', { exact: true }).click();
  await expect(page.getByText(/No independent time-stamped perimeter matches/)).toBeVisible();
  await closeSheet(page,isMobile);
  await page.getByRole('button', { name: 'Fireline Intelligence', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Drawn line', exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Crosswind transect', exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Ask Nemotron' }).click();
  await page.getByRole('button', { name: 'Run replay investigation' }).click();
  await expect(page.getByText('Replay fixture.', { exact: true })).toBeVisible();
  await page.getByText('Agent activity · 1 executed', { exact: true }).click();
  await expect(page.getByText('retrieve_historical_fire', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Close replay analyst' }).click();
  await page.getByRole('button', { name: 'Return to replay', exact: true }).click();
  await expect(page.getByRole('slider', { name: 'Historical timeline' })).toHaveAttribute('aria-valuetext', /Jan 10, 2025, 6:22 AM PST/);
  const fires = controlPanel(page,isMobile).getByRole('combobox', { name: 'Historical fire' });
  await fires.selectOption('park');
  await expect(page.getByRole('slider', { name: 'Historical timeline' })).toHaveValue('0');
  await fires.selectOption('eaton');
  await controlPanel(page,isMobile).getByRole('button', { name: 'Resume saved practice' }).click();
  await expect(page.getByRole('button', { name: 'Drawn line', exact: true })).toBeVisible();
});

