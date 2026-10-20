// Helpers shared by the browser tests: state access, clicking, pixel probes, touch input.

import { wait } from './lib.mjs';

export { wait };

export const state = (page) => page.evaluate(() => window.__FOURIERLAB__.state());
/** Programmatic click (works for off-screen and covered elements; use page.click for real mouse input). */
export const click = (page, sel) => page.$eval(sel, (el) => el.click());
export const rect = (page, sel) => page.$eval(sel, (el) => el.getBoundingClientRect().toJSON());
export const exists = async (page, sel) => !!(await page.$(sel));

/** True when the element is rendered and not hidden by visibility/display (also through ancestors). */
export const isVisible = (page, sel) =>
  page.$eval(sel, (el) => {
    const r = el.getBoundingClientRect();
    const cs = getComputedStyle(el);
    return cs.visibility !== 'hidden' && cs.display !== 'none' && r.width > 0 && r.height > 0;
  });

/** Sets a React-controlled input and fires the input event React listens to. */
export const setInput = (page, sel, value) =>
  page.$eval(
    sel,
    (el, v) => {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(el, String(v));
      el.dispatchEvent(new Event('input', { bubbles: true }));
    },
    value,
  );

/** Like setInput, then fires `change` as the browser does when a range input is released. */
export const setRange = async (page, sel, value) => {
  await setInput(page, sel, value);
  await page.$eval(sel, (el) => el.dispatchEvent(new Event('change', { bubbles: true })));
};

export const clickRadio = (page, group, label) =>
  page.$$eval(
    `[role="radiogroup"][aria-label="${group}"] [role="radio"]`,
    (els, l) => {
      const el = els.find((e) => e.textContent.trim() === l);
      if (!el) throw new Error(`radio "${l}" not found`);
      el.click();
    },
    label,
  );

/** Fraction of sampled pixels in a canvas that are not plain white (i.e. something is drawn). */
export const inkFraction = (page, sel) =>
  page.$eval(sel, (c) => {
    const d = c.getContext('2d').getImageData(0, 0, c.width, c.height).data;
    let ink = 0;
    let n = 0;
    for (let i = 0; i < d.length; i += 4 * 97) {
      n++;
      if (d[i + 3] > 0 && (d[i] < 235 || d[i + 1] < 235 || d[i + 2] < 235)) ink++;
    }
    return ink / n;
  });

/** Number of opaque pixels in the trail colour (#2563eb) on the dynamic layer: the drawn reconstruction trail. */
export const trailPixels = (page) =>
  page.$eval('[data-testid="viz-canvas"]', (c) => {
    const d = c.getContext('2d').getImageData(0, 0, c.width, c.height).data;
    let n = 0;
    for (let i = 0; i < d.length; i += 4) {
      if (d[i + 3] >= 250 && Math.abs(d[i] - 37) < 14 && Math.abs(d[i + 1] - 99) < 14 && Math.abs(d[i + 2] - 235) < 14) n++;
    }
    return n;
  });

/** Pixel of the dynamic canvas at CSS position (x, y). */
export const pixelAt = (page, x, y) =>
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
export const toScreen = (st, [x, y]) => {
  const s = st.view.pixelsPerUnit;
  return [st.canvas.width / 2 + (x - st.view.cx) * s, st.canvas.height / 2 - (y - st.view.cy) * s];
};

/** Heart outline in screen coordinates inside a rectangle. */
export function heartPoints(r, n = 240) {
  const half = Math.min(r.width, r.height) / 2;
  const pts = [];
  for (let i = 0; i <= n; i++) {
    const t = (2 * Math.PI * i) / n;
    const x = (16 * Math.sin(t) ** 3) / 22;
    const y = (13 * Math.cos(t) - 5 * Math.cos(2 * t) - 2 * Math.cos(3 * t) - Math.cos(4 * t)) / 22 + 0.08;
    pts.push([r.x + r.width / 2 + x * half, r.y + r.height / 2 - y * half]);
  }
  return pts;
}

/** Five-pointed star in screen coordinates inside a rectangle. */
export function starPoints(r, perEdge = 12) {
  const half = Math.min(r.width, r.height) / 2;
  const cx = r.x + r.width / 2;
  const cy = r.y + r.height / 2;
  const v = [];
  for (let i = 0; i < 10; i++) {
    const rad = (i % 2 === 0 ? 0.8 : 0.34) * half;
    const a = -Math.PI / 2 + (i * Math.PI) / 5;
    v.push([cx + rad * Math.cos(a), cy + rad * Math.sin(a)]);
  }
  v.push(v[0]);
  const pts = [];
  for (let i = 0; i < v.length - 1; i++) {
    for (let j = 0; j < perEdge; j++) {
      const u = j / perEdge;
      pts.push([v[i][0] + (v[i + 1][0] - v[i][0]) * u, v[i][1] + (v[i + 1][1] - v[i][1]) * u]);
    }
  }
  pts.push(v[v.length - 1]);
  return pts;
}

export async function mouseStroke(page, pts) {
  await page.mouse.move(pts[0][0], pts[0][1]);
  await page.mouse.down();
  for (const [x, y] of pts.slice(1)) await page.mouse.move(x, y);
  await page.mouse.up();
}

/** Real multi-touch through the DevTools protocol (Chromium turns it into pointer events). */
export class Touch {
  constructor(cdp) {
    this.cdp = cdp;
  }
  static async attach(page) {
    return new Touch(await page.createCDPSession());
  }
  send(type, points) {
    return this.cdp.send('Input.dispatchTouchEvent', { type, touchPoints: points.map(([x, y], id) => ({ x, y, id })) });
  }
  start(points) {
    return this.send('touchStart', points);
  }
  move(points) {
    return this.send('touchMove', points);
  }
  end() {
    return this.send('touchEnd', []);
  }
  cancel() {
    return this.send('touchCancel', []);
  }
  /** Single-finger path: start, interpolated moves, end. */
  async drag(path, { end = true } = {}) {
    await this.start([path[0]]);
    for (const p of path.slice(1)) await this.move([p]);
    if (end) await this.end();
  }
  async tap(x, y) {
    await this.start([[x, y]]);
    await this.end();
  }
  /** Two-finger gesture between two start pairs and two end pairs, in `steps` moves. */
  async pinch(from, to, steps = 8) {
    await this.start(from);
    for (let i = 1; i <= steps; i++) {
      const u = i / steps;
      await this.move(from.map((p, k) => [p[0] + (to[k][0] - p[0]) * u, p[1] + (to[k][1] - p[1]) * u]));
    }
    await this.end();
  }
}

export const lerpPath = (a, b, n = 10) => Array.from({ length: n + 1 }, (_, i) => [a[0] + ((b[0] - a[0]) * i) / n, a[1] + ((b[1] - a[1]) * i) / n]);

export const center = (r) => [r.x + r.width / 2, r.y + r.height / 2];
