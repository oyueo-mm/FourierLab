// Ad-hoc screenshots of the built app: node e2e/shot.mjs [width] [height] [name]
import puppeteer from 'puppeteer-core';
import { findBrowser, serveDist, wait } from './lib.mjs';

const [w = 1440, h = 1000, name = 'desktop'] = process.argv.slice(2);
const server = await serveDist('dist');
const browser = await puppeteer.launch({ executablePath: findBrowser(), headless: true, args: ['--no-sandbox'] });
const page = await browser.newPage();
await page.setViewport({ width: Number(w), height: Number(h), deviceScaleFactor: 1 });
const logs = [];
page.on('console', (m) => logs.push(`${m.type()}: ${m.text()}`));
page.on('pageerror', (e) => logs.push(`pageerror: ${e.message}`));
await page.goto(server.url, { waitUntil: 'networkidle0' });
await wait(2500);
await page.screenshot({ path: `e2e/out/${name}.png`, fullPage: true });
console.log(JSON.stringify(await page.evaluate(() => window.__FOURIERLAB__?.state()), null, 1));
console.log(logs.join('\n'));
await browser.close();
server.close();
