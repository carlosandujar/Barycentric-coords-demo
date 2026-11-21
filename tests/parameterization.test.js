import test from 'node:test';
import assert from 'node:assert/strict';
import * as math from 'mathjs';
import { prepareMesh } from '../app/js/topology.js';
import { createExampleMesh } from '../app/js/mesh.js';
import { createVertexRing, weightMethods, validateWeights } from '../app/js/weights.js';
import { createCircularBoundary, assembleSystem, factorSystem, solveSystem, createRightHandSides, calculateResidual } from '../app/js/parameterization.js';

const close = (a, b, epsilon = 1e-10) => assert.ok(Math.abs(a - b) < epsilon, `${a} differs from ${b}`);
function makePlanarPatch() {
  const positions = [], faces = [];
  for (let y = 0; y <= 4; y++) for (let x = 0; x <= 4; x++) {
    const interior = x > 0 && x < 4 && y > 0 && y < 4;
    positions.push([x / 4 + (interior ? 0.105 * Math.sin(5 * x + 2 * y) : 0), y / 4 + (interior ? 0.105 * Math.cos(3 * x - y) : 0), 0]);
  }
  for (let y = 0; y < 4; y++) for (let x = 0; x < 4; x++) {
    const a = y * 5 + x;
    faces.push([a, a + 1, a + 6], [a, a + 6, a + 5]);
  }
  return prepareMesh({ positions, faces });
}

// An independent dense Gaussian elimination is a test reference, never a runtime solver.
function referenceSolve(rows, rhs) {
  const n = rows.length;
  const augmented = rows.map((row, i) => {
    const values = Array(n).fill(0); row.entries.forEach(([j, value]) => { values[j] = value; });
    return [...values, rhs[i]];
  });
  for (let k = 0; k < n; k++) {
    let pivot = k;
    for (let i = k + 1; i < n; i++) if (Math.abs(augmented[i][k]) > Math.abs(augmented[pivot][k])) pivot = i;
    [augmented[k], augmented[pivot]] = [augmented[pivot], augmented[k]];
    assert.ok(Math.abs(augmented[k][k]) > 1e-12);
    for (let i = k + 1; i < n; i++) {
      const factor = augmented[i][k] / augmented[k][k];
      for (let j = k; j <= n; j++) augmented[i][j] -= factor * augmented[k][j];
    }
  }
  const result = Array(n).fill(0);
  for (let i = n - 1; i >= 0; i--) {
    let value = augmented[i][n];
    for (let j = i + 1; j < n; j++) value -= augmented[i][j] * result[j];
    result[i] = value / augmented[i][i];
  }
  return result;
}

test('ring angles and built-in weights agree with a symmetric analytic fan', () => {
  const mesh = prepareMesh({ positions: [[0, 0, 0], [2, 0, 0], [0, 2, 0], [-2, 0, 0], [0, -2, 0]], faces: [[0, 1, 2], [0, 2, 3], [0, 3, 4], [0, 4, 1]] });
  const ring = createVertexRing(mesh, 0);
  ring.neighbors.forEach(neighbor => {
    close(neighbor.edgeLength, 2);
    neighbor.centerAngles.forEach(angle => close(angle, Math.PI / 2));
    neighbor.oppositeAngles.forEach(angle => close(angle, Math.PI / 4));
    assert.ok(neighbor.incidentFaceIds.every(Number.isInteger));
  });
  const expected = { uniform: 1, meanValue: 1, cotangent: 2, inverseDistance: 0.5 };
  Object.entries(expected).forEach(([method, value]) => weightMethods[method].computeWeights(ring).forEach(weight => close(weight, value)));
  const boundaryRing = createVertexRing(mesh, 1);
  assert.equal(boundaryRing.isBoundary, true);
  assert.equal(boundaryRing.neighbors[0].centerAngles[0], null);
  assert.equal(boundaryRing.neighbors.at(-1).oppositeAngles[1], null);
  ring.center.position[0] = 100;
  assert.equal(mesh.positions[0][0], 0);
});

test('arc-length and uniform boundaries are method-independent and lie exactly on the circle', () => {
  const mesh = makePlanarPatch();
  for (const spacing of ['arcLength', 'uniform']) {
    const boundary = createCircularBoundary(mesh, spacing);
    boundary.forEach(({ uv }) => close(Math.hypot(uv[0] - 0.5, uv[1] - 0.5), 0.5));
    for (const method of Object.keys(weightMethods)) {
      const system = assembleSystem(mesh, method);
      const result = solveSystem(system, factorSystem(system, math), boundary, mesh.positions.length, math);
      boundary.forEach(({ id, uv }) => assert.deepEqual(result.uvs[id], uv));
      assert.ok(result.residuals.every(residual => residual < 1e-12));
    }
  }
});

