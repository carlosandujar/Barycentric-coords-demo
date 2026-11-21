import { DISTORTION_LIMITS } from './distortion.js';

/** Special-color triangles are counted separately from the continuous color scale. */
export function buildDistortionHistogram(analysis, mode) {
  const min = mode === 'angle' ? 0 : -DISTORTION_LIMITS.area;
  const max = mode === 'angle' ? DISTORTION_LIMITS.angle : DISTORTION_LIMITS.area;
  const bins = Array.from({ length: 20 }, (_, i) => ({
    lower: min + (max - min) * i / 20,
    upper: min + (max - min) * (i + 1) / 20,
    count: 0, percentage: 0,
  }));
  let total = 0;
  for (const face of analysis.faces) {
    if (face.invalid || face.collapsed || face.inverted) continue;
    const value = mode === 'angle' ? face.angleError : face.areaLog2;
    if (!Number.isFinite(value)) continue;
    const index = bins.findIndex(bin => value < bin.upper);
    bins[index === -1 ? bins.length - 1 : index].count++;
    total++;
  }
  for (const bin of bins) bin.percentage = total ? 100 * bin.count / total : 0;
  return { bins, total, min, max, maxPercentage: Math.max(...bins.map(bin => bin.percentage)) };
}
