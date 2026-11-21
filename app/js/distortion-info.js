const formatMetric = value => Number.isFinite(value) ? value.toFixed(2) : 'N/A';

/** Both views report the same measurements from the displayed parameterization. */
export function createDistortionInfo(container) {
  const panel = document.createElement('aside');
  panel.className = 'distortion-info';
  panel.hidden = true;
  panel.setAttribute('aria-label', 'Parameterization distortion');
  panel.innerHTML = `<strong>Mesh distortion</strong>
    <table aria-label="Mesh distortion statistics">
      <thead><tr><td></td><th scope="col">Mean</th><th scope="col">Max</th></tr></thead>
      <tbody><tr><th scope="row">Area |log₂|</th><td data-value="mean-area"></td><td data-value="max-area"></td></tr>
      <tr><th scope="row">Angle (°)</th><td data-value="mean-angle"></td><td data-value="max-angle"></td></tr></tbody>
    </table>
    <div class="distortion-inverted"><span>Inverted triangles</span><span data-value="inverted"></span></div>
    <p class="distortion-excluded" hidden></p>
    <section class="triangle-distortion" hidden><strong></strong><dl>
      <dt>Area |log₂|</dt><dd data-value="triangle-area"></dd>
      <dt>Area ratio</dt><dd data-value="triangle-ratio"></dd>
      <dt>Angle (°)</dt><dd data-value="triangle-angle"></dd>
    </dl><p class="triangle-status" hidden></p></section>`;
  panel.title = 'Area distortion is |log₂(normalized UV area / normalized mesh area)|: 0 preserves relative area; 1 means twice or half the area. Angle distortion is the maximum corner angle error in degrees. Mean and max use measurable triangles, without area weighting; invalid and collapsed triangles are excluded. Inverted triangles remain included.';
  container.append(panel);
  const setValue = (name, value) => { panel.querySelector(`[data-value="${name}"]`).textContent = value; };
  return (analysis, selection) => {
    panel.hidden = !analysis;
    if (!analysis) return;
    setValue('mean-area', formatMetric(analysis.meanAreaLog2));
    setValue('max-area', formatMetric(analysis.measuredFaceCount ? analysis.maxAreaLog2 : null));
    setValue('mean-angle', formatMetric(analysis.meanAngleError));
    setValue('max-angle', formatMetric(analysis.measuredFaceCount ? analysis.maxAngleError : null));
    setValue('inverted', `${analysis.inverted.length}/${analysis.faces.length}`);
    const excluded = panel.querySelector('.distortion-excluded');
    const excludedCount = analysis.faces.length - analysis.measuredFaceCount;
    excluded.hidden = !excludedCount;
    excluded.textContent = `${excludedCount} collapsed/invalid excluded`;
    const triangle = panel.querySelector('.triangle-distortion');
    triangle.hidden = selection?.type !== 'face';
    if (triangle.hidden) return;
    const face = analysis.faces[selection.id];
    triangle.querySelector('strong').textContent = `Triangle ${selection.id} distortion`;
    setValue('triangle-area', formatMetric(face.areaLog2 === null ? null : Math.abs(face.areaLog2)));
    const ratio = face.areaLog2 === null ? null : 2 ** face.areaLog2;
    setValue('triangle-ratio', ratio === null ? 'N/A' : `${ratio > 0 && (ratio < 0.01 || ratio >= 10000) ? ratio.toExponential(2) : formatMetric(ratio)}×`);
    setValue('triangle-angle', formatMetric(face.angleError));
    const status = triangle.querySelector('.triangle-status');
    status.hidden = !face.invalid && !face.collapsed && !face.inverted;
    status.textContent = face.invalid ? 'Invalid source geometry · N/A' : face.collapsed ? 'Collapsed triangle · N/A' : 'Inverted triangle';
  };
}
