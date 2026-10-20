// Math-engine timings and preset accuracy table (Node).  npm run bench
import { performance } from 'node:perf_hooks';
import { compileChain, evaluateChain } from '../src/math/epicycles.ts';
import { dft, fft } from '../src/math/fft.ts';
import { computeSpectrum } from '../src/math/fourier.ts';
import { preparePath } from '../src/math/path.ts';
import { PRESETS } from '../src/math/presets.ts';
import { curveResolution, errorCurve, evaluateSeries, rmsRadius } from '../src/math/reconstruct.ts';
import { rankComponents, selectComponents } from '../src/math/selection.ts';

function time(fn: () => void, minMs = 200): number {
  fn(); // warm-up
  let runs = 0;
  const start = performance.now();
  while (performance.now() - start < minMs) {
    fn();
    runs++;
  }
  return (performance.now() - start) / runs;
}

const heart = PRESETS.find((p) => p.id === 'heart')!;
console.log(`Node ${process.version}\n`);
console.log('N     | FFT (ms) | DFT (ms) | prepare+spectrum+rank (ms) | select K=N-1 + curve (ms) | chain eval K=N-1 (µs)');
for (const n of [256, 512, 1024, 2048]) {
  const re = Float64Array.from({ length: n }, (_, i) => Math.sin(i));
  const im = Float64Array.from({ length: n }, (_, i) => Math.cos(3 * i));
  const tf = time(() => fft(re, im));
  const td = n <= 1024 ? time(() => dft(re, im), 300) : NaN;
  const tPipe = time(() => {
    const p = preparePath(heart.points, 'closed', n);
    if (!p.ok) throw new Error();
    const s = computeSpectrum(p.path.samples);
    rankComponents(s, 'frequency');
    rankComponents(s, 'amplitude');
  });
  const p = preparePath(heart.points, 'closed', n);
  if (!p.ok) throw new Error();
  const s = computeSpectrum(p.path.samples);
  const ranked = rankComponents(s, 'amplitude');
  const tSel = time(() => {
    const sel = selectComponents(s, ranked, n - 1, 'amplitude');
    evaluateSeries([sel.dc, ...sel.chain], curveResolution(n));
  });
  const chain = compileChain(selectComponents(s, ranked, n - 1, 'amplitude'));
  const buf = new Float64Array(2 * (chain.count + 2));
  let t = 0;
  const tEval = time(() => evaluateChain(chain, (t += 0.001) % 1, buf)) * 1000;
  console.log(
    `${String(n).padEnd(5)} | ${tf.toFixed(3).padStart(8)} | ${(Number.isNaN(td) ? '-' : td.toFixed(2)).padStart(8)} | ${tPipe.toFixed(2).padStart(26)} | ${tSel.toFixed(2).padStart(25)} | ${tEval.toFixed(1).padStart(20)}`,
  );
}

console.log('\nRelative RMSE (RMSE / RMS radius), N = 1024, closed path');
console.log('preset    | order     |     K=1 |    K=10 |    K=50 |   K=100 |  K=1023');
for (const id of ['circle', 'heart', 'star', 'square', 'spiral']) {
  const preset = PRESETS.find((p) => p.id === id)!;
  const prep = preparePath(preset.points, 'closed', 1024);
  if (!prep.ok) throw new Error();
  const s = computeSpectrum(prep.path.samples);
  for (const mode of ['frequency', 'amplitude'] as const) {
    const e = errorCurve(rankComponents(s, mode));
    const cells = [1, 10, 50, 100, 1023].map((k) => `${((e[k] / rmsRadius(s)) * 100).toPrecision(2)}%`.padStart(7));
    console.log(`${id.padEnd(9)} | ${mode.padEnd(9)} | ${cells.join(' | ')}`);
  }
}
