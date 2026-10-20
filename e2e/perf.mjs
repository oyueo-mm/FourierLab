// Rendering performance in a real (headless) browser.
//   npm run build && npm run perf
//   node e2e/perf.mjs --throttle 4        4× slower CPU (DevTools CPU throttling)
//   node e2e/perf.mjs --dist <dir>        measure another build (e.g. the previous release) under /FourierLab/
//
// Per circle count K: frames per second and average dynamic-layer draw time over 3 s of playback,
// the time from applying a new K to the repainted first frame, and the synchronous React cost of a
// slider input. Then drawer open/close latency and main-thread load while playing vs. paused.
import puppeteer from 'puppeteer-core';
import { findBrowser, serveDist, wait } from './lib.mjs';

const arg = (name, fallback) => (process.argv.includes(name) ? process.argv[process.argv.indexOf(name) + 1] : fallback);
const throttle = Number(arg('--throttle', 1));
const server = await serveDist(arg('--dist', 'dist'));
const browser = await puppeteer.launch({ executablePath: findBrowser(), headless: true, args: ['--no-sandbox'] });
const page = await browser.newPage();
await page.setViewport({ width: 1440, height: 900, deviceScaleFactor: 1 });
await page.goto(server.url, { waitUntil: 'networkidle0' });
await page.evaluate(() => localStorage.clear());
await page.reload({ waitUntil: 'networkidle0' });
await wait(800);
if (throttle > 1) await page.emulateCPUThrottling(throttle);
const cdp = await page.createCDPSession();
await cdp.send('Performance.enable');
const metrics = async () => Object.fromEntries((await cdp.send('Performance.getMetrics')).metrics.map((m) => [m.name, m.value]));
const st = () => page.evaluate(() => window.__FOURIERLAB__.state());
const c0 = (await st()).canvas;
console.log(`Browser: ${await browser.version()} (headless), ${await page.evaluate(() => navigator.hardwareConcurrency)} logical CPUs, CPU throttling ×${throttle}`);
console.log(`Viewport 1440×900, animation canvas ${Math.round(c0.width)}×${Math.round(c0.height)} CSS px\n`);

const setSamples = async (n) => {
  await page.$$eval('summary', (els) => els.find((e) => e.textContent.includes('고급 설정'))?.click());
  await page.$$eval('[role="radio"]', (els, n) => els.find((e) => e.textContent === n.toLocaleString())?.click(), n);
  await page.$$eval('summary', (els) => els.find((e) => e.textContent.includes('고급 설정'))?.click());
  await wait(300);
};

const setK = async (k) => {
  await page.$eval('[data-testid="circle-input"]', (el, k) => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(el, String(k));
    el.dispatchEvent(new Event('input', { bubbles: true }));
  }, k);
  await page.focus('[data-testid="circle-input"]');
  const t0 = await page.evaluate(() => performance.now());
  await page.keyboard.press('Enter');
  // Enter → React commit → next two animation frames painted.
  return page.evaluate((t0) => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(() => r(performance.now() - t0)))), t0);
};

/** Synchronous cost of one slider input event (React state update + commit), in ms. */
const sliderInputCost = () =>
  page.evaluate(async () => {
    const el = document.querySelector('[data-testid="circle-slider"]') ?? document.querySelector('input[aria-label="원의 개수"]');
    // A value different from the current one, otherwise React does not report a change.
    const u = Number(el.value) + (Number(el.value) > 500 ? -37 : 37);
    const t0 = performance.now();
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(el, String(u));
    el.dispatchEvent(new Event('input', { bubbles: true }));
    const sync = performance.now() - t0;
    await new Promise((r) => setTimeout(r, 100));
    return sync;
  });

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
    return { fps: frames.length / 3, p95: frames[Math.floor(frames.length * 0.95)], drawMs: window.__FOURIERLAB__.state().avgDrawMs };
  });

console.log('N     | K     | FPS  | p95 frame (ms) | draw (ms) | new K → repainted (ms) | slider input (ms)');
for (const [n, ks] of [
  [1024, [3, 50, 100, 500, 1023]],
  [2048, [100, 1000, 2047]],
]) {
  await setSamples(n);
  for (const k of ks) {
    const latency = await setK(k);
    const sync = await sliderInputCost();
    await setK(k); // the slider test above changed K: restore it
    await wait(700); // let the 500 ms stats window roll over
    const m = await measure();
    console.log(`${String(n).padEnd(5)} | ${String(k).padEnd(5)} | ${m.fps.toFixed(0).padStart(4)} | ${m.p95.toFixed(1).padStart(14)} | ${m.drawMs.toFixed(2).padStart(9)} | ${latency.toFixed(1).padStart(22)} | ${sync.toFixed(1).padStart(8)}`);
  }
}

// Drawer latency and idle CPU only exist in the drawer-based UI.
if (await page.$('[data-testid="open-editor"]')) {
  await setSamples(1024);
  await setK(100);
  const raf2 = () => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
  const times = { open: [], close: [] };
  for (let i = 0; i < 5; i++) {
    const open = await page.evaluate(async () => {
      const t0 = performance.now();
      document.querySelector('[data-testid="open-editor"]').click();
      await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
      return performance.now() - t0;
    });
    await wait(400);
    const close = await page.evaluate(async () => {
      const t0 = performance.now();
      document.querySelector('[data-testid="edit-close"]').click();
      await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
      return performance.now() - t0;
    });
    await wait(400);
    times.open.push(open);
    times.close.push(close);
  }
  void raf2;
  const med = (a) => [...a].sort((x, y) => x - y)[Math.floor(a.length / 2)];
  const before = await st();
  console.log(`\nDrawer open → 2 frames painted: median ${med(times.open).toFixed(1)} ms (n=5, min ${Math.min(...times.open).toFixed(1)}, max ${Math.max(...times.open).toFixed(1)})`);
  console.log(`Drawer close → 2 frames painted: median ${med(times.close).toFixed(1)} ms (n=5, min ${Math.min(...times.close).toFixed(1)}, max ${Math.max(...times.close).toFixed(1)})`);
  const after = await st();
  console.log(`FFT runs during 5 open/close cycles: ${after.counters.spectrum - before.counters.spectrum}`);
}

// Main-thread load: share of wall time spent in tasks, while playing and while paused.
const cpu = async (label) => {
  await wait(500);
  const a = await metrics();
  await wait(3000);
  const b = await metrics();
  const busy = (b.TaskDuration - a.TaskDuration) / (b.Timestamp - a.Timestamp);
  const script = (b.ScriptDuration - a.ScriptDuration) / (b.Timestamp - a.Timestamp);
  console.log(`${label.padEnd(26)} main-thread busy ${(busy * 100).toFixed(1).padStart(5)} %   script ${(script * 100).toFixed(1).padStart(5)} %`);
};
console.log('');
if (!(await st()).playing) await page.$eval('[data-testid="play-toggle"]', (e) => e.click());
await cpu('playing (K = 100)');
await page.$eval('[data-testid="play-toggle"]', (e) => e.click());
await cpu('paused');

await browser.close();
server.close();
