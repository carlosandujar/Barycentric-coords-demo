import test from 'node:test';
import assert from 'node:assert/strict';
import { buildDistortionHistogram } from '../app/js/distortion-histogram.js';

test('angular histogram includes limits and saturated tails without losing triangles', () => {
  const histogram = buildDistortionHistogram({ faces: [0, 3, 30, 60, 120].map(angleError => ({ angleError })) }, 'angle');
  assert.equal(histogram.total, 5);
  assert.equal(histogram.bins[0].count, 1);
  assert.equal(histogram.bins[1].count, 1);
  assert.equal(histogram.bins[10].count, 1);
  assert.equal(histogram.bins[19].count, 2);
  assert.equal(histogram.maxPercentage, 40);
  assert.equal(histogram.bins.reduce((sum, bin) => sum + bin.percentage, 0), 100);
});

test('area histogram preserves contraction and expansion on the signed log scale', () => {
  const histogram = buildDistortionHistogram({ faces: [-99, -3, -2, 0, 2, 3, 99].map(areaLog2 => ({ areaLog2 })) }, 'area');
  assert.equal(histogram.min, -3);
  assert.equal(histogram.max, 3);
  assert.equal(histogram.total, 7);
  assert.equal(histogram.bins[0].count, 2);
  assert.equal(histogram.bins[19].count, 2);
  assert.equal(histogram.bins[10].count, 1);
  assert.equal(histogram.bins.reduce((sum, bin) => sum + bin.count, 0), 7);
});

test('special colors and unavailable metrics do not enter the histogram denominator', () => {
  const faces = [{ angleError: 12 }, { angleError: 12, inverted: true }, { angleError: 12, collapsed: true }, { angleError: 12, invalid: true }, { angleError: null }, { angleError: NaN }];
  const histogram = buildDistortionHistogram({ faces }, 'angle');
  assert.equal(histogram.total, 1);
  assert.equal(histogram.maxPercentage, 100);
  const empty = buildDistortionHistogram({ faces: faces.slice(1) }, 'angle');
  assert.equal(empty.total, 0);
  assert.equal(empty.maxPercentage, 0);
  assert.ok(empty.bins.every(bin => bin.count === 0 && bin.percentage === 0));
});
