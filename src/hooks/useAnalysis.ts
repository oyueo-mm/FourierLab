// The analysis pipeline as memoised stages. Each stage reruns only when its own inputs
// change, so moving the circle-count slider never recomputes the FFT:
//
//   stroke, mode, N ─► preparePath ─► computeSpectrum ─► rank (per mode) ─► select K ─► chain / curve
//                                                       └─► error curves (Parseval, both modes)

import { useMemo } from 'react';
import { counters } from '../core/debug';
import type { LabSettings } from '../core/settings';
import { compileChain, type CompiledChain } from '../math/epicycles';
import { computeSpectrum, type Coefficient, type Spectrum } from '../math/fourier';
import { preparePath, type PreparedPath, type Vec2 } from '../math/path';
import { curveResolution, errorCurve, evaluateSeries, rmsRadius, type Curve } from '../math/reconstruct';
import { rankComponents, selectComponents, type Selection } from '../math/selection';

export interface Analysis {
  prepared: PreparedPath;
  spectrum: Spectrum;
  ranked: { frequency: Coefficient[]; amplitude: Coefficient[] };
  errors: { frequency: Float64Array; amplitude: Float64Array };
  selection: Selection;
  chain: CompiledChain;
  curve: Curve;
  /** RMSE of the current selection at the sample instants (math units). */
  rmse: number;
  /** RMS distance of the samples from their centroid; RMSE / scale is the relative error. */
  scale: number;
  /** Amplitude rank (1 = largest) of each rotating frequency. */
  amplitudeRank: Map<number, number>;
}

export type AnalysisResult = { ok: true; analysis: Analysis } | { ok: false; error: string };

export function useAnalysis(stroke: readonly Vec2[], settings: LabSettings): AnalysisResult {
  const { pathMode, sampleCount, selectionMode, circleCount, chainOrder } = settings;

  const prepared = useMemo(() => {
    counters.prepare++;
    return preparePath(stroke, pathMode, sampleCount);
  }, [stroke, pathMode, sampleCount]);

  const base = useMemo(() => {
    if (!prepared.ok) return null;
    counters.spectrum++;
    const spectrum = computeSpectrum(prepared.path.samples);
    const ranked = { frequency: rankComponents(spectrum, 'frequency'), amplitude: rankComponents(spectrum, 'amplitude') };
    const errors = { frequency: errorCurve(ranked.frequency), amplitude: errorCurve(ranked.amplitude) };
    const amplitudeRank = new Map(ranked.amplitude.map((c, i) => [c.k, i + 1]));
    return { spectrum, ranked, errors, amplitudeRank, scale: rmsRadius(spectrum) };
  }, [prepared]);

  const selected = useMemo(() => {
    if (!base) return null;
    const selection = selectComponents(base.spectrum, base.ranked[selectionMode], circleCount, chainOrder);
    return {
      selection,
      chain: compileChain(selection),
      curve: evaluateSeries([selection.dc, ...selection.chain], curveResolution(base.spectrum.n)),
    };
  }, [base, selectionMode, circleCount, chainOrder]);

  return useMemo((): AnalysisResult => {
    if (!prepared.ok) return { ok: false, error: prepared.error.message };
    if (!base || !selected) return { ok: false, error: '분석에 실패했습니다.' };
    const errors = base.errors[selectionMode];
    return {
      ok: true,
      analysis: {
        prepared: prepared.path,
        ...base,
        ...selected,
        rmse: errors[Math.min(selected.selection.chain.length, errors.length - 1)],
      },
    };
  }, [prepared, base, selected, selectionMode]);
}
