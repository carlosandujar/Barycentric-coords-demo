import { Color } from 'three';
import { distortionColor, DISTORTION_LIMITS } from './distortion.js';
import { buildDistortionHistogram } from './distortion-histogram.js';

// Vertex colors are linear RGB; CSS colors need the same sRGB conversion as the viewers.
const cssColor = (face, mode) => new Color(...distortionColor(face, mode)).getStyle();

function createLegendItem(kind, mode, count) {
  const item = document.createElement('span');
  item.className = 'legend-exception';
  const swatch = document.createElement('i');
  swatch.style.background = cssColor({ [kind]: true }, mode);
  item.append(swatch, `${kind[0].toUpperCase() + kind.slice(1)} ${count}`);
  return item;
}

export function createDistortionLegend(container) {
  const legend = document.createElement('aside');
  legend.className = 'distortion-legend';
  legend.hidden = true;
  legend.innerHTML = '<div class="legend-title"></div><div class="legend-histogram"><div class="histogram-columns"></div><span class="histogram-maximum" aria-hidden="true"></span></div><div class="legend-ticks"></div><div class="legend-ramp" aria-hidden="true"></div><div class="legend-exceptions"></div>';
  container.append(legend);
  new ResizeObserver(() => container.style.setProperty('--distortion-legend-height', `${legend.getBoundingClientRect().height}px`)).observe(legend);
  return (mode, analysis) => {
    legend.hidden = !analysis || !['angle', 'area', 'inversions'].includes(mode);
    container.classList.toggle('has-distortion-histogram', !legend.hidden && mode !== 'inversions');
    if (legend.hidden) return;
    const inversions = mode === 'inversions';
    legend.classList.toggle('inversions-legend', inversions);
    legend.querySelector('.legend-histogram').hidden = inversions;
    legend.querySelector('.legend-ticks').hidden = inversions;
    legend.querySelector('.legend-ramp').hidden = inversions;
    if (inversions) {
      legend.querySelector('.legend-title').textContent = 'Inversions';
      legend.title = 'Triangle orientation: green = positive, red = inverted, gold = collapsed, gray = invalid source geometry.';
      legend.setAttribute('aria-label', legend.title);
      const counts = { positive: analysis.faces.length - analysis.inverted.length - analysis.collapsed.length - analysis.invalid.length,
        inverted: analysis.inverted.length, collapsed: analysis.collapsed.length, invalid: analysis.invalid.length };
      legend.querySelector('.legend-exceptions').replaceChildren(...Object.keys(counts).map(kind => createLegendItem(kind, mode, counts[kind])));
      return;
    }
    const angle = mode === 'angle';
    legend.querySelector('.legend-title').textContent = angle ? 'Angle distortion · degrees' : 'Area distortion · relative area';
    legend.title = angle
      ? `Maximum corner angle error per triangle. Colors saturate at ${DISTORTION_LIMITS.angle} degrees.`
      : `Ratio of normalized UV area to normalized mesh area, on a log₂ scale. 1× preserves relative area. Colors saturate at log₂ = ±${DISTORTION_LIMITS.area}.`;
    const histogram = buildDistortionHistogram(analysis, mode);
    legend.title += ` Bar heights show percentages of ${histogram.total} measurable, non-inverted triangles, without area weighting. Special-color triangles are counted separately. The first and last bins include values beyond the scale limits.`;
    legend.setAttribute('aria-label', legend.title);
    legend.querySelector('.histogram-maximum').textContent = histogram.total ? `${histogram.maxPercentage.toFixed(1)}%` : 'No regular triangles';
    legend.querySelector('.histogram-columns').replaceChildren(...histogram.bins.map((bin, i) => {
      const column = document.createElement('span');
      column.className = 'histogram-bin';
      column.tabIndex = 0;
      const midpoint = (bin.lower + bin.upper) / 2;
      const color = cssColor(angle ? { angleError: midpoint } : { areaLog2: midpoint }, mode);
      column.style.borderColor = color;
      const bar = document.createElement('i');
      bar.style.background = color;
      bar.style.height = `${histogram.maxPercentage ? 100 * bin.percentage / histogram.maxPercentage : 0}%`;
      if (bin.count) bar.style.minHeight = '1px';
      const unit = angle ? '°' : ' log₂';
      const interval = i === histogram.bins.length - 1 ? `≥ ${bin.lower.toFixed(2)}${unit} (includes > ${histogram.max}${unit})`
        : !angle && i === 0 ? `< ${bin.upper.toFixed(2)}${unit} (includes < ${histogram.min}${unit})`
        : `${bin.lower.toFixed(2)} to < ${bin.upper.toFixed(2)}${unit}`;
      column.title = `${interval}: ${bin.count} / ${histogram.total} triangles (${bin.percentage.toFixed(1)}%)`;
      column.setAttribute('role', 'img');
      column.setAttribute('aria-label', column.title);
      column.append(bar);
      return column;
    }));
    const ticks = angle ? ['0°', `${DISTORTION_LIMITS.angle / 2}°`, `≥ ${DISTORTION_LIMITS.angle}°`] : [`≤ 1/${2 ** DISTORTION_LIMITS.area}×`, '1×', `≥ ${2 ** DISTORTION_LIMITS.area}×`];
    legend.querySelector('.legend-ticks').replaceChildren(...ticks.map(value => {
      const tick = document.createElement('span');
      tick.textContent = value;
      return tick;
    }));
    const stops = Array.from({ length: 25 }, (_, i) => {
      const t = i / 24;
      const face = angle ? { angleError: t * DISTORTION_LIMITS.angle } : { areaLog2: (2 * t - 1) * DISTORTION_LIMITS.area };
      return `${cssColor(face, mode)} ${100 * t}%`;
    });
    legend.querySelector('.legend-ramp').style.background = `linear-gradient(to right, ${stops.join(', ')})`;
    // Explain exceptional colors only when they occur, keeping regular maps compact.
    legend.querySelector('.legend-exceptions').replaceChildren(...['inverted', 'collapsed', 'invalid'].filter(kind => analysis[kind].length).map(kind => createLegendItem(kind, mode, analysis[kind].length)));
  };
}
