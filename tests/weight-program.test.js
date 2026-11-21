import test from 'node:test';
import assert from 'node:assert/strict';
import { Worker } from 'node:worker_threads';
import * as math from 'mathjs';
import { createExampleMesh } from '../app/js/mesh.js';
import { prepareMesh } from '../app/js/topology.js';
import { createVertexRing, weightMethods, validateWeights } from '../app/js/weights.js';
import { weightExamples, evaluateWeightProgram, createWeightWorkerSource } from '../app/js/weight-program.js';
import { assembleSystem, createCircularBoundary, factorSystem, solveSystem } from '../app/js/parameterization.js';

function createRings(mesh) {
  return mesh.topology.vertices.flatMap((vertex, id) => vertex.isBoundary ? [] : [createVertexRing(mesh, id)]);
}

test('editable examples reproduce all built-in weights and UV solutions', () => {
  const mesh = prepareMesh(createExampleMesh()), boundary = createCircularBoundary(mesh);
  for (const method of Object.keys(weightExamples)) {
    const rings = createRings(mesh);
    const rows = evaluateWeightProgram(weightExamples[method], rings);
    rows.forEach((row, i) => {
      const expected = weightMethods[method].computeWeights(rings[i]);
      row.weights.forEach((value, j) => assert.ok(Math.abs(value - expected[j]) < 1e-12));
    });
    const byId = new Map(rows.map(row => [row.id, row.weights]));
    const edited = assembleSystem(mesh, 'custom', ring => byId.get(ring.center.id));
    const builtin = assembleSystem(mesh, method);
    const actual = solveSystem(edited, factorSystem(edited, math), boundary, mesh.positions.length, math);
    const expected = solveSystem(builtin, factorSystem(builtin, math), boundary, mesh.positions.length, math);
    actual.uvs.forEach((uv, i) => uv.forEach((value, axis) => assert.ok(Math.abs(value - expected.uvs[i][axis]) < 1e-12)));
  }
});

test('custom functions can depend on the complete ring and signed weights are retained', () => {
  const mesh = prepareMesh(createExampleMesh());
  const rows = evaluateWeightProgram(`function computeWeights(ring) {
    const averageLength = ring.neighbors.reduce((sum, n) => sum + n.edgeLength, 0) / ring.neighbors.length;
    if (!ring.faces.every(face => face.positions.length === 3 && face.normal.length === 3)) throw new Error('Missing face geometry');
    return ring.neighbors.map((n, i) => i === 0 ? -0.25 : averageLength / n.edgeLength);
  }`, createRings(mesh));
  assert.ok(rows.every(row => row.weights[0] === -0.25));
  rows.forEach(row => validateWeights(createVertexRing(mesh, row.id), row.weights));
});

test('reports syntax, missing function, return shape, and nonfinite weight errors', () => {
  const mesh = prepareMesh(createExampleMesh());
  const run = source => evaluateWeightProgram(source, [createVertexRing(mesh, 0)]);
  assert.throws(() => run('function computeWeights( {'), /Compilation failed: SyntaxError/);
  assert.throws(() => run('const otherFunction = 1;'), /Define function computeWeights/);
  assert.throws(() => run('async function computeWeights(ring) { return []; }'), /Vertex 0: Return an array/);
  assert.throws(() => run('function computeWeights(ring) { return [1]; }'), /Vertex 0: Returned 1 weights for 12 neighbors/);
  assert.throws(() => run('function computeWeights(ring) { return ring.neighbors.map(() => Infinity); }'), /Vertex 0: Neighbor 1/);
  assert.throws(() => run('function computeWeights(ring) { throw new Error("test failure"); }'), /Vertex 0: test failure/);
  assert.throws(() => run('function computeWeights(ring) { return new Array(ring.neighbors.length); }'), /finite number/);
});

test('the input contract is deeply read-only and does not expose mesh state', () => {
  const mesh = prepareMesh(createExampleMesh());
  assert.throws(() => evaluateWeightProgram('function computeWeights(ring) { ring.center.position[0] = 12; return []; }', [createVertexRing(mesh, 0)]), /Vertex 0:/);
  assert.equal(mesh.positions[0][0], 0);
  assert.throws(() => evaluateWeightProgram('function computeWeights(ring) { ring.neighbors[0].centerAngles.push(1); return []; }', [createVertexRing(mesh, 0)]), /Vertex 0:/);
});

function createRuntimeWorker() {
  return new Worker(`const { parentPort } = require('node:worker_threads');
    globalThis.self = { postMessage: data => parentPort.postMessage(data) };
    ${createWeightWorkerSource()}
    parentPort.on('message', data => self.onmessage({ data }));`, { eval: true });
}

test('the serialized evaluator executes independently in a real worker', async () => {
  const mesh = prepareMesh(createExampleMesh()), worker = createRuntimeWorker();
  try {
    const result = await new Promise((resolve, reject) => {
      worker.once('message', resolve); worker.once('error', reject);
      worker.postMessage({ source: weightExamples.uniform, rings: [createVertexRing(mesh, 0)] });
    });
    assert.equal(result.type, 'result');
    assert.deepEqual(result.rows, [{ id: 0, weights: Array(12).fill(1) }]);
  } finally { await worker.terminate(); }
});

test('an infinite loop can be terminated without hanging the caller', async () => {
  const mesh = prepareMesh(createExampleMesh()), worker = createRuntimeWorker();
  try {
    await new Promise((resolve, reject) => { worker.once('online', resolve); worker.once('error', reject); });
    worker.postMessage({ source: 'function computeWeights(ring) { while (true) {} }', rings: [createVertexRing(mesh, 0)] });
    await new Promise(resolve => setTimeout(resolve, 100));
    assert.equal(await worker.terminate(), 1);
  } finally { await worker.terminate(); }
});
