import { expect, test } from '@playwright/test';

test('mobile workspace uses one map and preserves workflow and investigation context', async ({ page, isMobile }) => {
  test.skip(!isMobile);
  await page.route('https://tiles.openfreemap.org/**', (route) => route.abort());
  const submitted: unknown[] = [];
  await page.route('**/api/agent/investigate', (route) => {
    submitted.push(route.request().postDataJSON());
    const event = { event: 'result', data: {
      modelId: 'browser-test-fixture', status: 'completed', live: false, summary: 'Browser flow fixture.',
      findings: [], limitations: [], numericEvidence: [], sources: [],
      toolTrace: [{ id: 'fixture', name: 'compare_hypothetical_scenarios', outcome: 'success',
        source: 'TEST FIXTURE', timestamp: '2026-11-21T18:00:00Z', durationMs: 1 }],
    } };
    return route.fulfill({ contentType: 'application/x-ndjson', body: JSON.stringify(event) + '\n' });
  });
  await page.goto('/');
  const navigation = page.getByRole('navigation', { name: 'Primary navigation' });
  await expect(navigation.getByRole('button')).toHaveCount(3);
  await expect(page.getByRole('navigation', { name: 'Workspace tools' })).toHaveCount(0);
  const map = page.getByRole('region', { name: 'Scenario map' });
  await expect(map).toHaveCount(1);
  const mapNode = await map.elementHandle();
  const initialHeight = (await map.boundingBox())!.height;
  await page.getByRole('button', { name: 'Expand map' }).tap();
  expect((await map.boundingBox())!.height).toBeGreaterThan(initialHeight);
  await expect(navigation).toBeVisible();
  await page.getByRole('button', { name: 'Return to workspace' }).tap();

  const scenario = page.getByRole('button', { name: 'Scenario', exact: true });
  await scenario.tap();
  await expect(page.getByRole('dialog', { name: 'Scenario controls' })).toBeVisible();
  await page.getByRole('button', { name: 'Place ignition' }).tap();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  const box = (await map.boundingBox())!;
  await page.touchscreen.tap(box.x + box.width * .41, box.y + box.height * .42);
  await expect(map.getByText('Custom scenario', { exact: true })).toBeVisible();
  await scenario.tap();
  const speed = page.getByRole('slider', { name: 'Wind speed', exact: true });
  await speed.press('Home');
  await speed.press('ArrowRight');
  await page.getByRole('button', { name: 'View updated map' }).tap();
  await expect(page.getByRole('group', { name: 'Wind at current simulation time' })).toContainText('1 mph');

  const minute = page.getByRole('slider', { name: 'Simulation minute' });
  await page.getByRole('button', { name: 'Play', exact: true }).tap();
  await expect(minute).not.toHaveValue('35', { timeout: 3000 });
  await page.getByRole('button', { name: 'Pause', exact: true }).tap();
  await minute.press('Home');
  await minute.press('ArrowRight');
  await navigation.getByRole('button', { name: 'Responders' }).tap();
  await expect(minute).toHaveValue('5');
  expect(await mapNode?.evaluate((node) => node.isConnected)).toBe(true);
  await page.getByRole('button', { name: 'Wind shift', exact: true }).tap();
  await expect(page.getByRole('dialog', { name: 'Wind shift' })).toContainText('Wind Shift Lab');
  await page.getByRole('button', { name: 'Close sheet' }).tap();
  await page.getByRole('button', { name: 'Analysis', exact: true }).tap();
  await expect(page.getByRole('dialog', { name: 'Scenario insights' })).toBeVisible();
  await page.getByRole('dialog').getByRole('button', { name: 'Analyze with Nemotron' }).tap();
  const question = page.getByRole('textbox', { name: 'Investigation question' });
  await question.fill('Compare firelines for the mobile check.');
  await page.getByRole('button', { name: 'Run investigation', exact: true }).tap();
  await expect(page.getByText('Browser flow fixture.')).toBeVisible();
  await page.getByText('Agent activity · 1 executed').tap();
  await expect(page.getByText('compare_hypothetical_scenarios')).toBeVisible();
  await page.getByRole('button', { name: 'Close intelligence' }).tap();
  await expect(page.getByRole('dialog', { name: 'Scenario insights' })).toBeVisible();
  await page.getByRole('button', { name: 'Close sheet' }).tap();
  await navigation.getByRole('button', { name: 'Civilian' }).tap();
  await expect(minute).toHaveValue('5');
  await navigation.getByRole('button', { name: 'Responders' }).tap();
  await page.getByRole('button', { name: 'Analyze with Nemotron' }).tap();
  await expect(question).toHaveValue('Compare firelines for the mobile check.');
  await expect(page.getByText('Browser flow fixture.')).toBeVisible();
  expect(submitted).toHaveLength(1);
  expect(submitted[0]).toMatchObject({ mode: 'responder', question: 'Compare firelines for the mobile check.' });
});

