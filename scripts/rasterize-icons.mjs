import { readFile } from 'node:fs/promises';
import { chromium } from 'playwright';
const svg = await readFile('public/ember.svg', 'utf8');
const browser = await chromium.launch();
try {
  const page = await browser.newPage();
  for (const size of [192, 512]) {
    await page.setViewportSize({ width: size, height: size });
    await page.setContent('<style>html,body{margin:0;padding:0;background:#121d2d}svg{width:100vw;height:100vh;display:block}</style>' + svg);
    await page.screenshot({ path: 'public/icon-' + size + '.png' });
  }
} finally {
  await browser.close();
}
