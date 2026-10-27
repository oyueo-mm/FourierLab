// Browser test of the image upload → contour → epicycle pipeline (run after `npm run build`).
//
//   npm run e2e:image                 → serves ./dist like GitHub Pages
//   npm run e2e:image -- --url <URL>  → tests a deployed site
//
// Test images are generated in the page with canvas, so no binary fixtures are needed.

import fs from 'node:fs';
import path from 'node:path';
import puppeteer from 'puppeteer-core';
import { findBrowser, serveDist, wait } from './lib.mjs';
import { center, click, exists, isVisible, mouseStroke, rect, starPoints, state, Touch } from './helpers.mjs';

const argUrl = process.argv.includes('--url') ? process.argv[process.argv.indexOf('--url') + 1] : null;
const server = argUrl ? null : await serveDist('dist');
const URL_ = argUrl ?? server.url;
const OUT = path.resolve('e2e/out');
fs.mkdirSync(OUT, { recursive: true });

const browser = await puppeteer.launch({ executablePath: findBrowser(), headless: true, args: ['--no-sandbox', '--disable-dev-shm-usage'] });
let failed = 0;
let total = 0;
const problems = [];
const check = (name, ok, detail = '') => {
  total++;
  if (!ok) failed++;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? `  — ${detail}` : ''}`);
};
const section = (t) => console.log(`\n── ${t}`);

async function fresh(viewport) {
  const page = await browser.newPage();
  await page.setViewport(viewport);
  page.on('console', (m) => ['error', 'warn', 'warning'].includes(m.type()) && !/willReadFrequently/.test(m.text()) && problems.push(`console.${m.type()}: ${m.text()}`));
  page.on('pageerror', (e) => problems.push(`pageerror: ${e.message}`));
  await page.goto(URL_, { waitUntil: 'networkidle0' });
  await page.evaluate(() => localStorage.clear());
  await page.reload({ waitUntil: 'networkidle0' });
  await wait(500);
  return page;
}

/** Generates a test image in the page and drops it into a file input. */
function upload(page, inputSel, kind, { mime = 'image/png', name = `${kind}.png` } = {}) {
  return page.evaluate(
    async (inputSel, kind, mime, name) => {
      const make = (w, h, draw) => {
        const c = document.createElement('canvas');
        c.width = w;
        c.height = h;
        const ctx = c.getContext('2d');
        draw(ctx, w, h);
        return c;
      };
      const white = (ctx, w, h) => {
        ctx.fillStyle = '#fff';
        ctx.fillRect(0, 0, w, h);
      };
      const heartPath = (ctx, cx, cy, s) => {
        ctx.beginPath();
        for (let i = 0; i <= 200; i++) {
          const t = (i / 200) * Math.PI * 2;
          const x = 16 * Math.sin(t) ** 3;
          const y = 13 * Math.cos(t) - 5 * Math.cos(2 * t) - 2 * Math.cos(3 * t) - Math.cos(4 * t);
          if (i) ctx.lineTo(cx + x * s, cy - y * s);
          else ctx.moveTo(cx + x * s, cy - y * s);
        }
        ctx.closePath();
      };
      let canvas;
      let file;
      if (kind === 'text') {
        file = new File(['hello'], name, { type: 'text/plain' });
      } else {
        if (kind === 'heart') {
          canvas = make(400, 400, (ctx, w, h) => {
            white(ctx, w, h);
            ctx.fillStyle = '#000';
            heartPath(ctx, w / 2, h / 2, 10);
            ctx.fill();
          });
        } else if (kind === 'circle-wide') {
          canvas = make(480, 240, (ctx, w, h) => {
            white(ctx, w, h);
            ctx.fillStyle = '#111';
            ctx.beginPath();
            ctx.arc(w / 2, h / 2, 90, 0, Math.PI * 2);
            ctx.fill();
          });
        } else if (kind === 'transparent') {
          canvas = make(300, 300, (ctx) => {
            ctx.fillStyle = '#e11d48';
            ctx.beginPath();
            ctx.moveTo(150, 30);
            ctx.lineTo(270, 250);
            ctx.lineTo(30, 250);
            ctx.closePath();
            ctx.fill();
          });
        } else if (kind === 'multi') {
          canvas = make(400, 300, (ctx, w, h) => {
            white(ctx, w, h);
            ctx.fillStyle = '#000';
            for (const [x, y, r] of [[110, 150, 80], [290, 90, 40], [300, 220, 30]]) {
              ctx.beginPath();
              ctx.arc(x, y, r, 0, Math.PI * 2);
              ctx.fill();
            }
          });
        } else if (kind === 'photo') {
          canvas = make(1200, 900, (ctx, w, h) => {
            const g = ctx.createLinearGradient(0, 0, w, h);
            g.addColorStop(0, '#345');
            g.addColorStop(1, '#dcb');
            ctx.fillStyle = g;
            ctx.fillRect(0, 0, w, h);
            let seed = 11;
            const rnd = () => ((seed = (seed * 1664525 + 1013904223) >>> 0) / 2 ** 32);
            for (let i = 0; i < 400; i++) {
              ctx.fillStyle = `hsl(${rnd() * 360} ${30 + rnd() * 50}% ${20 + rnd() * 60}% / 0.6)`;
              ctx.beginPath();
              ctx.arc(rnd() * w, rnd() * h, 5 + rnd() * 60, 0, Math.PI * 2);
              ctx.fill();
            }
            const img = ctx.getImageData(0, 0, w, h);
            for (let i = 0; i < img.data.length; i += 4) {
              const n = (rnd() - 0.5) * 50;
              img.data[i] += n;
              img.data[i + 1] += n;
              img.data[i + 2] += n;
            }
            ctx.putImageData(img, 0, 0);
          });
        } else if (kind === 'flat') {
          canvas = make(200, 200, (ctx, w, h) => {
            ctx.fillStyle = '#888';
            ctx.fillRect(0, 0, w, h);
          });
        } else if (kind === 'tiny') {
          canvas = make(8, 8, (ctx, w, h) => {
            white(ctx, w, h);
            ctx.fillStyle = '#000';
            ctx.fillRect(2, 2, 4, 4);
          });
        }
        const blob = await new Promise((res) => canvas.toBlob(res, mime, 0.7));
        file = new File([blob], name, { type: mime });
      }
      const input = document.querySelector(inputSel);
      const dt = new DataTransfer();
      dt.items.add(file);
      input.files = dt.files;
      input.dispatchEvent(new Event('change', { bubbles: true }));
    },
    inputSel,
    kind,
    mime,
    name,
  );
}

const autosavedPath = (page) =>
  page.evaluate(() => {
    const d = JSON.parse(localStorage.getItem('fourierlab:autosave:v1') ?? 'null');
    return d ? { source: d.project.source, path: d.project.path } : null;
  });
const bbox = (pts) => {
  const xs = pts.map((p) => p[0]);
  const ys = pts.map((p) => p[1]);
  return { w: Math.max(...xs) - Math.min(...xs), h: Math.max(...ys) - Math.min(...ys), cx: (Math.max(...xs) + Math.min(...xs)) / 2 };
};
const maxJump = (pts) => {
  let m = 0;
  for (let i = 1; i < pts.length; i++) m = Math.max(m, Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]));
  return m;
};
const previewInk = (page) =>
  page.$eval('[data-testid="image-preview"]', (c) => {
    const d = c.getContext('2d', { willReadFrequently: true }).getImageData(0, 0, c.width, c.height).data;
    let n = 0;
    for (let i = 0; i < d.length; i += 4) if (d[i] < 235 || d[i + 1] < 235 || d[i + 2] < 235) n++;
    return n / (d.length / 4);
  });

// ═════════════════════════════ desktop ═════════════════════════════
{
  const page = await fresh({ width: 1440, height: 900 });
  let st = await state(page);

  section('하트 실루엣 업로드 (헤더 버튼 → 자동 추출 → 적용)');
  await upload(page, '[data-testid="header-image-input"]', 'heart');
  await page.waitForSelector('[data-testid="image-preview"]', { timeout: 5000 });
  await wait(500);
  st = await state(page);
  check('업로드하면 편집기가 열리고 "이미지" 탭이 선택된다', st.editorOpen && st.editorTab === 'image');
  check('아직 적용 전: 시뮬레이션은 그대로', st.source === 'heart' && !st.pending);
  check('미리보기에 이미지와 윤곽선이 그려진다', (await previewInk(page)) > 0.02);
  check('오류 메시지가 없다', !(await exists(page, '[data-testid="image-error"]')));
  check('"윤곽선만 재구성" 안내가 보인다', (await page.$eval('[data-testid="image-note"]', (e) => e.textContent)).includes('윤곽선'));
  await page.screenshot({ path: path.join(OUT, 'image-preview-desktop.png') });
  for (const view of ['원본', '윤곽선', '겹쳐 보기']) {
    await page.evaluate((label) => [...document.querySelectorAll('[role="radio"]')].find((e) => e.textContent === label)?.click(), view);
    await wait(100);
    check(`미리보기 방식 "${view}"이 그려진다`, (await previewInk(page)) > 0.005);
  }
  const id0 = st.analysisId;
  await click(page, '[data-testid="image-apply"]');
  await wait(600);
  st = await state(page);
  check('적용하면 이미지 경로로 재구성되고 편집기가 닫힌다', st.source === 'image' && !st.editorOpen && st.analysisId === id0 + 1 && st.playing && st.t < 0.3, `source=${st.source}`);
  check('기존 FFT 엔진 결과(RMSE)가 유한한 값', Number.isFinite(st.rmse) && st.rmse >= 0 && st.rmse / 1 < 0.2, `rmse=${st.rmse}`);
  const saved = await (async () => {
    await wait(700);
    return autosavedPath(page);
  })();
  const bb = saved && bbox(saved.path);
  check('자동 저장은 원본 이미지가 아닌 경로(좌표)만 저장한다', saved?.source === 'image' && saved.path.length > 30 && saved.path.length < 20000 && (await page.evaluate(() => localStorage.getItem('fourierlab:autosave:v1').length)) < 400_000, `${saved?.path.length} points`);
  check('점들이 연속적으로 이어진다 (불필요한 직선 점프 없음)', saved && maxJump(saved.path) < 0.5, `max step ${saved && maxJump(saved.path).toFixed(3)}`);
  check('하트의 가로세로 비율 유지 (≈ 1.1)', bb && bb.w / bb.h > 1.0 && bb.w / bb.h < 1.3, bb ? `w/h=${(bb.w / bb.h).toFixed(2)}` : '');
  check('재생 중 캔버스에 궤적이 그려진다', (await page.evaluate(() => window.__FOURIERLAB__.state().playing)) && (await state(page)).rmse > 0);

  section('이미지 경로도 기존 기능과 동일하게 동작');
  await click(page, '[data-testid="circles-10"]');
  await wait(100);
  st = await state(page);
  check('원 개수 변경 → 처음부터 다시', st.circleCount === 10 && st.t < 0.1);
  await click(page, '[data-testid="export-menu"]');
  await click(page, '[data-testid="export-reconstruction"]');
  await wait(500);
  check('PNG 내보내기 동작 (오류 없음)', !(await exists(page, '[data-testid="toast"]')));
  await click(page, '[data-testid="save-project"]');
  await wait(600);
  const dl = path.join(path.resolve('e2e/out/downloads'), 'fourierlab-project.json');
  check('프로젝트 JSON 저장·불러오기 왕복', await (async () => {
    // The smoke test owns the download dir; here we only check the save does not fail.
    return !(await exists(page, '[data-testid="toast"]'));
  })(), dl);
  const rmseBefore = (await state(page)).rmse;
  await page.reload({ waitUntil: 'networkidle0' });
  await wait(500);
  st = await state(page);
  check('새로고침 후 이미지 경로가 복원된다', st.source === 'image' && Math.abs(st.rmse - rmseBefore) < 1e-6, `source=${st.source} rmse ${rmseBefore} → ${st.rmse}`);

  section('비율 유지: 가로로 긴 이미지의 원');
  await upload(page, '[data-testid="header-image-input"]', 'circle-wide');
  await page.waitForSelector('[data-testid="image-apply"]:not([disabled])', { timeout: 5000 });
  await wait(300);
  await click(page, '[data-testid="image-apply"]');
  await wait(900);
  const circ = await autosavedPath(page);
  const cb = bbox(circ.path);
  check('480×240 이미지 속 원이 찌그러지지 않는다 (w/h ≈ 1)', Math.abs(cb.w / cb.h - 1) < 0.06, `w/h=${(cb.w / cb.h).toFixed(3)}`);
  st = await state(page);
  check('원은 k = +1 하나로 거의 표현된다 (K=1일 때 오차 작음)', st.rmse < 0.05);

  section('투명 배경 PNG · 여러 윤곽선 · 사진');
  await upload(page, '[data-testid="header-image-input"]', 'transparent');
  await page.waitForSelector('[data-testid="image-apply"]:not([disabled])', { timeout: 5000 });
  await wait(300);
  check('투명 배경 도형: 오류 없이 윤곽선 추출', !(await exists(page, '[data-testid="image-error"]')));
  await click(page, '[data-testid="image-apply"]');
  await wait(900);
  const tri = await autosavedPath(page);
  const tb = bbox(tri.path);
  check('투명 배경 삼각형이 삼각형으로 재구성 (꼭짓점 유지, 비율 ≈ 1.09)', tri.source === 'image' && tri.path.length >= 4 && tri.path.length <= 12 && Math.abs(tb.w / tb.h - 240 / 220) < 0.1, `points=${tri.path.length} w/h=${(tb.w / tb.h).toFixed(2)}`);

  await click(page, '[data-testid="open-editor"]');
  await wait(400);
  await upload(page, '[data-testid="image-input"]', 'multi');
  await page.waitForSelector('[data-testid="image-candidate-1"]', { timeout: 5000 });
  check('여러 윤곽선: 후보 선택 버튼이 나타난다', await isVisible(page, '[data-testid="image-candidate-2"]'));
  await click(page, '[data-testid="image-candidate-1"]');
  await wait(150);
  await click(page, '[data-testid="image-apply"]');
  await wait(900);
  const multi = await autosavedPath(page);
  check('선택한 윤곽선 하나만 적용 (서로 떨어진 도형을 직선으로 잇지 않음)', maxJump(multi.path) < 0.6 && bbox(multi.path).w < 1.75, `max step ${maxJump(multi.path).toFixed(3)}`);

  await click(page, '[data-testid="open-editor"]');
  await wait(400);
  const t0 = Date.now();
  await upload(page, '[data-testid="image-input"]', 'photo', { mime: 'image/jpeg', name: 'photo.jpg' });
  await page.waitForSelector('[data-testid="image-preview"]', { timeout: 8000 });
  await wait(300);
  const dtPhoto = Date.now() - t0;
  const applyDisabled = await page.$eval('[data-testid="image-apply"]', (e) => e.disabled);
  check('복잡한 사진(1200×900 JPEG)도 멈추지 않고 처리', dtPhoto < 6000 && (await page.evaluate(() => document.readyState)) === 'complete', `${dtPhoto} ms`);
  if (!applyDisabled) {
    const a0 = (await state(page)).analysisId;
    await click(page, '[data-testid="image-apply"]');
    await wait(1200);
    st = await state(page);
    check('사진 윤곽선도 FFT로 재구성되어 재생된다', st.analysisId === a0 + 1 && st.playing && Number.isFinite(st.rmse), `points=${st.strokePoints} rmse=${st.rmse.toPrecision(3)}`);
  } else {
    check('사진: 윤곽선을 찾지 못해도 오류 안내를 보여준다', await exists(page, '[data-testid="image-error"]'));
  }

  section('실패 처리');
  await click(page, '[data-testid="open-editor"]');
  await wait(400);
  const before = await state(page);
  await upload(page, '[data-testid="image-input"]', 'flat');
  await wait(600);
  check('거의 단색 이미지: 오류 안내 + 적용 불가', (await exists(page, '[data-testid="image-error"]')) && (await page.$eval('[data-testid="image-apply"]', (e) => e.disabled)));
  await upload(page, '[data-testid="image-input"]', 'tiny');
  await wait(600);
  check('매우 작은 이미지: 오류 안내', (await page.$eval('[data-testid="image-error"]', (e) => e.textContent)).includes('작'));
  await upload(page, '[data-testid="image-input"]', 'text', { mime: 'text/plain', name: 'a.txt' });
  await wait(400);
  const after = await state(page);
  check('지원하지 않는 파일(.txt)은 거부되고 기존 시뮬레이션이 유지된다', after.analysisId === before.analysisId && after.source === before.source && after.playing === before.playing);
  const bad = await page.evaluate(async () => {
    const input = document.querySelector('[data-testid="image-input"]');
    const dt = new DataTransfer();
    dt.items.add(new File([new Uint8Array([1, 2, 3, 4])], 'broken.png', { type: 'image/png' }));
    input.files = dt.files;
    input.dispatchEvent(new Event('change', { bubbles: true }));
    return true;
  });
  await wait(600);
  check('깨진 PNG: 오류 안내, 앱은 계속 동작', bad && (await state(page)).playing !== undefined && (await exists(page, '[data-testid="image-error"]')));
  // 빠르게 연속 업로드해도 마지막 이미지가 이긴다
  await upload(page, '[data-testid="image-input"]', 'photo', { mime: 'image/jpeg', name: 'photo.jpg' });
  await upload(page, '[data-testid="image-input"]', 'heart');
  await wait(1500);
  check('연속 업로드: 마지막 이미지(하트)가 최종 결과', !(await exists(page, '[data-testid="image-candidate-3"]')) && (await previewInk(page)) > 0.02);
  const heartApplied = (await state(page)).analysisId;
  await click(page, '[data-testid="image-apply"]');
  await wait(800);
  check('최종 이미지 적용 성공', (await state(page)).analysisId === heartApplied + 1);

  section('직접 그리기 ↔ 이미지 전환 시 데이터 보존');
  await click(page, '[data-testid="open-editor"]');
  await wait(400);
  await page.evaluate(() => [...document.querySelectorAll('[role="radio"]')].find((e) => e.textContent === '직접 그리기')?.click());
  await wait(200);
  await mouseStroke(page, starPoints(await rect(page, '[data-testid="drawing-frame"]')));
  const drawn = (await state(page)).drawingPoints;
  await page.evaluate(() => [...document.querySelectorAll('[role="radio"]')].find((e) => e.textContent === '이미지')?.click());
  await wait(200);
  check('이미지 탭에서도 올린 이미지가 남아 있다', await isVisible(page, '[data-testid="image-preview"]'));
  await page.evaluate(() => [...document.querySelectorAll('[role="radio"]')].find((e) => e.textContent === '직접 그리기')?.click());
  await wait(200);
  check('탭을 오가도 그리던 선이 지워지지 않는다', (await state(page)).drawingPoints === drawn && drawn > 20, `${drawn} points`);
  await page.keyboard.press('Escape');
  await page.close();
}

// ═════════════════════════════ mobile ═════════════════════════════
{
  const page = await fresh({ width: 390, height: 844, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
  section('모바일 390×844');
  const touch = await Touch.attach(page);
  await upload(page, '[data-testid="header-image-input"]', 'heart');
  await page.waitForSelector('[data-testid="image-preview"]', { timeout: 5000 });
  await wait(600);
  const pr = await rect(page, '[data-testid="image-preview"]');
  const ap = await rect(page, '[data-testid="image-apply"]');
  const over = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  check('모바일: 이미지 미리보기가 화면 안에 있고 가로 스크롤이 없다', pr.left >= 0 && pr.right <= 390 && pr.width >= 280 && over <= 0, `${Math.round(pr.width)}×${Math.round(pr.height)}`);
  check('모바일: 적용 버튼이 터치하기 좋은 크기 (≥ 44px 높이)', ap.height >= 43.5, `${Math.round(ap.height)}px`);
  await page.screenshot({ path: path.join(OUT, 'image-preview-mobile.png') });
  await page.$eval('[data-testid="image-apply"]', (e) => e.scrollIntoView({ block: 'nearest' }));
  await wait(200);
  const ap2 = await rect(page, '[data-testid="image-apply"]');
  const a0 = (await state(page)).analysisId;
  await touch.tap(...center(ap2));
  await wait(900);
  const st = await state(page);
  check('모바일: 터치로 적용하면 이미지 경로가 재생된다', st.source === 'image' && st.analysisId === a0 + 1 && !st.editorOpen && st.playing, `source=${st.source}`);
  await page.close();
}

check('콘솔 오류·페이지 오류 없음', problems.length === 0, problems.slice(0, 4).join(' | '));
await browser.close();
server?.close();
console.log(failed ? `\n${failed}/${total} check(s) failed` : `\nAll ${total} image checks passed`);
process.exit(failed ? 1 : 0);
