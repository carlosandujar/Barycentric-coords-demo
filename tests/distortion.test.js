import test from 'node:test';
import assert from 'node:assert/strict';
import { analyzeParameterization, distortionColor } from '../app/js/distortion.js';

const close = (a, b, tolerance = 1e-9) => assert.ok(Math.abs(a - b) < tolerance, `${a} differs from ${b}`);

test('a similarity of a tilted triangle preserves angles and normalized area', () => {
  const mesh = { positions: [[0, 0, 0], [3, 0, 0], [0, 3, 4]], faces: [[0, 1, 2]], uvs: [[1, 2], [7, 2], [1, 12]] };
  const result = analyzeParameterization(mesh);
  close(result.maxAngleError, 0); close(result.faces[0].areaLog2, 0);
  assert.deepEqual(result.inverted, []); assert.deepEqual(result.collapsed, []);
});

test('angle error and relative area have independent analytical values', () => {
  const mesh = { positions: [[0, 0, 0], [1, 0, 0], [0, 1, 0], [1, 1, 0]], faces: [[0, 1, 2], [1, 3, 2]], uvs: [[0, 0], [1, 0], [0, 1], [2, 1]] };
  const result = analyzeParameterization(mesh);
  close(result.faces[0].angleError, 0);
  close(result.faces[0].areaLog2, Math.log2(2 / 3));
  close(result.faces[1].areaLog2, Math.log2(4 / 3));
  close(result.faces[1].angleError, 45);
  close(result.meanAngleError, 22.5);
  close(result.meanAreaLog2, (Math.abs(Math.log2(2 / 3)) + Math.abs(Math.log2(4 / 3))) / 2);
  close(result.maxAreaLog2, Math.abs(Math.log2(2 / 3)));
  assert.equal(result.measuredFaceCount, 2);
});

test('detects a local fold and a collapsed triangle without treating signed area as stretch', () => {
  const mesh = { positions: [[0, 0, 0], [1, 0, 0], [0, 1, 0], [1, 1, 0]], faces: [[0, 1, 2], [1, 3, 2]], uvs: [[0, 0], [1, 0], [0, 1], [0, 0]] };
  const folded = analyzeParameterization(mesh);
  assert.deepEqual(folded.inverted, [1]);
  close(folded.faces[1].areaLog2, 0);
  assert.equal(folded.measuredFaceCount, 2);
  mesh.uvs[3] = [0.5, 0.5];
  const collapsed = analyzeParameterization(mesh);
  assert.deepEqual(collapsed.inverted, []); assert.deepEqual(collapsed.collapsed, [1]);
  assert.equal(collapsed.faces[1].angleError, null); assert.equal(collapsed.faces[1].areaLog2, null);
  assert.equal(collapsed.measuredFaceCount, 1);
  close(collapsed.meanAngleError, collapsed.faces[0].angleError);
  close(collapsed.meanAreaLog2, Math.abs(collapsed.faces[0].areaLog2));
});

test('all-collapsed meshes have unavailable means rather than zero distortion', () => {
  const result = analyzeParameterization({ positions: [[0, 0, 0], [1, 0, 0], [0, 1, 0]], faces: [[0, 1, 2]], uvs: [[0, 0], [1, 0], [2, 0]] });
  assert.equal(result.measuredFaceCount, 0);
  assert.equal(result.meanAngleError, null);
  assert.equal(result.meanAreaLog2, null);
  assert.deepEqual(result.collapsed, [0]);
});

test('UV collapse uses an inclusive 1e-15 area tolerance and preserves thin inversions', () => {
  for (const [height, collapsed, inverted] of [[2e-16, true, false], [2e-15, true, false], [2e-14, false, false], [-2e-14, false, true]]) {
    const mesh = { positions: [[0, 0, 0], [1, 0, 0], [0, 1, 0]], faces: [[0, 1, 2]], uvs: [[0, 0], [1, 0], [0, height]] };
    const face = analyzeParameterization(mesh).faces[0];
    assert.equal(face.collapsed, collapsed, `UV height ${height}`);
    assert.equal(face.inverted, inverted, `UV height ${height}`);
  }
});

test('metrics are invariant to independent source and UV units and translations', () => {
  const mesh = { positions: [[0, 0, 0], [1, 0, 0], [0, 1, 0]], faces: [[0, 1, 2]], uvs: [[0, 0], [2, 0], [0, 1]] };
  const original = analyzeParameterization(mesh);
  mesh.positions = mesh.positions.map(p => p.map(x => x * 1e-9 + 1e-7));
  mesh.uvs = mesh.uvs.map(p => p.map(x => x * 1e6 - 3e7));
  const scaled = analyzeParameterization(mesh);
  close(original.maxAngleError, scaled.maxAngleError); close(original.maxAreaLog2, scaled.maxAreaLog2);
  assert.deepEqual(scaled.collapsed, []);
});

test('invalid source geometry and diagnostic colors stay explicit and finite', () => {
  const result = analyzeParameterization({ positions: [[0, 0, 0], [1, 0, 0], [2, 0, 0]], faces: [[0, 1, 2]], uvs: [[0, 0], [1, 0], [0, 1]] });
  assert.deepEqual(result.invalid, [0]);
  for (const mode of ['angle', 'area', 'inversions']) for (const face of [result.faces[0], { inverted: true }, { collapsed: true }, { angleError: 90, areaLog2: -12 }]) {
    assert.ok(distortionColor(face, mode).every(value => Number.isFinite(value) && value >= 0 && value <= 1));
  }
});
