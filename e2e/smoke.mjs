// Browser regression test of the built app (real Chromium/Edge via puppeteer-core).
//
//   npm run build && npm run e2e         → serves ./dist like GitHub Pages (/FourierLab/) and tests it
//   npm run e2e -- --url <URL>           → tests a deployed site instead
//
// Exit code is non-zero when any check fails, so CI can gate the deployment on it.

import fs from 'node:fs';
import path from 'node:path';
import puppeteer from 'puppeteer-core';
import { findBrowser, serveDist, wait } from './lib.mjs';

const argUrl = process.argv.includes('--url') ? process.argv[process.argv.indexOf('--url') + 1] : null;
const server = argUrl ? null : await serveDist('dist');
const URL_ = argUrl ?? server.url;
const OUT = path.resolve('e2e/out');
const DOWNLOADS = path.join(OUT, 'downloads');
fs.rmSync(DOWNLOADS, { recursive: true, force: true });
fs.mkdirSync(DOWNLOADS, { recursive: true });

const browser = await puppeteer.launch({
  executablePath: findBrowser(),
  headless: true,
  args: ['--no-sandbox', '--disable-dev-shm-usage'],
});

let failed = 0;
const problems = [];
const check = (name, ok, detail = '') => {
  if (!ok) failed++;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? `  — ${detail}` : ''}`);
};

async function open(viewport) {
  const page = await browser.newPage();
  await page.setViewport(viewport);
  page.on('console', (m) => {
    if (!['error', 'warn', 'warning'].includes(m.type())) return;
    // Raised by this test's own pixel reads; the app never reads canvases back.
    if (/willReadFrequently/.test(m.text())) return;
    problems.push(`console.${m.type()}: ${m.text()}`);
  });
  page.on('pageerror', (e) => problems.push(`pageerror: ${e.message}`));
  page.on('requestfailed', (r) => problems.push(`requestfailed: ${r.url()} (${r.failure()?.errorText})`));
  page.on('response', (r) => {
    if (r.status() >= 400) problems.push(`HTTP ${r.status()}: ${r.url()}`);
  });
  const cdp = await page.createCDPSession();
  await cdp.send('Browser.setDownloadBehavior', { behavior: 'allow', downloadPath: DOWNLOADS, eventsEnabled: true });
  return page;
}

const state = (page) => page.evaluate(() => window.__FOURIERLAB__.state());
const click = (page, sel) => page.$eval(sel, (el) => el.click());

/** Sets a React-controlled range input and fires the input event React listens to. */
const setRange = (page, sel, value) =>
  page.$eval(
    sel,
    (el, v) => {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(el, String(v));
      el.dispatchEvent(new Event('input', { bubbles: true }));
    },
    value,
  );

/** Fraction of sampled pixels in a canvas that are not plain white (i.e. something is drawn). */
const inkFraction = (page, sel) =>
  page.$eval(sel, (c) => {
    const ctx = c.getContext('2d');
    const d = ctx.getImageData(0, 0, c.width, c.height).data;
    let ink = 0;
    let n = 0;
    for (let i = 0; i < d.length; i += 4 * 97) {
      n++;
      if (d[i + 3] > 0 && (d[i] < 235 || d[i + 1] < 235 || d[i + 2] < 235)) ink++;
    }
    return ink / n;
  });

/** Pixel of the dynamic canvas at CSS position (x, y). */
const pixelAt = (page, x, y) =>
  page.$eval(
    '[data-testid="viz-canvas"]',
    (c, x, y) => {
      const s = c.width / c.getBoundingClientRect().width;
      return Array.from(c.getContext('2d').getImageData(Math.round(x * s), Math.round(y * s), 1, 1).data);
    },
    x,
    y,
  );

/** Screen position of a world point under the current view (same formula as src/core/view.ts). */
const toScreen = (st, [x, y]) => {
  const s = st.view.pixelsPerUnit;
  return [st.canvas.width / 2 + (x - st.view.cx) * s, st.canvas.height / 2 - (y - st.view.cy) * s];
};

function waitForDownload(name, timeout = 8000) {
  const file = path.join(DOWNLOADS, name);
  const start = Date.now();
  return new Promise((resolve) => {
    const poll = () => {
      if (fs.existsSync(file) && fs.statSync(file).size > 0 && !fs.existsSync(`${file}.crdownload`)) return resolve(file);
      if (Date.now() - start > timeout) return resolve(null);
      setTimeout(poll, 100);
    };
    poll();
  });
}

const pngSize = (file) => {
  const b = fs.readFileSync(file);
  const sig = b.subarray(0, 8).toString('hex') === '89504e470d0a1a0a';
  return { sig, width: b.readUInt32BE(16), height: b.readUInt32BE(20) };
};

// ───────────────────────────── desktop ─────────────────────────────
{
  const page = await open({ width: 1440, height: 1000 });
  await page.goto(URL_, { waitUntil: 'networkidle0' });
  await page.evaluate(() => localStorage.clear());
  await page.reload({ waitUntil: 'networkidle0' });
  await wait(600);

  let st = await state(page);
  check('loads with the heart example playing', st.source === 'heart' && st.playing === true, `source=${st.source} playing=${st.playing}`);
  check('static layer is painted (no black/blank canvas)', (await inkFraction(page, 'canvas[aria-hidden="true"]')) > 0.005);
  const bg = await page.$eval('canvas[aria-hidden="true"]', (c) => Array.from(c.getContext('2d').getImageData(2, 2, 1, 1).data));
  check('canvas background is white, not black', bg[0] > 240 && bg[1] > 240 && bg[2] > 240 && bg[3] === 255, bg.join(','));

  // 1–3. Circle example → reconstruct → circles rotate.
  await click(page, '[data-testid="preset-circle"]');
  await wait(300);
  st = await state(page);
  check('circle preset analysed and restarted', st.source === 'circle' && st.t < 0.1, `t=${st.t.toFixed(3)}`);
  const t0 = st.t;
  const tip0 = st.tipScreen;
  await wait(700);
  st = await state(page);
  const moved = Math.hypot(st.tipScreen[0] - tip0[0], st.tipScreen[1] - tip0[1]);
  check('epicycles rotate (time advances, pen tip moves)', st.t > t0 && moved > 5, `Δt=${(st.t - t0).toFixed(3)} moved=${moved.toFixed(1)}px`);
  check('dynamic layer shows circles and trail', (await inkFraction(page, '[data-testid="viz-canvas"]')) > 0.001);

  // 4–5. Circle counts 1, 10, 50, 100: error falls, circle is exact with one term.
  const rel = {};
  for (const k of [1, 10, 50, 100]) {
    await click(page, `[data-testid="circles-${k}"]`);
    await wait(120);
    st = await state(page);
    rel[k] = st.relativeRmse;
    check(`circle count ${k} applied`, st.circleCount === k);
  }
  check('circle preset: one circle reconstructs it (relative RMSE < 0.1%)', rel[1] < 1e-3, `rel=${rel[1].toExponential(2)}`);

  await click(page, '[data-testid="preset-heart"]');
  const heart = {};
  for (const k of [1, 10, 50, 100]) {
    await click(page, `[data-testid="circles-${k}"]`);
    await wait(120);
    heart[k] = (await state(page)).relativeRmse;
  }
  check(
    'heart: error shrinks as circles are added (1 → 10 → 50 → 100)',
    heart[1] > heart[10] && heart[10] > heart[50] && heart[50] > heart[100],
    Object.entries(heart).map(([k, v]) => `K=${k}: ${(v * 100).toPrecision(3)}%`).join(', '),
  );
  const shownRmse = await page.$eval('[data-testid="stat-rmse"]', (el) => el.textContent);
  check('RMSE overlay matches the analysis', shownRmse.startsWith(((await state(page)).rmse).toPrecision(3)), shownRmse);

  // The drawn pen tip sits exactly at ẑ(t) from the math module.
  await click(page, '[data-testid="play-toggle"]');
  await wait(100);
  st = await state(page);
  const expected = toScreen(st, st.tipWorld);
  const tipErr = Math.hypot(expected[0] - st.tipScreen[0], expected[1] - st.tipScreen[1]);
  check('drawn pen tip = math reconstruction ẑ(t) (screen distance < 0.01 px)', tipErr < 0.01, `${tipErr.toExponential(2)} px`);
  const px = await pixelAt(page, st.tipScreen[0], st.tipScreen[1]);
  check('tip pixel has the tip colour (rose)', px[0] > 180 && px[1] < 100 && px[2] < 140, px.join(','));

  // 7. Pause: time stands still and no frames are spent.
  check('pause stops playback', st.playing === false);
  const tp = st.t;
  await wait(500);
  st = await state(page);
  check('paused time does not advance', st.t === tp);

  // 8. Timeline seek (forwards and backwards) gives the exact state at that time.
  await setRange(page, '[data-testid="timeline"]', 7500);
  await wait(80);
  st = await state(page);
  const atSeek = toScreen(st, st.tipWorld);
  check(
    'timeline seek to 0.75 positions the tip exactly',
    Math.abs(st.t - 0.75) < 1e-9 && Math.hypot(atSeek[0] - st.tipScreen[0], atSeek[1] - st.tipScreen[1]) < 0.01,
  );
  await setRange(page, '[data-testid="timeline"]', 2500);
  await wait(80);
  st = await state(page);
  check('timeline seek backwards to 0.25', Math.abs(st.t - 0.25) < 1e-9);
  await click(page, 'button[aria-label="한 단계 진행"]');
  st = await state(page);
  check('single step advances by 1/N', Math.abs(st.t - (0.25 + 1 / st.sampleCount)) < 1e-9);

  // 6. Speed slider: real-time progress rate follows the speed (1× = 10 s per drawing).
  await setRange(page, 'input[aria-label="재생 속도"]', Math.log(20) / Math.log(50)); // 2×
  await wait(80);
  st = await state(page);
  check('speed slider sets 2×', Math.abs(st.speed - 2) < 0.01, `speed=${st.speed}`);
  const s1 = await page.evaluate(async () => {
    const s = window.__FOURIERLAB__.state;
    document.querySelector('[data-testid="play-toggle"]').click();
    await new Promise((r) => setTimeout(r, 150));
    const a = s().t;
    const ta = performance.now();
    await new Promise((r) => setTimeout(r, 1000));
    const b = s().t;
    return { rate: (((b - a + 1) % 1) / (performance.now() - ta)) * 1000 };
  });
  check('playback rate ≈ speed / 10 s (2× → 0.2 per second, ±15%)', Math.abs(s1.rate - 0.2) < 0.03, `${s1.rate.toFixed(3)}/s`);

  // Selection mode, display toggles.
  await page.$$eval('[role="radio"]', (els) => els.find((e) => e.textContent === '저주파부터' && e.closest('[aria-label="성분 선택 방식"]'))?.click());
  await wait(80);
  check('selection mode switches to low-frequency-first', (await state(page)).selectionMode === 'frequency');
  await page.$$eval('[aria-label="표시 항목"] button[aria-pressed]', (els) => els.find((e) => e.textContent.trim() === '원')?.click());
  await wait(80);
  check('circle display toggles off', (await state(page)).display.circles === false);
  await page.$$eval('[aria-label="표시 항목"] button[aria-pressed]', (els) => els.find((e) => e.textContent.trim() === '원')?.click());

  // Selecting a circle by clicking it on the canvas.
  await click(page, '[data-testid="preset-circle"]');
  await click(page, '[data-testid="circles-1"]');
  await click(page, '[data-testid="play-toggle"]');
  await setRange(page, '[data-testid="timeline"]', 0);
  await wait(100);
  st = await state(page);
  {
    // At t = 0 the single arm points along +x from the DC centre; click the ring opposite to it.
    const s = st.view.pixelsPerUnit;
    const [cx, cy] = toScreen(st, [0, 0]);
    const rect = await page.$eval('[data-testid="viz-canvas"]', (c) => c.getBoundingClientRect().toJSON());
    await page.mouse.click(rect.x + cx - 0.7 * s, rect.y + cy);
    await wait(150);
    st = await state(page);
    check('clicking a circle selects its component (k = +1)', st.selectedK === 1, `selectedK=${st.selectedK}`);
    const info = await page.$eval('[data-testid="component-info"]', (el) => el.textContent).catch(() => '');
    check('component card shows frequency, direction', info.includes('k = +1') && info.includes('반시계'), info.slice(0, 60));
  }

  // 12. Zoom: buttons and mouse wheel.
  const z0 = (await state(page)).view.zoom;
  await click(page, 'button[aria-label="확대"]');
  const z1 = (await state(page)).view.zoom;
  const rect = await page.$eval('[data-testid="viz-canvas"]', (c) => c.getBoundingClientRect().toJSON());
  await page.mouse.move(rect.x + rect.width / 2, rect.y + rect.height / 2);
  await page.mouse.wheel({ deltaY: 300 });
  await wait(100);
  const z2 = (await state(page)).view.zoom;
  check('zoom in button and wheel zoom work', z1 > z0 && z2 < z1, `${z0.toFixed(2)} → ${z1.toFixed(2)} → ${z2.toFixed(2)}`);
  await page.mouse.move(rect.x + 100, rect.y + 100);
  await page.mouse.down();
  await page.mouse.move(rect.x + 180, rect.y + 140, { steps: 5 });
  await page.mouse.up();
  st = await state(page);
  check('drag pans the view', Math.abs(st.view.cx) > 1e-3 && Math.abs(st.view.cy) > 1e-3);
  await click(page, 'button[aria-label="원점 복귀 (기본 보기)"]');
  st = await state(page);
  check('reset view returns to origin', st.view.cx === 0 && st.view.cy === 0 && st.view.zoom === 1);

  // 9. Full reset.
  await page.$$eval('button', (els) => els.find((e) => e.textContent.trim() === '전체 초기화')?.click());
  await wait(150);
  st = await state(page);
  check('full reset restores defaults (heart, 64 circles, 1×)', st.source === 'heart' && st.circleCount === 64 && st.speed === 1);

  // Input error handling: a click (single point) and a tiny stroke are rejected with a message.
  const dRect = await page.$eval('[data-testid="drawing-canvas"]', (c) => c.getBoundingClientRect().toJSON());
  await page.mouse.click(dRect.x + 100, dRect.y + 100);
  await wait(100);
  let notice = await page.$eval('[data-testid="notice"]', (el) => el.textContent).catch(() => '');
  check('single click is rejected with a clear message', notice.includes('점 하나만'), notice);
  await page.mouse.move(dRect.x + 100, dRect.y + 100);
  await page.mouse.down();
  await page.mouse.move(dRect.x + 102, dRect.y + 101, { steps: 3 });
  await page.mouse.up();
  await wait(100);
  notice = await page.$eval('[data-testid="notice"]', (el) => el.textContent).catch(() => '');
  check('very short stroke is rejected with a clear message', notice.includes('너무 짧습니다'), notice);
  check('rejected input leaves the analysis untouched', (await state(page)).source === 'heart');

  // 10–11. Draw a heart with the mouse, then reconstruct it.
  {
    const half = Math.min(dRect.width, dRect.height) / 2;
    const pts = [];
    for (let i = 0; i <= 240; i++) {
      const t = (2 * Math.PI * i) / 240;
      const x = (16 * Math.sin(t) ** 3) / 22;
      const y = (13 * Math.cos(t) - 5 * Math.cos(2 * t) - 2 * Math.cos(3 * t) - Math.cos(4 * t)) / 22 + 0.08;
      pts.push([dRect.x + dRect.width / 2 + x * half, dRect.y + dRect.height / 2 - y * half]);
    }
    await page.mouse.move(pts[0][0], pts[0][1]);
    await page.mouse.down();
    for (const [x, y] of pts.slice(1)) await page.mouse.move(x, y);
    await page.mouse.up();
    await wait(150);
    st = await state(page);
    check('mouse-drawn stroke is captured and pending', st.pending === true && st.drawingPoints > 150, `points=${st.drawingPoints}`);
    const idBefore = st.analysisId;
    await click(page, '[data-testid="run"]');
    await wait(300);
    st = await state(page);
    check('reconstruct starts the Fourier animation of the drawing', st.analysisId === idBefore + 1 && st.source === 'user' && !st.pending && st.playing);
    check('hand-drawn heart reconstructs with < 2% relative error at 64 circles', st.relativeRmse < 0.02, `${(st.relativeRmse * 100).toFixed(3)}%`);
  }

  // Undo / redo of strokes.
  await click(page, 'button[aria-label="실행 취소 (Ctrl+Z)"]');
  st = await state(page);
  check('undo restores the previous drawing', st.pending === true);
  await click(page, 'button[aria-label="다시 실행 (Ctrl+Y)"]');
  st = await state(page);
  check('redo brings the stroke back', st.pending === false);

  // 13. PNG export (current view and fitted reconstruction).
  await click(page, '[data-testid="export-menu"]');
  await click(page, '[data-testid="export-current"]');
  let file = await waitForDownload('fourierlab-view.png');
  if (file) {
    const p = pngSize(file);
    const c = await state(page);
    check('PNG export (current view) downloads a valid image of the canvas size', p.sig && p.width === Math.round(c.canvas.width) && p.height === Math.round(c.canvas.height), `${p.width}×${p.height}`);
  } else check('PNG export (current view) downloads', false);
  await click(page, '[data-testid="export-menu"]');
  await click(page, '[data-testid="export-reconstruction"]');
  file = await waitForDownload('fourierlab-reconstruction.png');
  check('PNG export (reconstruction) is 1600×1600', !!file && pngSize(file).width === 1600 && pngSize(file).height === 1600);

  // 14. JSON save and load reproduce the same result.
  await click(page, '[data-testid="circles-10"]');
  await wait(100);
  const saved = await state(page);
  await click(page, '[data-testid="save-project"]');
  file = await waitForDownload('fourierlab-project.json');
  check('project JSON downloads', !!file);
  if (file) {
    const json = JSON.parse(fs.readFileSync(file, 'utf8'));
    check('project file has format and version', json.format === 'fourierlab-project' && json.version === 1 && json.settings.circleCount === 10);
    await click(page, '[data-testid="circles-100"]');
    await click(page, '[data-testid="preset-star"]');
    await wait(150);
    const input = await page.$('[data-testid="load-project"]');
    await input.uploadFile(file);
    await wait(400);
    const loaded = await state(page);
    check(
      'loading the project restores the same reconstruction',
      loaded.circleCount === 10 && loaded.source === 'file' && Math.abs(loaded.rmse - saved.rmse) < 1e-6 * Math.max(1, saved.rmse),
      `rmse ${saved.rmse.toExponential(4)} → ${loaded.rmse.toExponential(4)}`,
    );
    // An invalid file is refused without changing anything.
    const bad = path.join(DOWNLOADS, 'bad.json');
    fs.writeFileSync(bad, JSON.stringify({ ...json, settings: { ...json.settings, speed: 1000 } }));
    await input.uploadFile(bad);
    await wait(300);
    notice = await page.$eval('[data-testid="notice"]', (el) => el.textContent).catch(() => '');
    check('invalid project file is rejected with a message', notice.includes('불러오지 못했습니다') && (await state(page)).circleCount === 10, notice);
  }

  // 15. Reload keeps the same state (autosave).
  await wait(600);
  const before = await state(page);
  await page.reload({ waitUntil: 'networkidle0' });
  await wait(500);
  const after = await state(page);
  check(
    'reload restores drawing and settings',
    after.circleCount === before.circleCount && after.strokePoints === before.strokePoints && Math.abs(after.rmse - before.rmse) < 1e-9,
  );
  check('canvas is painted after reload', (await inkFraction(page, 'canvas[aria-hidden="true"]')) > 0.005);

  // Analysis tabs render.
  for (const [label, sel] of [
    ['원 개수와 오차', '[data-testid="error-chart"] svg'],
    ['주파수 스펙트럼', '[data-testid="spectrum-chart"] svg'],
  ]) {
    await page.$$eval('[role="radio"]', (els, l) => els.find((e) => e.textContent === l)?.click(), label);
    await wait(200);
    check(`"${label}" chart renders`, !!(await page.$(sel)));
  }
  // Charts update at low priority after a circle-count change, but must end up consistent.
  await page.$$eval('[role="radio"]', (els) => els.find((e) => e.textContent === '원 개수와 오차')?.click());
  await click(page, '[data-testid="circles-50"]');
  await wait(400);
  {
    const s = await state(page);
    const shown = await page.$eval('[data-testid="rmse-value"]', (el) => el.textContent);
    check('error chart catches up with the circle count', shown === s.rmse.toPrecision(4), `${shown} vs ${s.rmse.toPrecision(4)}`);
  }
  await page.screenshot({ path: path.join(OUT, 'e2e-desktop.png') });
  await page.close();
}

// ───────────────────────────── mobile (emulated touch) ─────────────────────────────
{
  const page = await open({ width: 390, height: 844, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
  await page.goto(URL_, { waitUntil: 'networkidle0' });
  await page.evaluate(() => localStorage.clear());
  await page.reload({ waitUntil: 'networkidle0' });
  await wait(500);
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  check('mobile: no horizontal page overflow', overflow <= 0, `overflow=${overflow}px`);
  check('mobile: visualiser painted at DPR 2', (await inkFraction(page, 'canvas[aria-hidden="true"]')) > 0.005);
  const order = await page.evaluate(() =>
    ['drawing-canvas', 'viz-canvas', 'play-toggle'].map((id) => document.querySelector(`[data-testid="${id}"]`).getBoundingClientRect().top + scrollY),
  );
  check('mobile: drawing → animation → controls order', order[0] < order[1] && order[1] < order[2]);
  // Emulated touch stroke (Chrome touch emulation, not a physical device).
  const r = await page.$eval('[data-testid="drawing-canvas"]', (c) => c.getBoundingClientRect().toJSON());
  const scrollBefore = await page.evaluate(() => scrollY);
  await page.touchscreen.touchStart(r.x + 60, r.y + 60);
  for (let i = 1; i <= 30; i++) await page.touchscreen.touchMove(r.x + 60 + i * 6, r.y + 60 + Math.sin(i / 4) * 60 + i * 3);
  await page.touchscreen.touchEnd();
  await wait(150);
  const st = await state(page);
  check('mobile: touch stroke is drawn without scrolling the page', st.pending && st.drawingPoints > 10 && (await page.evaluate(() => scrollY)) === scrollBefore, `points=${st.drawingPoints}`);
  await page.screenshot({ path: path.join(OUT, 'e2e-mobile.png'), fullPage: true });
  await page.close();
}

check('no console errors, failed requests or HTTP errors', problems.length === 0, problems.slice(0, 5).join(' | '));

await browser.close();
server?.close();
console.log(failed ? `\n${failed} check(s) failed` : '\nAll browser checks passed');
process.exit(failed ? 1 : 0);
