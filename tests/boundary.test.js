import test from 'node:test';
import assert from 'node:assert/strict';
import * as math from 'mathjs';
import { prepareMesh } from '../app/js/topology.js';
import { createBoundary, createCircularBoundary, assembleSystem, factorSystem, solveSystem } from '../app/js/parameterization.js';
import { selectBoundaryState, setVertexPosition, revalidateGeometry } from '../app/js/geometry-editing.js';
import { weightMethods } from '../app/js/weights.js';

const close = (a, b) => assert.ok(Math.abs(a - b) < 1e-10, `${a} differs from ${b}`);
function makeFan(count = 11) {
  const positions = [[0, 0, 0]], faces = [];
  for (let i = 0; i < count; i++) {
    const angle = 2 * Math.PI * i / count, radius = 1 + 0.2 * Math.sin(i);
    positions.push([radius * Math.cos(angle), radius * Math.sin(angle), 0.1 * Math.sin(i * 2)]);
    faces.push([0, i + 1, (i + 1) % count + 1]);
  }
  return prepareMesh({ positions, faces });
}

test('square boundaries include all four corners for boundary counts not divisible by four', () => {
  for (const count of [4, 5, 7, 11, 12]) for (const spacing of ['uniform', 'arcLength']) {
    const mesh = makeFan(count), boundary = createBoundary(mesh, 'square', spacing);
    assert.deepEqual(boundary.map(entry => entry.id), mesh.boundary);
    for (const corner of [[0, 0], [1, 0], [1, 1], [0, 1]]) assert.ok(boundary.some(entry => entry.uv.every((value, axis) => value === corner[axis])));
    for (let i = 0; i < count; i++) {
      const a = boundary[i].uv, b = boundary[(i + 1) % count].uv;
      assert.ok(a.every(value => value >= 0 && value <= 1));
      assert.ok(a[0] === b[0] || a[1] === b[1], 'Each boundary edge lies on one square side');
      assert.ok(Math.hypot(...b.map((value, axis) => value - a[axis])) > 0);
    }
  }
});

test('square spacing is uniform or proportional to 3D edge length within each side', () => {
  const mesh = makeFan();
  for (const spacing of ['uniform', 'arcLength']) {
    const boundary = createBoundary(mesh, 'square', spacing);
    const corners = boundary.flatMap(({ uv }, i) => uv.every(value => value === 0 || value === 1) ? [i] : []);
    corners.push(boundary.length);
    for (let side = 0; side < 4; side++) {
      let reference;
      for (let i = corners[side]; i < corners[side + 1]; i++) {
        const a = boundary[i], b = boundary[(i + 1) % boundary.length];
        const length = Math.hypot(...b.uv.map((value, axis) => value - a.uv[axis]));
        const sourceLength = Math.hypot(...mesh.positions[a.id].map((value, axis) => value - mesh.positions[b.id][axis]));
        const ratio = spacing === 'uniform' ? length : length / sourceLength;
        if (reference === undefined) reference = ratio; else close(ratio, reference);
      }
    }
  }
});

test('one factorization per weight method solves circular and square constraints with both spacings', () => {
  const mesh = makeFan();
  for (const method of Object.keys(weightMethods)) {
    const system = assembleSystem(mesh, method), factor = factorSystem(system, math);
    for (const shape of ['circular', 'square']) for (const spacing of ['uniform', 'arcLength']) {
      const boundary = createBoundary(mesh, shape, spacing);
      const result = solveSystem(system, factor, boundary, mesh.positions.length, math);
      assert.ok(result.residuals.every(value => value < 1e-10));
      boundary.forEach(({ id, uv }) => assert.deepEqual(result.uvs[id], uv));
      assert.ok(result.uvs[0].every(value => value > 0 && value < 1));
    }
  }
});

test('frozen boundary states include shape and regenerate when shape or spacing changes', () => {
  const mesh = makeFan(), circular = selectBoundaryState(mesh, 'arcLength', null);
  const square = selectBoundaryState(mesh, 'arcLength', circular, false, 'square');
  assert.equal(square.shape, 'square'); assert.notDeepEqual(square.vertices, circular.vertices);
  const id = mesh.boundary[1]; setVertexPosition(mesh, id, mesh.positions[id].map((value, axis) => axis === 2 ? value + 0.7 : value)); revalidateGeometry(mesh);
  assert.equal(selectBoundaryState(mesh, 'arcLength', square, false, 'square'), square);
  assert.notDeepEqual(selectBoundaryState(mesh, 'arcLength', square, true, 'square').vertices, square.vertices);
  assert.equal(selectBoundaryState(mesh, 'uniform', square, false, 'square').spacing, 'uniform');
  const restored = selectBoundaryState(mesh, 'arcLength', square, false, 'circular');
  assert.equal(restored.shape, 'circular'); assert.deepEqual(restored.vertices, createCircularBoundary(mesh));
});

test('square boundary rejects insufficient corners and invalid options explicitly', () => {
  assert.throws(() => createBoundary(makeFan(3), 'square'), /at least four/);
  assert.throws(() => createBoundary(makeFan(), 'triangle'), /Unknown boundary shape/);
  assert.throws(() => createBoundary(makeFan(), 'square', 'other'), /Unknown boundary spacing/);
});
