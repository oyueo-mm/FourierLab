// Regenerates the screenshots used in README.md / docs (docs/images). npm run build first.
import puppeteer from 'puppeteer-core';
import { findBrowser, serveDist, wait } from './lib.mjs';
import { clickRadio, click, setRange } from './helpers.mjs';

const server = await serveDist('dist');
const browser = await puppeteer.launch({ executablePath: findBrowser(), headless: true, args: ['--no-sandbox'] });

async function fresh(viewport) {
  const page = await browser.newPage();
  await page.setViewport(viewport);
  await page.goto(server.url, { waitUntil: 'networkidle0' });
  await page.evaluate(() => localStorage.clear());
  await page.reload({ waitUntil: 'networkidle0' });
  await wait(600);
  return page;
}
const freeze = async (page, t) => {
  await click(page, '[data-testid="play-toggle"]');
  await setRange(page, '[data-testid="timeline"]', Math.round(t * 10000));
  await wait(200);
};

// Desktop: main screen, drawer, analysis
{
  const page = await fresh({ width: 1440, height: 900 });
  await click(page, '[data-testid="circles-50"]');
  await freeze(page, 0.62);
  await page.screenshot({ path: 'docs/images/desktop.png' });
  await page.click('[data-testid="open-editor"]');
  await wait(500);
  await page.screenshot({ path: 'docs/images/drawer-desktop.png' });
  await page.keyboard.press('Escape');
  await wait(500);
  await click(page, '[data-testid="preset-star"]').catch(() => {});
  await click(page, '[data-testid="circles-10"]');
  await click(page, '[data-testid="analysis-toggle"]');
  await wait(400);
  const panel = await page.$('section[aria-label="수학적 분석"]');
  await panel.screenshot({ path: 'docs/images/spectrum.png' });
  await clickRadio(page, '분석 보기', '원 개수와 오차');
  await wait(400);
  await panel.screenshot({ path: 'docs/images/error-chart.png' });
  await page.close();
}

// Phone: main screen and full-screen editor
{
  const page = await fresh({ width: 390, height: 844, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
  await click(page, '[data-testid="circles-50"]');
  await freeze(page, 0.62);
  await page.screenshot({ path: 'docs/images/mobile.png' });
  await page.$eval('[data-testid="open-editor"]', (e) => e.click());
  await wait(500);
  await page.screenshot({ path: 'docs/images/mobile-drawer.png' });
  await page.close();
}

await browser.close();
server.close();
