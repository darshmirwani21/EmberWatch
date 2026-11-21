import { expect, test } from '@playwright/test';

test('draws, registers and restores an asset on the shared map', async ({ page, isMobile }) => {
  await page.route('https://tiles.openfreemap.org/**', (route) => route.abort());
  await page.goto('/');
  const map = page.getByRole('region', { name: 'Scenario map' });
  const node = await map.elementHandle();
  await page.getByRole('button', { name: 'Business', exact: true }).click();
  if (isMobile) await page.getByRole('button', { name: 'Assets', exact: true }).tap();
  await page.getByRole('button', { name: 'Draw asset polygon' }).click();
  if (isMobile) await expect(page.getByRole('dialog')).toHaveCount(0);
  const canvas = map.locator('canvas');
  await expect(canvas).toBeVisible();
  const bounds = (await canvas.boundingBox())!;
  for (const [x, y] of [[.37, .42], [.54, .42], [.54, .55], [.37, .55]]) {
    const point = [bounds.x + bounds.width * x, bounds.y + bounds.height * y] as const;
    if (isMobile) await page.touchscreen.tap(...point);
    else await page.mouse.click(...point);
  }
  await page.getByRole('button', { name: 'Finish polygon' }).click();
  await page.getByLabel('Asset name').fill('North Test Block');
  await page.getByLabel('Asset category').fill('Timber stand');
  await page.getByLabel('Declared value (USD, optional)').fill('15000');
  await page.getByRole('button', { name: 'Register asset' }).click();
  await expect(page.getByRole('button', { name: /North Test Block.*Timber stand.*15,000/ })).toBeVisible();
  if (isMobile) await page.getByRole('button', { name: 'Close sheet' }).click();
  await page.getByRole('button', { name: 'Civilian', exact: true }).click();
  expect(await node?.evaluate((element) => element.isConnected)).toBe(true);
  await page.getByRole('button', { name: 'Business', exact: true }).click();
  await page.reload();
  if (isMobile) await page.getByRole('button', { name: 'Assets', exact: true }).tap();
  await expect(page.getByRole('button', { name: /North Test Block.*Timber stand/ })).toBeVisible();
  await page.getByRole('button', { name: 'Load fictional vineyard demo' }).click();
  await expect(map.getByText('Napa–Sonoma, California')).toBeVisible();
  const minute = page.getByRole('slider', { name: 'Simulation minute' });
  await expect(minute).toHaveValue('45');
  await page.getByRole('button', { name: 'Exposure', exact: true }).click();
  const exposure = isMobile ? page.getByRole('dialog', { name: 'Modeled exposure' }) : page.getByRole('complementary', { name: 'Scenario controls' });
  await expect(exposure.getByText('Unique acreage in footprint')).toBeVisible();
  await expect(exposure.getByText(/Fictional declared value in footprint/)).toBeVisible();
  await expect(exposure.getByText(/predicted financial loss/)).toBeVisible();
  if (isMobile) await page.getByRole('button', { name: 'Close sheet' }).click();
  await page.getByRole('button', { name: isMobile ? 'Assets' : 'Asset Registry', exact: true }).click();
  await expect(page.getByRole('button', { name: /West Pinot Block/ })).toBeVisible();
  await page.getByRole('button', { name: 'My assets' }).click();
  await expect(page.getByRole('button', { name: /North Test Block/ })).toBeVisible();
});

test('shows timestamped smoke data and sends Business context only with consent', async ({ page, isMobile }) => {
  await page.route('https://tiles.openfreemap.org/**', (route) => route.abort());
  await page.route('**/api/air-quality', (route) => route.fulfill({ json: {
    status: 'ok', retrievedAt: '2026-11-21T20:05:00Z', data: { grid: { lat: 38.3, lng: -122.4 }, hours: [
      { validAt: '2026-11-21T20:00:00Z', pm25: 2.6 }, { validAt: '2026-11-21T21:00:00Z', pm25: null },
    ], wind: { speedMph: 11, fromDeg: 270, validAt: '2026-11-21T20:00:00Z' } },
  } }));
  const requests: { business: { minute: number; assets?: unknown[] } }[] = [];
  await page.route('**/api/agent/investigate', (route) => {
    requests.push(route.request().postDataJSON());
    return route.fulfill({ contentType: 'application/x-ndjson', body: JSON.stringify({ event: 'result', data: {
      live: false, status: 'completed', summary: 'Business tool fixture.', findings: [], limitations: [], numericEvidence: [], sources: [],
      toolTrace: [{ id: 'asset-tool', name: 'analyze_business_exposure', outcome: 'success', source: 'TEST FIXTURE', durationMs: 1, timestamp: '2026-11-21T20:05:00Z' }],
      businessExposure: { scenario: 'Scenario A', minute: 45, fictionalAssets: true, rows: [
        { ref: 'Asset 1', name: 'West Pinot Block', fictional: true, areaAcres: 4, affectedAcres: 2, firstContact: { from: 20, to: 25 }, declaredValueInFootprint: 1000 },
      ] },
    } }) + '\n' });
  });
  await page.goto('/');
  await page.getByRole('button', { name: 'Business', exact: true }).click();
  if (isMobile) await page.getByRole('button', { name: 'Assets', exact: true }).tap();
  await page.getByRole('button', { name: 'Load fictional vineyard demo' }).click();
  await page.getByRole('button', { name: isMobile ? 'Smoke' : 'Smoke Monitoring', exact: true }).click();
  await page.getByRole('button', { name: 'Fetch regional forecast' }).click();
  await expect(page.getByText('2.6 µg/m³', { exact: true })).toBeVisible();
  await expect(page.getByText('Unavailable', { exact: true })).toBeVisible();
  await expect(page.getByText(/11 mph FROM 270/)).toBeVisible();
  await expect(page.getByText(/cannot reliably determine vineyard smoke exposure/)).toBeVisible();
  if (isMobile) await page.getByRole('button', { name: 'Close sheet' }).click();
  await page.getByRole('button', { name: 'Analyze with Nemotron' }).first().click();
  const dialog = page.getByRole('dialog', { name: 'Nemotron Business Analyst' });
  await dialog.getByRole('button', { name: 'Run investigation', exact: true }).click();
  await expect(dialog.getByText('Business tool fixture.')).toBeVisible();
  expect(requests[0].business).toEqual({ minute: 45 });
  await dialog.getByRole('checkbox', { name: /Share asset outlines/ }).check();
  await dialog.getByRole('button', { name: 'Run investigation again' }).click();
  await expect(dialog.getByText('Verified asset summary')).toBeVisible();
  await expect(dialog.getByText('West Pinot Block · Asset 1 · fictional')).toBeVisible();
  expect(requests[1].business.assets).toHaveLength(6);
  if (isMobile) await dialog.getByText('Agent activity · 1 executed').tap();
  await expect(dialog.getByText('analyze_business_exposure', { exact: true })).toBeVisible();
});

