// Ad-hoc screenshots of the built app.
//   node e2e/shot.mjs <name> <width> <height> [--mobile] [--drawer] [--more] [--full]
import puppeteer from 'puppeteer-core';
import { findBrowser, serveDist, wait } from './lib.mjs';

const [name = 'shot', w = '1440', h = '900', ...flags] = process.argv.slice(2);
const mobile = flags.includes('--mobile');
const server = await serveDist('dist');
const browser = await puppeteer.launch({ executablePath: findBrowser(), headless: true, args: ['--no-sandbox'] });
const page = await browser.newPage();
await page.setViewport({ width: Number(w), height: Number(h), deviceScaleFactor: mobile ? 2 : 1, isMobile: mobile, hasTouch: mobile });
const logs = [];
page.on('console', (m) => ['error', 'warn', 'warning'].includes(m.type()) && logs.push(`${m.type()}: ${m.text()}`));
page.on('pageerror', (e) => logs.push(`pageerror: ${e.message}`));
await page.goto(server.url, { waitUntil: 'networkidle0' });
await page.evaluate(() => localStorage.clear());
await page.reload({ waitUntil: 'networkidle0' });
await wait(1800);
if (flags.includes('--more')) await page.$eval('[data-testid="dock-more-toggle"]', (e) => e.click());
if (flags.includes('--drawer')) {
  await page.$eval('[data-testid="open-editor"]', (e) => e.click());
  await wait(500);
}
await page.screenshot({ path: `e2e/out/${name}.png`, fullPage: flags.includes('--full') });
const st = await page.evaluate(() => window.__FOURIERLAB__.state());
console.log(JSON.stringify({ canvas: st.canvas, view: st.view?.zoom, fps: Math.round(st.fps), counters: st.counters }));
console.log(logs.join('\n'));
await browser.close();
server.close();