test('sparse LU agrees with an independent dense reference for all four methods', () => {
  const mesh = prepareMesh(createExampleMesh());
  const boundary = createCircularBoundary(mesh);
  for (const method of Object.keys(weightMethods)) {
    const system = assembleSystem(mesh, method), rhs = createRightHandSides(system, boundary);
    const result = solveSystem(system, factorSystem(system, math), boundary, mesh.positions.length, math);
    for (let axis = 0; axis < 2; axis++) {
      const expected = referenceSolve(system.rows, rhs[axis]);
      system.interiorIds.forEach((id, row) => close(result.uvs[id][axis], expected[row]));
    }
    assert.ok(system.nonzeros < system.size ** 2);
  }
});

test('Mean Value and Cotangent reproduce affine coordinates on an irregular planar patch', () => {
  const mesh = makePlanarPatch();
  const boundary = mesh.topology.boundaryLoops[0].map(id => ({ id, uv: mesh.positions[id].slice(0, 2) }));
  for (const method of ['meanValue', 'cotangent']) {
    const system = assembleSystem(mesh, method);
    const result = solveSystem(system, factorSystem(system, math), boundary, mesh.positions.length, math);
    result.uvs.forEach((uv, id) => uv.forEach((value, axis) => close(value, mesh.positions[id][axis])));
  }
  assert.ok(assembleSystem(mesh, 'cotangent').negativeWeights > 0);
});

test('reuses one factorization across both coordinates and boundary spacing changes', () => {
  const mesh = makePlanarPatch(), system = assembleSystem(mesh, 'meanValue');
  let factorizations = 0, solves = 0;
  const countedMath = { sparse: math.sparse, slu: (...args) => { factorizations++; return math.slu(...args); }, lusolve: (...args) => { solves++; return math.lusolve(...args); } };
  const factorization = factorSystem(system, countedMath);
  for (const spacing of ['uniform', 'arcLength']) solveSystem(system, factorization, createCircularBoundary(mesh, spacing), mesh.positions.length, countedMath);
  assert.equal(factorizations, 1);
  assert.equal(solves, 4);
});

test('handles boundary-only meshes without loading or invoking a solver', () => {
  const mesh = prepareMesh({ positions: [[0, 0, 0], [1, 0, 0], [0, 1, 0]], faces: [[0, 1, 2]] });
  const boundary = createCircularBoundary(mesh);
  const system = assembleSystem(mesh, 'meanValue');
  assert.equal(factorSystem(system, undefined), null);
  const result = solveSystem(system, null, boundary, 3, undefined);
  boundary.forEach(({ id, uv }) => assert.deepEqual(result.uvs[id], uv));
  assert.deepEqual(result.residuals, [0, 0]);
});

test('rejects invalid, nonfinite, unconstrained, and canceling weight rows with vertex context', () => {
  const ring = createVertexRing(makePlanarPatch(), 6);
  assert.throws(() => validateWeights(ring, []), /Vertex 6: expected/);
  assert.throws(() => validateWeights(ring, ring.neighbors.map(() => NaN)), /Vertex 6, neighbor/);
  assert.throws(() => validateWeights(ring, ring.neighbors.map(() => 0)), /all weights are zero/);
  assert.throws(() => validateWeights(ring, ring.neighbors.map((_, i) => i === 0 ? 1 : i === 1 ? -1 : 0)), /normalization is undefined/);
  const singular = { size: 2, rows: [{ entries: [[0, 1], [1, -1]] }, { entries: [[0, -1], [1, 1]] }] };
  assert.throws(() => factorSystem(singular, math), /factorization failed/);
});

test('rejects unacceptable solver results and meshes requiring preparation', () => {
  const mesh = prepareMesh(createExampleMesh()), system = assembleSystem(mesh, 'uniform');
  const boundary = createCircularBoundary(mesh);
  const invalidMath = { lusolve: () => ({ valueOf: () => Array.from({ length: system.size }, () => [NaN]) }) };
  assert.throws(() => solveSystem(system, {}, boundary, mesh.positions.length, invalidMath), /nonfinite/);
  invalidMath.lusolve = () => ({ valueOf: () => Array.from({ length: system.size }, () => [100]) });
  assert.throws(() => solveSystem(system, {}, boundary, mesh.positions.length, invalidMath), /acceptance threshold/);
  assert.equal(calculateResidual({ rows: [{ entries: [[0, 1]] }] }, [0], [0]), 0);
  assert.throws(() => createCircularBoundary({ topology: { ready: false } }), /not ready/);
});
