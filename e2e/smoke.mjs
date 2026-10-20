// Browser regression test of the built app (real Chromium/Edge via puppeteer-core).
//
//   npm run build && npm run e2e         → serves ./dist like GitHub Pages (/FourierLab/) and tests it
//   npm run e2e -- --url <URL>           → tests a deployed site instead
//
// Exit code is non-zero when any check fails, so CI can gate the deployment on it.
// Mobile sections use Chromium's touch emulation and real multi-touch events over the DevTools
// protocol; they are not a substitute for testing on a physical device.

import fs from 'node:fs';
import path from 'node:path';
import puppeteer from 'puppeteer-core';
import { findBrowser, serveDist } from './lib.mjs';
import {
  Touch,
  center,
  click,
  clickRadio,
  exists,
  heartPoints,
  inkFraction,
  isVisible,
  lerpPath,
  mouseStroke,
  pixelAt,
  rect,
  setInput,
  setRange,
  starPoints,
  state,
  toScreen,
  trailPixels,
  wait,
} from './helpers.mjs';

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
let total = 0;
const problems = [];
const check = (name, ok, detail = '') => {
  total++;
  if (!ok) failed++;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? `  — ${detail}` : ''}`);
};
const section = (title) => console.log(`\n── ${title}`);

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

async function fresh(viewport) {
  const page = await open(viewport);
  await page.goto(URL_, { waitUntil: 'networkidle0' });
  await page.evaluate(() => localStorage.clear());
  await page.reload({ waitUntil: 'networkidle0' });
  await wait(500);
  return page;
}

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
  return { sig: b.subarray(0, 8).toString('hex') === '89504e470d0a1a0a', width: b.readUInt32BE(16), height: b.readUInt32BE(20) };
};

const noOverflow = (page) => page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
const inDrawer = (page) => page.evaluate(() => !!document.activeElement?.closest('[data-testid="edit-drawer"]'));
const drawerHidden = async (page) => !(await isVisible(page, '[data-testid="edit-drawer"]'));

// ═════════════════════════════ DESKTOP 1440×900 ═════════════════════════════
{
  const page = await fresh({ width: 1440, height: 900 });
  let st = await state(page);

  section('초기 화면과 레이아웃');
  check('첫 방문: 하트 예제가 바로 재생된다', st.source === 'heart' && st.playing === true, `source=${st.source} playing=${st.playing}`);
  check('정적 레이어가 칠해져 있고 배경은 흰색(검은 화면 없음)', (await inkFraction(page, 'canvas[aria-hidden="true"]')) > 0.005);
  const bg = await page.$eval('canvas[aria-hidden="true"]', (c) => Array.from(c.getContext('2d').getImageData(2, 2, 1, 1).data));
  check('캔버스 배경 흰색', bg[0] > 240 && bg[3] === 255, bg.join(','));
  check('왼쪽 고정 그림 패널이 없다 (편집 드로어는 닫힘, 숨김·inert)', (await drawerHidden(page)) && (await page.$eval('[data-testid="edit-drawer"]', (e) => e.inert)));
  const stage = await rect(page, '[data-testid="stage"]');
  check('메인 캔버스가 화면 너비 대부분을 사용 (≥ 95%)', stage.width >= 1440 * 0.95, `${Math.round(stage.width)}×${Math.round(stage.height)} px`);
  check('메인 캔버스 높이 ≥ 560px', stage.height >= 560, `${Math.round(stage.height)}px`);
  check('컨트롤(재생·원 개수)이 첫 화면 안에 보임', (await rect(page, '[data-testid="controls-dock"]')).bottom <= 900);
  check('수학적 분석은 기본적으로 접혀 있고 차트를 그리지 않는다', !(await exists(page, '#analysis-body')) && !(await exists(page, '[data-testid="spectrum-chart"]')));
  const baseSpectrum = st.counters.spectrum;

  section('원 개수 변경 → 처음부터 다시 재생');
  // 1) 재생 중 변경
  await setRange(page, '[data-testid="timeline"]', 5000);
  await wait(60);
  const before = await state(page);
  check('(준비) 재생 중이고 t ≈ 0.5', before.playing && before.t > 0.45, `t=${before.t.toFixed(3)}`);
  check('(준비) 궤적이 그려져 있다', (await trailPixels(page)) > 200);
  await click(page, '[data-testid="circles-10"]');
  await wait(120);
  st = await state(page);
  check('재생 중 변경: t가 0에서 다시 시작하고 계속 재생', st.t < 0.05 && st.playing && st.restarts === before.restarts + 1, `t=${st.t.toFixed(3)} restarts=${st.restarts}`);
  check('원 개수·RMSE·사용 성분이 갱신된다', st.circleCount === 10 && st.usedFrequencies.length === 10 && st.rmse > before.rmse, `K=${st.circleCount} used=${st.usedFrequencies.length} rmse ${before.rmse.toExponential(2)}→${st.rmse.toExponential(2)}`);
  check('타임라인 슬라이더가 처음 위치로 돌아간다', Number(await page.$eval('[data-testid="timeline"]', (e) => e.value)) < 500);

  // 2) 일시정지 중 변경
  await click(page, '[data-testid="play-toggle"]');
  await setRange(page, '[data-testid="timeline"]', 6000);
  await wait(60);
  check('(준비) 일시정지 + t = 0.6 + 궤적 있음', !(await state(page)).playing && Math.abs((await state(page)).t - 0.6) < 1e-9 && (await trailPixels(page)) > 200);
  const r0 = (await state(page)).restarts;
  await click(page, '[data-testid="circles-50"]');
  await wait(100);
  st = await state(page);
  check('일시정지 중 변경: t = 0, 일시정지 유지', st.t === 0 && st.playing === false && st.restarts === r0 + 1);
  check('이전 궤적 잔상이 남지 않는다 (t = 0 프레임)', (await trailPixels(page)) === 0, `trail pixels=${await trailPixels(page)}`);
  check('타임라인과 시간 표시가 0', Number(await page.$eval('[data-testid="timeline"]', (e) => e.value)) === 0 && (await page.$eval('[data-testid="time-label"]', (e) => e.textContent)).startsWith('t = 0.000'));
  {
    const tip = toScreen(st, st.tipWorld);
    check('t = 0: 펜 끝이 새 설정의 시작점에 있다', Math.hypot(tip[0] - st.tipScreen[0], tip[1] - st.tipScreen[1]) < 0.01);
  }
  await click(page, '[data-testid="play-toggle"]');
  await wait(300);
  st = await state(page);
  check('정지 후 재생하면 0부터 진행', st.playing && st.t > 0.01 && st.t < 0.12, `t=${st.t.toFixed(3)}`);

  // 3) 한 번 재생이 끝난 상태에서 변경
  await click(page, '[data-testid="loop-toggle"]');
  await setRange(page, '[data-testid="speed-slider"]', 1); // 5×
  await setRange(page, '[data-testid="timeline"]', 9000);
  for (let i = 0; i < 40 && (await state(page)).playing; i++) await wait(100);
  st = await state(page);
  check('(준비) 한 번 재생 완료: t = 1, 정지', st.loop === false && st.playing === false && st.t === 1, `t=${st.t} playing=${st.playing}`);
  const r1 = st.restarts;
  await click(page, '[data-testid="circles-5"]');
  await wait(100);
  st = await state(page);
  check('완료 상태에서 변경: t = 0, 시작 프레임 표시, 정지 유지', st.t === 0 && !st.playing && st.restarts === r1 + 1 && (await trailPixels(page)) === 0);
  await click(page, '[data-testid="play-toggle"]');
  await wait(400);
  st = await state(page);
  check('완료 상태 해제: 재생하면 처음부터 다시 그린다', st.playing && st.t > 0.02 && st.t < 0.5, `t=${st.t.toFixed(3)}`);
  await click(page, '[data-testid="loop-toggle"]');
  await click(page, '[data-testid="speed-label"]'); // back to 1×
  await wait(60);
  check('(복구) 반복 재생 1×', (await state(page)).loop === true && (await state(page)).speed === 1);

  // 4) 빠른 선택 버튼 전체
  {
    let ok = true;
    let detail = '';
    for (const q of [1, 2, 5, 10, 50, 100, 'all']) {
      const r = (await state(page)).restarts;
      await setRange(page, '[data-testid="timeline"]', 4000);
      await click(page, `[data-testid="circles-${q}"]`);
      await wait(60);
      const s = await state(page);
      const k = q === 'all' ? s.sampleCount - 1 : q;
      if (!(s.circleCount === k && s.t < 0.05 && s.restarts === r + 1)) {
        ok = false;
        detail += ` ${q}:K=${s.circleCount},t=${s.t.toFixed(2)},restarts+${s.restarts - r}`;
      }
    }
    check('빠른 선택 1/2/5/10/50/100/전체 모두 즉시 적용 + t = 0', ok, detail);
  }
  await click(page, '[data-testid="circles-50"]');

  // 5) 슬라이더 드래그 (마우스): 드래그 중 미리보기, 손을 떼면 한 번만 재시작
  {
    if (!(await state(page)).playing) await click(page, '[data-testid="play-toggle"]');
    await setRange(page, '[data-testid="timeline"]', 5000);
    const sr = await rect(page, '[data-testid="circle-slider"]');
    const s0 = await state(page);
    const x = (f) => sr.x + 14 + f * (sr.width - 28);
    const yy = sr.y + sr.height / 2;
    await page.mouse.move(x(s0.circleCount ? Math.log(s0.circleCount) / Math.log(1023) : 0), yy);
    await page.mouse.down();
    const ks = [];
    let restartedDuringDrag = false;
    let tMin = 1;
    for (const f of [0.35, 0.4, 0.45, 0.5, 0.55, 0.6, 0.7, 0.8]) {
      await page.mouse.move(x(f), yy, { steps: 2 });
      await wait(30);
      const s = await state(page);
      ks.push(s.circleCount);
      tMin = Math.min(tMin, s.t);
      if (s.restarts !== s0.restarts) restartedDuringDrag = true;
    }
    check('드래그 중: 원 개수 미리보기가 바뀌고 애니메이션은 재시작하지 않는다', new Set(ks).size >= 5 && !restartedDuringDrag && tMin > 0.4, `K: ${ks.join('→')} tMin=${tMin.toFixed(2)}`);
    check('드래그 중 FFT를 다시 계산하지 않는다', (await state(page)).counters.spectrum === baseSpectrum);
    await page.mouse.up();
    await wait(80);
    st = await state(page);
    check('손을 떼면 한 번만 확정: 재시작 +1, t ≈ 0, 마지막 값 유지', st.restarts === s0.restarts + 1 && st.t < 0.05 && st.circleCount === ks[ks.length - 1], `restarts +${st.restarts - s0.restarts}, K=${st.circleCount}`);
  }

  // 6) 키보드 / 숫자 입력 / 성분 선택 방식
  {
    await page.focus('[data-testid="circle-slider"]');
    const r = (await state(page)).restarts;
    const k0 = (await state(page)).circleCount;
    await page.keyboard.press('ArrowRight');
    await wait(60);
    st = await state(page);
    check('키보드 슬라이더 조작: 키 입력마다 확정·재시작', st.circleCount !== k0 && st.restarts === r + 1 && st.t < 0.05, `K ${k0}→${st.circleCount}`);
    await page.$eval('[data-testid="circle-input"]', (e) => e.select());
    await page.keyboard.type('33');
    await page.keyboard.press('Enter');
    await wait(60);
    st = await state(page);
    check('숫자 입력 + Enter: K = 33, 재시작', st.circleCount === 33 && st.restarts === r + 2);
    // 값을 바꾸지 않고 입력칸에서 포커스만 이동하면 재시작하지 않는다
    await page.focus('[data-testid="circle-input"]');
    await page.focus('[data-testid="circle-slider"]');
    await wait(60);
    check('입력칸에서 포커스만 벗어나면(값 불변) 재시작하지 않는다', (await state(page)).restarts === r + 2);
    await setRange(page, '[data-testid="timeline"]', 4000);
    await clickRadio(page, '성분 선택 방식', '저주파부터');
    await wait(60);
    const afterMode = await state(page);
    check('성분 선택 방식 변경도 처음부터 다시 그린다', afterMode.selectionMode === 'frequency' && afterMode.t < 0.05 && afterMode.restarts === r + 3);
    check('저주파 선택: 사용 성분이 ±1…±16 범위', Math.max(...afterMode.usedFrequencies.map(Math.abs)) <= 17, afterMode.usedFrequencies.join(','));
    await clickRadio(page, '성분 선택 방식', '진폭 큰 순서');
  }

  // 7) 재시작하면 안 되는 조작
  {
    await setRange(page, '[data-testid="timeline"]', 4000);
    const s0 = await state(page);
    await page.$$eval('[aria-label="표시 항목"] button[aria-pressed]', (els) => els.find((e) => e.textContent.trim() === '벡터')?.click());
    await page.$$eval('[aria-label="표시 항목"] button[aria-pressed]', (els) => els.find((e) => e.textContent.trim() === '벡터')?.click());
    await setRange(page, '[data-testid="speed-slider"]', 0.7);
    await click(page, '[data-testid="loop-toggle"]');
    await click(page, '[data-testid="loop-toggle"]');
    await click(page, '[data-testid="analysis-toggle"]');
    await click(page, 'button[aria-label="확대"]');
    await wait(60);
    st = await state(page);
    check('표시 토글·속도·반복·분석 패널·확대는 재생 위치를 초기화하지 않는다', st.restarts === s0.restarts && st.t >= 0.39 && st.analysisId === s0.analysisId, `t=${st.t.toFixed(3)} restarts=${st.restarts}`);
    await click(page, '[data-testid="analysis-toggle"]');
    await click(page, '[data-testid="speed-label"]');
  }
  check('지금까지 원 개수·성분 선택을 수십 번 바꿨지만 FFT는 다시 계산하지 않았다', (await state(page)).counters.spectrum === baseSpectrum, `spectrum=${(await state(page)).counters.spectrum}, prepare=${(await state(page)).counters.prepare}`);

  section('재구성 정확도 · 렌더링 일치');
  await click(page, '[data-testid="open-editor"]');
  await wait(300);
  await click(page, '[data-testid="preset-circle"]');
  await click(page, '[data-testid="edit-close"]');
  await wait(300);
  await click(page, '[data-testid="circles-1"]');
  st = await state(page);
  check('원 예제는 원 1개로 충분 (상대 RMSE < 0.1%)', st.source === 'circle' && st.relativeRmse < 1e-3, `rel=${st.relativeRmse.toExponential(2)}`);
  await click(page, '[data-testid="open-editor"]');
  await wait(300);
  await click(page, '[data-testid="preset-heart"]');
  await click(page, '[data-testid="edit-close"]');
  await wait(300);
  const heart = {};
  for (const k of [1, 10, 50, 100]) {
    await click(page, `[data-testid="circles-${k}"]`);
    await wait(80);
    heart[k] = (await state(page)).relativeRmse;
  }
  check(
    '하트: 원을 늘릴수록 오차가 줄어든다 (1 → 10 → 50 → 100)',
    heart[1] > heart[10] && heart[10] > heart[50] && heart[50] > heart[100],
    Object.entries(heart).map(([k, v]) => `K=${k}: ${(v * 100).toPrecision(3)}%`).join(', '),
  );
  check('하트 K = 100 → 0.0839% (이전 버전과 동일한 수학 결과)', Math.abs(heart[100] - 0.000839) < 5e-6, `${(heart[100] * 100).toPrecision(4)}%`);
  await click(page, '[data-testid="play-toggle"]');
  await wait(100);
  st = await state(page);
  {
    const expected = toScreen(st, st.tipWorld);
    const tipErr = Math.hypot(expected[0] - st.tipScreen[0], expected[1] - st.tipScreen[1]);
    check('화면의 펜 끝 = 수학 함수 ẑ(t) (오차 < 0.01 px)', tipErr < 0.01, `${tipErr.toExponential(2)} px`);
    const px = await pixelAt(page, st.tipScreen[0], st.tipScreen[1]);
    check('펜 끝 픽셀이 장미색', px[0] > 180 && px[1] < 100 && px[2] < 140, px.join(','));
  }
  const tp = st.t;
  await wait(400);
  check('일시정지 후 시간이 흐르지 않는다', (await state(page)).t === tp);
  {
    await page.evaluate(() => document.activeElement?.blur?.());
    const was = (await state(page)).playing;
    await page.keyboard.press('Space');
    await wait(60);
    const toggled = (await state(page)).playing !== was;
    await page.keyboard.press('Space');
    await wait(60);
    check('키보드 Space로 재생/일시정지를 전환할 수 있다', toggled && (await state(page)).playing === was);
  }
  await setRange(page, '[data-testid="timeline"]', 7500);
  await wait(60);
  st = await state(page);
  {
    const p = toScreen(st, st.tipWorld);
    check('타임라인 탐색: t = 0.75에서 펜 끝이 정확하다', Math.abs(st.t - 0.75) < 1e-9 && Math.hypot(p[0] - st.tipScreen[0], p[1] - st.tipScreen[1]) < 0.01);
  }
  await setRange(page, '[data-testid="timeline"]', 2500);
  check('뒤로 탐색 t = 0.25', Math.abs((await state(page)).t - 0.25) < 1e-9);
  await click(page, 'button[aria-label="한 단계 진행"]');
  check('한 단계 = 1/N', Math.abs((await state(page)).t - (0.25 + 1 / 1024)) < 1e-9);
  await click(page, '[data-testid="play-toggle"]');
  await setRange(page, '[data-testid="speed-slider"]', Math.log(20) / Math.log(50));
  const rate = await page.evaluate(async () => {
    const s = window.__FOURIERLAB__.state;
    await new Promise((r) => setTimeout(r, 150));
    const a = s().t;
    const ta = performance.now();
    await new Promise((r) => setTimeout(r, 1000));
    return (((s().t - a + 1) % 1) / (performance.now() - ta)) * 1000;
  });
  check('재생 속도 2× → 초당 0.2 (±15%)', Math.abs(rate - 0.2) < 0.03, `${rate.toFixed(3)}/s`);
  await click(page, '[data-testid="speed-label"]');

  section('그림 편집 드로어 (데스크톱)');
  await click(page, '[data-testid="play-toggle"]'); // 일시정지: 열고 닫아도 시간이 흐르지 않음을 확인
  const zoomBtn = 'button[aria-label="확대"]';
  await click(page, zoomBtn);
  const zoomed = await state(page);
  const pre = await state(page);
  await page.click('[data-testid="open-editor"]');
  await wait(450);
  st = await state(page);
  check('"그림 편집" 버튼으로 드로어가 열린다', st.editorOpen && (await isVisible(page, '[data-testid="edit-drawer"]')));
  check('열면 포커스가 드로어 안으로 이동', await inDrawer(page));
  check('뒤쪽 화면은 inert(포커스·클릭 불가)', await page.$eval('header', (h) => !!h.closest('[inert]')));
  const dr = await rect(page, '[data-testid="edit-drawer"]');
  const fr = await rect(page, '[data-testid="drawing-frame"]');
  check('드로어 너비 520~600px, 왼쪽에서 열린다', dr.x === 0 && dr.width >= 520 && dr.width <= 600, `${Math.round(dr.width)}px`);
  check('그림 캔버스 ≥ 450px, 정사각형, 드로어 안에 완전히 들어간다', fr.width >= 450 && Math.abs(fr.width - fr.height) < 1 && fr.right <= dr.right && fr.left >= dr.left, `${Math.round(fr.width)}×${Math.round(fr.height)}`);
  check('편집 완료 버튼이 첫 화면 안에 보인다', (await rect(page, '[data-testid="apply-close"]')).bottom <= 900);
  check('드로어를 열어도 메인 캔버스는 리사이즈되지 않는다', (await state(page)).canvas.width === pre.canvas.width && (await state(page)).canvas.height === pre.canvas.height);
  check('열어도 FFT·시간·재생 상태는 그대로', st.counters.spectrum === pre.counters.spectrum && st.t === pre.t && st.restarts === pre.restarts, `spectrum ${pre.counters.spectrum}→${st.counters.spectrum}, t ${pre.t}→${st.t}, playing ${pre.playing}→${st.playing}, restarts ${pre.restarts}→${st.restarts}`);

  // 별을 그린다 (그려도 적용 전에는 애니메이션이 바뀌지 않는다)
  const id0 = st.analysisId;
  await mouseStroke(page, starPoints(fr));
  await wait(120);
  st = await state(page);
  check('드로어에서 그린 선이 적용 전 상태(pending)로 저장되고 메인은 그대로', st.pending && st.drawingPoints > 100 && st.analysisId === id0 && st.restarts === pre.restarts, `pending=${st.pending} points=${st.drawingPoints} id ${id0}→${st.analysisId} restarts ${pre.restarts}→${st.restarts}`);
  check('"아직 적용하지 않은 그림" 안내 표시', await isVisible(page, '[data-testid="pending-note"]'));
  await click(page, '[data-testid="undo"]');
  check('실행 취소: 이전 그림(적용된 하트)으로 돌아간다', !(await state(page)).pending);
  await click(page, '[data-testid="redo"]');
  check('다시 실행: 별 스트로크 복원', (await state(page)).pending);
  const spec1 = (await state(page)).counters.spectrum;

  // Esc로 닫기 → 포커스 복귀 → 데이터 유지
  await page.keyboard.press('Escape');
  await wait(450);
  check('Esc로 닫힌다 (숨김)', (await drawerHidden(page)) && !(await state(page)).editorOpen);
  check('닫으면 "그림 편집" 버튼으로 포커스가 돌아온다', await page.evaluate(() => document.activeElement?.id === 'open-editor'));
  check('적용하지 않은 편집이 있으면 헤더에 표시점이 뜬다', await exists(page, '[data-testid="pending-dot"]'));
  check('닫기만으로 그림이 사라지거나 적용되지 않는다', (await state(page)).pending && (await state(page)).drawingPoints > 100 && (await state(page)).analysisId === id0);
  {
    // 닫힌 드로어: 직접 포커스를 줘도 받지 않고, Tab 순서에도 나타나지 않는다.
    await page.evaluate(() => document.querySelector('[data-testid="apply-close"]').focus());
    let reached = await inDrawer(page);
    await page.evaluate(() => document.body.focus());
    for (let i = 0; i < 60 && !reached; i++) {
      await page.keyboard.press('Tab');
      if (await inDrawer(page)) reached = true;
    }
    check('닫힌 드로어의 컨트롤은 포커스를 받지 않고 Tab 순서에도 없다', !reached);
    await page.evaluate(() => document.getElementById('open-editor').focus());
  }
  check('메인 화면 확대 상태가 드로어 열고 닫기에 영향받지 않는다', (await state(page)).view.zoom === zoomed.view.zoom, `zoom=${(await state(page)).view.zoom.toFixed(3)}`);

  // 다시 열기: 편집한 그림 복원, 포커스 트랩
  await page.click('[data-testid="open-editor"]');
  await wait(450);
  st = await state(page);
  check('다시 열면 편집하던 그림이 그대로 복원된다', st.editorOpen && st.pending && st.drawingPoints > 100);
  let trapOk = true;
  for (let i = 0; i < 40; i++) {
    await page.keyboard.press('Tab');
    if (!(await inDrawer(page))) {
      trapOk = false;
      break;
    }
  }
  check('Tab을 40번 눌러도 포커스가 드로어 밖으로 나가지 않는다', trapOk);
  await page.focus('[data-testid="edit-close"]');
  await page.keyboard.down('Shift');
  await page.keyboard.press('Tab');
  await page.keyboard.up('Shift');
  check('첫 요소에서 Shift+Tab → 마지막 요소로 순환', await page.evaluate(() => document.activeElement?.getAttribute('data-testid') === 'apply-close'));

  {
    const scrolled = await page.$eval('[data-testid="edit-drawer"] .overflow-y-auto', (e) => e.scrollTop);
    await page.keyboard.press('Escape');
    await wait(450);
    await page.click('[data-testid="open-editor"]');
    await wait(450);
    const top = await page.$eval('[data-testid="edit-drawer"] .overflow-y-auto', (e) => e.scrollTop);
    check('다시 열면 드로어 본문이 맨 위(그림 캔버스)부터 시작한다', top === 0, `이전 스크롤 ${Math.round(scrolled)}px → ${top}px`);
  }

  // 경로 모드, 입력 오류
  await clickRadio(page, '경로 처리 방식', '왕복 경로');
  st = await state(page);
  check('경로 모드는 편집 중 그림에만 적용 (적용 전까지 메인 불변)', st.drawingMode === 'retrace' && st.pathMode === 'closed');
  check('경로 설명이 모드에 맞게 바뀐다', (await page.$eval('[data-testid="mode-help"]', (e) => e.textContent)).includes('되돌아옵니다'));
  await page.$eval('[data-testid="drawing-frame"]', (e) => e.scrollIntoView({ block: 'start' }));
  await wait(100);
  const fr2 = await rect(page, '[data-testid="drawing-frame"]');
  await page.mouse.click(fr2.x + 100, fr2.y + 100);
  await wait(100);
  let notice = await page.$eval('[data-testid="notice"]', (el) => el.textContent).catch(() => '');
  check('점 하나(클릭)는 이유와 함께 거부된다', notice.includes('점 하나만'), notice);
  await page.mouse.move(fr2.x + 100, fr2.y + 100);
  await page.mouse.down();
  await page.mouse.move(fr2.x + 102, fr2.y + 101, { steps: 3 });
  await page.mouse.up();
  await wait(100);
  notice = await page.$eval('[data-testid="notice"]', (el) => el.textContent).catch(() => '');
  check('아주 짧은 선도 거부된다', notice.includes('너무 짧습니다'), notice);
  await click(page, '[data-testid="clear"]');
  await click(page, '[data-testid="apply-close"]');
  await wait(120);
  notice = await page.$eval('[data-testid="notice"]', (el) => el.textContent).catch(() => '');
  check('빈 그림은 적용되지 않고 드로어가 열린 채 안내', (await state(page)).editorOpen && notice.includes('비어'), notice);
  await click(page, '[data-testid="undo"]');
  await click(page, '[data-testid="undo"]'); // clear → (정리) 별 스트로크 + 모드 변경은 같은 항목

  // 편집 완료 · 재구성
  await mouseStroke(page, heartPoints(await rect(page, '[data-testid="drawing-frame"]')));
  await wait(100);
  const sp = (await state(page)).counters.spectrum;
  const preApply = await state(page);
  await click(page, '[data-testid="apply-close"]');
  await wait(450);
  st = await state(page);
  check('편집 완료·재구성: 새 그림으로 분석, 드로어 닫힘, t = 0에서 재생', st.analysisId === preApply.analysisId + 1 && st.source === 'user' && !st.editorOpen && st.playing && st.t < 0.2 && !st.pending, `source=${st.source} t=${st.t.toFixed(3)}`);
  check('적용 시 경로 모드가 함께 적용된다', st.pathMode === st.drawingMode);
  check('FFT는 적용할 때 정확히 한 번만 다시 계산', st.counters.spectrum === sp + 1, `${sp}→${st.counters.spectrum}`);
  check('마우스로 그린 하트: K = 33에서 상대 오차 < 3%', st.relativeRmse < 0.03, `${(st.relativeRmse * 100).toFixed(3)}%`);
  check('새 그림 적용 후 화면 맞춤이 수행된다 (확대 상태 초기화)', Math.abs(st.view.zoom - zoomed.view.zoom) > 1e-6 || st.view.cx !== zoomed.view.cx);
  check('드로어 열기·닫기·그리기·실행 취소에서 FFT는 실행되지 않는다', spec1 === pre.counters.spectrum, `${pre.counters.spectrum} → ${spec1}`);

  // 배경(backdrop) 클릭으로 닫기, 예제 즉시 적용
  await page.click('[data-testid="open-editor"]');
  await wait(450);
  {
    const idBefore = (await state(page)).analysisId;
    await clickRadio(page, '경로 처리 방식', '열린 경로');
    await click(page, '[data-testid="run"]');
    await wait(150);
    st = await state(page);
    check('"재구성 다시 시작": 적용하되 드로어는 열린 채, 경로 모드도 적용', st.editorOpen && st.pathMode === 'open' && st.analysisId === idBefore + 1 && st.t < 0.2, `pathMode=${st.pathMode}`);
  }
  await click(page, '[data-testid="preset-star"]');
  await wait(100);
  st = await state(page);
  check('예제 선택은 즉시 적용되고 드로어는 열린 채', st.source === 'star' && st.editorOpen && !st.pending && st.pathMode === 'closed');
  await page.mouse.click(1300, 450); // 배경(드로어 바깥)
  await wait(450);
  check('바깥(배경)을 누르면 닫힌다', !(await state(page)).editorOpen);
  await click(page, '[data-testid="circles-100"]');

  section('분석 패널 · 확대/이동 · 저장');
  await click(page, '[data-testid="analysis-toggle"]');
  await wait(300);
  const aState = await state(page);
  check('분석 패널을 열면 스펙트럼 차트가 보이고, 재생 상태는 그대로', (await exists(page, '[data-testid="spectrum-chart"] svg')) && aState.restarts === (await state(page)).restarts);
  await clickRadio(page, '분석 보기', '원 개수와 오차');
  await wait(300);
  check('"원 개수와 오차" 차트와 RMSE 표시', (await exists(page, '[data-testid="error-chart"] svg')) && (await page.$eval('[data-testid="rmse-value"]', (e) => e.textContent)) === (await state(page)).rmse.toPrecision(4));
  await clickRadio(page, '분석 보기', '수학 원리');
  check('"수학 원리" 설명이 열린다', (await page.evaluate(() => document.body.textContent)).includes('푸리에 급수란?'));
  await click(page, '[data-testid="analysis-toggle"]');
  check('분석 패널을 닫으면 차트가 사라진다', !(await exists(page, '#analysis-body')));

  const vr = await rect(page, '[data-testid="viz-canvas"]');
  const z0 = (await state(page)).view.zoom;
  await page.mouse.move(vr.x + vr.width / 2, vr.y + vr.height / 2);
  await page.mouse.wheel({ deltaY: -300 });
  await wait(80);
  const z1 = (await state(page)).view.zoom;
  await page.mouse.move(vr.x + 200, vr.y + 200);
  await page.mouse.down();
  await page.mouse.move(vr.x + 280, vr.y + 240, { steps: 5 });
  await page.mouse.up();
  st = await state(page);
  check('휠 확대와 드래그 이동', z1 > z0 && (Math.abs(st.view.cx) > 1e-3 || Math.abs(st.view.cy) > 1e-3), `zoom ${z0.toFixed(2)}→${z1.toFixed(2)}`);
  const zk = st.view.zoom;
  await click(page, '[data-testid="circles-10"]');
  check('확대·이동 상태는 원 개수를 바꿔도 유지된다', (await state(page)).view.zoom === zk && (await state(page)).view.cx === st.view.cx);
  await click(page, 'button[aria-label="화면 맞춤"]');
  st = await state(page);
  check('화면 맞춤 버튼', Math.abs(st.view.zoom - zk) > 1e-6);
  await click(page, 'button[aria-label="원점 복귀 (기본 보기)"]');
  st = await state(page);
  check('원점 복귀', st.view.cx === 0 && st.view.cy === 0 && st.view.zoom === 1);

  // 원 클릭 선택
  await click(page, '[data-testid="open-editor"]');
  await wait(300);
  await click(page, '[data-testid="preset-circle"]');
  await click(page, '[data-testid="edit-close"]');
  await wait(300);
  await click(page, '[data-testid="circles-1"]');
  if ((await state(page)).playing) await click(page, '[data-testid="play-toggle"]');
  await setRange(page, '[data-testid="timeline"]', 0);
  await click(page, 'button[aria-label="원점 복귀 (기본 보기)"]');
  await wait(100);
  st = await state(page);
  {
    const s = st.view.pixelsPerUnit;
    const [cx, cy] = toScreen(st, [0, 0]);
    const r = await rect(page, '[data-testid="viz-canvas"]');
    await page.mouse.click(r.x + cx - 0.7 * s, r.y + cy);
    await wait(150);
    st = await state(page);
    check('원을 클릭하면 해당 성분이 선택된다 (k = +1)', st.selectedK === 1, `selectedK=${st.selectedK}`);
    const info = await page.$eval('[data-testid="component-info"]', (el) => el.textContent).catch(() => '');
    check('성분 카드에 주파수·방향 표시', info.includes('k = +1') && info.includes('반시계'));
  }

  await click(page, '[data-testid="open-editor"]');
  await wait(300);
  await click(page, '[data-testid="preset-heart"]');
  await click(page, '[data-testid="edit-close"]');
  await wait(300);
  await click(page, '[data-testid="circles-10"]');

  // PNG / JSON
  await page.click('[data-testid="export-menu"]');
  await click(page, '[data-testid="export-current"]');
  let file = await waitForDownload('fourierlab-view.png');
  const cv = (await state(page)).canvas;
  check('PNG(현재 화면): 올바른 이미지, 캔버스 크기', !!file && pngSize(file).sig && pngSize(file).width === Math.round(cv.width) && pngSize(file).height === Math.round(cv.height), file ? `${pngSize(file).width}×${pngSize(file).height}` : 'no file');
  await page.click('[data-testid="export-menu"]');
  await click(page, '[data-testid="export-reconstruction"]');
  file = await waitForDownload('fourierlab-reconstruction.png');
  check('PNG(재구성 결과): 1600×1600', !!file && pngSize(file).width === 1600 && pngSize(file).height === 1600);
  await page.click('[data-testid="export-menu"]');
  await click(page, '[data-testid="export-original"]');
  file = await waitForDownload('fourierlab-original.png');
  check('PNG(원본 그림): 1600×1600', !!file && pngSize(file).width === 1600);

  await click(page, '[data-testid="circles-10"]');
  const saved = await state(page);
  await click(page, '[data-testid="save-project"]');
  file = await waitForDownload('fourierlab-project.json');
  check('프로젝트 JSON 저장', !!file);
  if (file) {
    const json = JSON.parse(fs.readFileSync(file, 'utf8'));
    check('JSON: 형식·버전·원 개수', json.format === 'fourierlab-project' && json.version === 1 && json.settings.circleCount === 10);
    await click(page, '[data-testid="circles-100"]');
    await click(page, '[data-testid="open-editor"]');
    await wait(300);
    await click(page, '[data-testid="preset-star"]');
    await click(page, '[data-testid="edit-close"]');
    await wait(300);
    const input = await page.$('[data-testid="load-project"]');
    await input.uploadFile(file);
    await wait(400);
    const loaded = await state(page);
    check('불러오기: 같은 재구성 결과 복원 (RMSE 일치)', loaded.circleCount === 10 && loaded.source === 'file' && Math.abs(loaded.rmse - saved.rmse) < 1e-6 * Math.max(1, saved.rmse), `${saved.rmse.toExponential(4)} → ${loaded.rmse.toExponential(4)}`);
    check('불러온 직후 t = 0에서 재생', loaded.t < 0.3 && loaded.playing);
    const bad = path.join(DOWNLOADS, 'bad.json');
    fs.writeFileSync(bad, JSON.stringify({ ...json, settings: { ...json.settings, speed: 1000 } }));
    await input.uploadFile(bad);
    await wait(300);
    const toast = await page.$eval('[data-testid="toast"]', (el) => el.textContent).catch(() => '');
    check('잘못된 프로젝트 파일은 이유와 함께 거부 (상태 불변)', toast.includes('불러오지 못했습니다') && (await state(page)).circleCount === 10, toast);
  }

  section('새로고침 복원');
  // 적용하지 않은 편집도 자동 저장된다
  await page.click('[data-testid="open-editor"]');
  await wait(450);
  await mouseStroke(page, starPoints(await rect(page, '[data-testid="drawing-frame"]')));
  await page.keyboard.press('Escape');
  await wait(900);
  const beforeReload = await state(page);
  await page.reload({ waitUntil: 'networkidle0' });
  await wait(500);
  const afterReload = await state(page);
  check('새로고침: 적용된 그림·설정 복원', afterReload.circleCount === beforeReload.circleCount && afterReload.strokePoints === beforeReload.strokePoints && Math.abs(afterReload.rmse - beforeReload.rmse) < 1e-9);
  check('새로고침: 적용하지 않은 편집 중인 그림도 복원', afterReload.pending && afterReload.drawingPoints === beforeReload.drawingPoints, `pending=${afterReload.pending} points=${afterReload.drawingPoints}`);
  check('새로고침 후 캔버스가 정상적으로 그려진다', (await inkFraction(page, 'canvas[aria-hidden="true"]')) > 0.005 && (await trailPixels(page)) >= 0);
  await page.close();
}

// ═════════════════════════════ reduced motion ═════════════════════════════
{
  const page = await open({ width: 1440, height: 900 });
  await page.emulateMediaFeatures([{ name: 'prefers-reduced-motion', value: 'reduce' }]);
  await page.goto(URL_, { waitUntil: 'networkidle0' });
  await page.evaluate(() => localStorage.clear());
  await page.reload({ waitUntil: 'networkidle0' });
  await wait(500);
  const st = await state(page);
  check('prefers-reduced-motion: 자동 재생하지 않고 첫 프레임을 보여준다', st.playing === false && st.t === 0);
  await page.click('[data-testid="open-editor"]');
  await wait(60);
  check('prefers-reduced-motion: 드로어가 전환 없이 바로 열린다', (await rect(page, '[data-testid="edit-drawer"]')).x === 0);
  await page.close();
}

// ═════════════════════════════ VIEWPORT MATRIX ═════════════════════════════
section('뷰포트별 레이아웃 (가로 스크롤, 첫 화면 컨트롤, 드로어)');
{
  const viewports = [
    { name: '360×800', width: 360, height: 800, mobile: true },
    { name: '390×844', width: 390, height: 844, mobile: true },
    { name: '430×932', width: 430, height: 932, mobile: true },
    { name: '768×1024', width: 768, height: 1024, mobile: true },
    { name: '1280×720', width: 1280, height: 720, mobile: false },
    { name: '1440×900', width: 1440, height: 900, mobile: false },
  ];
  for (const v of viewports) {
    const page = await open({ width: v.width, height: v.height, deviceScaleFactor: v.mobile ? 2 : 1, isMobile: v.mobile, hasTouch: v.mobile });
    await page.goto(URL_, { waitUntil: 'networkidle0' });
    await page.evaluate(() => localStorage.clear());
    await page.reload({ waitUntil: 'networkidle0' });
    await wait(500);
    const over = await noOverflow(page);
    const st = await state(page);
    const first = ['[data-testid="play-toggle"]', '[data-testid="circle-slider"]', '[data-testid="circles-100"]'];
    const rects = await Promise.all(first.map((s) => rect(page, s)));
    const stage = await rect(page, '[data-testid="stage"]');
    check(`${v.name}: 가로 스크롤 없음`, over <= 0, `overflow=${over}px`);
    check(`${v.name}: 재생·원 개수 조절·빠른 선택이 첫 화면 안에 있다`, rects.every((r) => r.top >= 0 && r.bottom <= v.height && r.right <= v.width + 0.5), rects.map((r) => Math.round(r.bottom)).join('/'));
    check(`${v.name}: 메인 캔버스 ${Math.round(stage.width)}×${Math.round(stage.height)}`, stage.height >= 300 && stage.width >= v.width * 0.9, `${Math.round(stage.width)}×${Math.round(stage.height)}`);
    check(`${v.name}: 캔버스가 그려져 있다`, (await inkFraction(page, 'canvas[aria-hidden="true"]')) > 0.005 && st.canvas.width > 200);
    await page.click('[data-testid="open-editor"]');
    await wait(450);
    const dr = await rect(page, '[data-testid="edit-drawer"]');
    const fr = await rect(page, '[data-testid="drawing-frame"]');
    const ap = await rect(page, '[data-testid="apply-close"]');
    const dOver = await page.$eval('[data-testid="edit-drawer"]', (e) => e.scrollWidth - e.clientWidth);
    check(
      `${v.name}: 드로어(${Math.round(dr.width)}×${Math.round(dr.height)}) 안에 그림 캔버스 ${Math.round(fr.width)}px와 적용 버튼이 들어간다`,
      fr.left >= 0 && fr.right <= v.width && fr.width >= Math.min(300, v.width - 40) && ap.bottom <= v.height && ap.top >= 0 && dOver <= 0 && (v.width > 640 ? dr.width <= 600 : dr.width === v.width),
      `frame=${Math.round(fr.width)} apply.bottom=${Math.round(ap.bottom)}`,
    );
    await page.keyboard.press('Escape');
    await wait(400);
    await page.close();
  }
}

// ═════════════════════════════ MOBILE (touch) ═════════════════════════════
section('모바일 터치 (390×844, 터치 에뮬레이션)');
{
  const page = await open({ width: 390, height: 844, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
  await page.goto(URL_, { waitUntil: 'networkidle0' });
  await page.evaluate(() => localStorage.clear());
  await page.reload({ waitUntil: 'networkidle0' });
  await wait(600);
  const touch = await Touch.attach(page);
  let st = await state(page);
  let notice = '';

  check('첫 화면에 그림 편집기가 열려 있지 않다', !st.editorOpen && (await drawerHidden(page)));
  const stage = await rect(page, '[data-testid="stage"]');
  check('모바일 메인 캔버스 높이 ≥ 380px', stage.height >= 380, `${Math.round(stage.width)}×${Math.round(stage.height)}`);

  // 터치 대상 크기
  const sizes = {};
  for (const [name, sel] of [
    ['재생', '[data-testid="play-toggle"]'],
    ['처음으로', 'button[aria-label="처음으로 이동"]'],
    ['이전 단계', 'button[aria-label="한 단계 뒤로"]'],
    ['다음 단계', 'button[aria-label="한 단계 진행"]'],
    ['다시 시작', 'button[aria-label="처음부터 다시 재생"]'],
    ['빠른 선택 10', '[data-testid="circles-10"]'],
    ['빠른 선택 전체', '[data-testid="circles-all"]'],
    ['그림 편집', '[data-testid="open-editor"]'],
    ['더보기 메뉴', '[data-testid="more-menu"]'],
    ['속도·성분·표시 펼치기', '[data-testid="dock-more-toggle"]'],
    ['확대', 'button[aria-label="확대"]'],
    ['원 슬라이더', '[data-testid="circle-slider"]'],
    ['타임라인', '[data-testid="timeline"]'],
  ]) {
    const r = await rect(page, sel);
    sizes[name] = `${Math.round(r.width)}×${Math.round(r.height)}`;
    check(`터치 대상 ≥ 44px: ${name}`, r.height >= 43.5 && (r.width >= 43.5 || name.includes('슬라이더') || name === '타임라인' || name.includes('펼치기')), sizes[name]);
  }

  // 더보기 접이식 영역
  check('속도 슬라이더는 기본적으로 접혀 있다', !(await isVisible(page, '[data-testid="speed-slider"]')));
  await click(page, '[data-testid="dock-more-toggle"]');
  await wait(100);
  check('"속도·성분 선택·표시 옵션"을 펼치면 속도 슬라이더가 보인다', await isVisible(page, '[data-testid="speed-slider"]'));
  await click(page, '[data-testid="dock-more-toggle"]');

  // 슬라이더 터치 드래그: 미리보기 → 손을 떼면 확정
  {
    await setRange(page, '[data-testid="timeline"]', 5000);
    const s0 = await state(page);
    const sr = await rect(page, '[data-testid="circle-slider"]');
    const yy = sr.y + sr.height / 2;
    const x = (f) => sr.x + 14 + f * (sr.width - 28);
    const f0 = Math.log(s0.circleCount) / Math.log(1023);
    await touch.start([[x(f0), yy]]);
    const ks = [];
    let restartedDuring = false;
    for (const f of [0.3, 0.35, 0.4, 0.5, 0.6, 0.7]) {
      await touch.move([[x(f), yy]]);
      await wait(40);
      const s = await state(page);
      ks.push(s.circleCount);
      if (s.restarts !== s0.restarts) restartedDuring = true;
    }
    await touch.end();
    await wait(100);
    st = await state(page);
    check('터치 드래그 중에는 미리보기만, 손가락을 떼면 한 번 재시작', new Set(ks).size >= 4 && !restartedDuring && st.restarts === s0.restarts + 1 && st.t < 0.06, `K: ${ks.join('→')} restarts+${st.restarts - s0.restarts}`);
    check('터치 슬라이더 조작 후 페이지가 스크롤되지 않았다', (await page.evaluate(() => scrollY)) === 0);
  }
  // 빠른 선택 터치
  {
    const r = await rect(page, '[data-testid="circles-50"]');
    const r0 = (await state(page)).restarts;
    await touch.tap(...center(r));
    await wait(100);
    st = await state(page);
    check('빠른 선택 버튼을 터치하면 K = 50, 처음부터', st.circleCount === 50 && st.restarts === r0 + 1 && st.t < 0.06);
  }

  // 핀치 확대·축소, 한 손가락 이동 (페이지 스크롤과 충돌하지 않음)
  {
    const vr = await rect(page, '[data-testid="viz-canvas"]');
    const [cx, cy] = center(vr);
    await page.evaluate(() => scrollTo(0, 0));
    const z0 = (await state(page)).view.zoom;
    await touch.pinch([[cx - 40, cy], [cx + 40, cy]], [[cx - 110, cy], [cx + 110, cy]]);
    await wait(100);
    const z1 = (await state(page)).view.zoom;
    check('두 손가락 벌리기: 확대', z1 > z0 * 1.8, `zoom ${z0.toFixed(2)} → ${z1.toFixed(2)}`);
    await touch.pinch([[cx - 120, cy], [cx + 120, cy]], [[cx - 50, cy], [cx + 50, cy]]);
    await wait(100);
    const z2 = (await state(page)).view.zoom;
    check('두 손가락 모으기: 축소', z2 < z1 * 0.6, `zoom ${z1.toFixed(2)} → ${z2.toFixed(2)}`);
    const v0 = await state(page);
    await touch.drag(lerpPath([cx, cy + 80], [cx + 60, cy - 60], 8));
    await wait(100);
    const v1 = await state(page);
    check('한 손가락 드래그: 화면 이동 (페이지는 스크롤되지 않음)', (Math.abs(v1.view.cx - v0.view.cx) > 1e-3 || Math.abs(v1.view.cy - v0.view.cy) > 1e-3) && (await page.evaluate(() => scrollY)) === 0);
    check('핀치·이동 중 재생이 멈추거나 재시작되지 않는다', v1.restarts === v0.restarts && v1.playing === v0.playing);
    await click(page, 'button[aria-label="화면 맞춤"]');
  }

  // 컨트롤 영역 세로 스크롤은 정상 동작
  {
    const dock = await rect(page, '[data-testid="controls-dock"]');
    await touch.drag(lerpPath([dock.x + 8, dock.y + 40], [dock.x + 8, dock.y - 260], 12));
    await wait(500);
    const sy = await page.evaluate(() => scrollY);
    check('컨트롤 영역을 위로 쓸면 페이지가 세로 스크롤된다', sy > 100, `scrollY=${Math.round(sy)}`);
    await page.evaluate(() => scrollTo(0, 0));
  }

  // 모바일 드로어: 전체 화면, 터치로 그리기
  {
    const eb = await rect(page, '[data-testid="open-editor"]');
    await touch.tap(...center(eb));
    await wait(500);
    st = await state(page);
    const dr = await rect(page, '[data-testid="edit-drawer"]');
    const fr = await rect(page, '[data-testid="drawing-frame"]');
    check('터치로 드로어가 열린다 (전체 화면)', st.editorOpen && dr.width === 390 && Math.round(dr.height) === 844, `${dr.width}×${Math.round(dr.height)}`);
    check('그림 캔버스가 가로 폭을 충분히 사용 (≥ 340px, 정사각형)', fr.width >= 340 && Math.abs(fr.width - fr.height) < 1, `${Math.round(fr.width)}px`);
    check('"편집 완료 · 재구성" 버튼이 화면 안에 보인다', (await rect(page, '[data-testid="apply-close"]')).bottom <= 844);
    check('드로어가 열려 있으면 뒤쪽 페이지는 스크롤되지 않는다', await page.evaluate(() => getComputedStyle(document.body).overflow === 'hidden'));
    const id0 = st.analysisId;
    const star = starPoints(fr, 6);
    await touch.drag(star);
    await wait(150);
    st = await state(page);
    check('터치로 그린 선이 저장되고 페이지는 스크롤되지 않는다', st.pending && st.drawingPoints > 40 && st.analysisId === id0 && (await page.evaluate(() => scrollY)) === 0, `points=${st.drawingPoints}`);
    // 두 번째 손가락이 닿아도 그리던 선이 망가지지 않는다
    const before = (await state(page)).drawingPoints;
    await touch.start([[fr.x + 60, fr.y + 60]]);
    await touch.move([[fr.x + 120, fr.y + 90]]);
    await touch.cancel();
    await wait(150);
    notice = await page.$eval('[data-testid="notice"]', (el) => el.textContent).catch(() => '');
    check('입력이 중간에 취소(pointercancel)되면 안내하고 기존 그림은 유지', notice.includes('취소') && (await state(page)).drawingPoints === before, notice);
    // 적용
    const ab = await rect(page, '[data-testid="apply-close"]');
    await touch.tap(...center(ab));
    await wait(500);
    st = await state(page);
    check('터치로 "편집 완료 · 재구성": 새 그림 재생, 드로어 닫힘', !st.editorOpen && st.source === 'user' && st.analysisId === id0 + 1 && st.playing && st.t < 0.2);
    check('드로어를 닫으면 페이지 스크롤 잠금이 풀린다', await page.evaluate(() => getComputedStyle(document.body).overflow !== 'hidden'));
  }

  // 화면 회전(가로)
  await page.setViewport({ width: 844, height: 390, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
  await wait(600);
  st = await state(page);
  check('가로 회전(844×390): 가로 스크롤 없음, 캔버스가 비어 있지 않다', (await noOverflow(page)) <= 0 && st.canvas.height >= 290 && (await inkFraction(page, 'canvas[aria-hidden="true"]')) > 0.005, `canvas=${Math.round(st.canvas.width)}×${Math.round(st.canvas.height)}`);
  await page.setViewport({ width: 390, height: 844, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
  await wait(600);
  check('세로로 되돌린 뒤에도 정상', (await noOverflow(page)) <= 0 && (await inkFraction(page, 'canvas[aria-hidden="true"]')) > 0.005);
  await page.screenshot({ path: path.join(OUT, 'e2e-mobile.png') });
  await page.close();
}

check('콘솔 오류·실패한 요청·HTTP 오류 없음', problems.length === 0, problems.slice(0, 5).join(' | '));

await browser.close();
server?.close();
console.log(failed ? `\n${failed}/${total} check(s) failed` : `\nAll ${total} browser checks passed`);
process.exit(failed ? 1 : 0);
