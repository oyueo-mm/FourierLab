// Rendering performance in a real (headless) browser.  npm run build && npm run perf
// For each sample count N and circle count K: frames per second and average dynamic-layer
// draw time over a 3 s window of playback, plus the latency of a circle-count change.
// `--throttle 4` emulates a 4× slower CPU (Chrome DevTools CPU throttling).
import puppeteer from 'puppeteer-core';
import { findBrowser, serveDist, wait } from './lib.mjs';

const server = await serveDist('dist');
const browser = await puppeteer.launch({ executablePath: findBrowser(), headless: true, args: ['--no-sandbox'] });
const page = await browser.newPage();
await page.setViewport({ width: 1440, height: 1000, deviceScaleFactor: 1 });
await page.goto(server.url, { waitUntil: 'networkidle0' });
await page.evaluate(() => localStorage.clear());
await page.reload({ waitUntil: 'networkidle0' });
const throttle = process.argv.includes('--throttle') ? Number(process.argv[process.argv.indexOf('--throttle') + 1]) : 1;
if (throttle > 1) await page.emulateCPUThrottling(throttle);
console.log(`Browser: ${await browser.version()} (headless), ${await page.evaluate(() => navigator.hardwareConcurrency)} logical CPUs, CPU throttling ×${throttle}`);

const setK = async (k) => {
  await page.$eval('[data-testid="circle-input"]', (el, k) => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(el, String(k));
    el.dispatchEvent(new Event('input', { bubbles: true }));
  }, k);
  await page.focus('[data-testid="circle-input"]');
  const t0 = await page.evaluate(() => performance.now());
  await page.keyboard.press('Enter');
  // Latency: Enter → React commit → next two animation frames painted.
  return page.evaluate(
    (t0) => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(() => r(performance.now() - t0)))),
    t0,
  );
};

const measure = () =>
  page.evaluate(async () => {
    const frames = [];
    let last = performance.now();
    const t0 = last;
    await new Promise((resolve) => {
      const tick = (now) => {
        frames.push(now - last);
        last = now;
        if (now - t0 < 3000) requestAnimationFrame(tick);
        else resolve();
      };
      requestAnimationFrame(tick);
    });
    frames.shift();
    frames.sort((a, b) => a - b);
    const s = window.__FOURIERLAB__.state();
    return {
      fps: frames.length / 3,
      p95: frames[Math.floor(frames.length * 0.95)],
      drawMs: s.avgDrawMs,
    };
  });

console.log('\nN     | K     | FPS  | p95 frame (ms) | draw (ms) | K change → painted (ms)');
for (const n of [1024, 2048]) {
  await page.$$eval('summary', (els) => els.find((e) => e.textContent.includes('고급 설정'))?.click());
  await page.$$eval('[role="radio"]', (els, n) => els.find((e) => e.textContent === n.toLocaleString())?.click(), n);
  await page.$$eval('summary', (els) => els.find((e) => e.textContent.includes('고급 설정'))?.click());
  for (const k of [10, 100, 500, 1000, n - 1]) {
    const latency = await setK(k);
    await wait(700); // let the 500 ms stats window roll over
    const m = await measure();
    console.log(`${String(n).padEnd(5)} | ${String(k).padEnd(5)} | ${m.fps.toFixed(0).padStart(4)} | ${m.p95.toFixed(1).padStart(14)} | ${m.drawMs.toFixed(2).padStart(9)} | ${latency.toFixed(1).padStart(8)}`);
  }
}
await browser.close();
server.close();
