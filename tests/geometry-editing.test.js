import test from 'node:test';
import assert from 'node:assert/strict';
import * as math from 'mathjs';
import { createExampleMesh, createPlanarExampleMesh } from '../app/js/mesh.js';
import { prepareMesh } from '../app/js/topology.js';
import { GeometryHistory, setVertexPosition, revalidateGeometry, findMeshPlane, modelToDisplay, displayToModel, selectBoundaryState } from '../app/js/geometry-editing.js';
import { assembleSystem, factorSystem, solveSystem, validateBoundary } from '../app/js/parameterization.js';

function solve(mesh, method, boundary) {
  const system = assembleSystem(mesh, method);
  return solveSystem(system, factorSystem(system, math), boundary.vertices, mesh.positions.length, math).uvs;
}

test('Uniform UVs are unchanged by a geometry edit with connectivity and boundary fixed', () => {
  const mesh = prepareMesh(createExampleMesh());
  const boundary = selectBoundaryState(mesh, 'arcLength', null), faces = structuredClone(mesh.faces);
  const original = solve(mesh, 'uniform', boundary), geometric = solve(mesh, 'meanValue', boundary);
  setVertexPosition(mesh, 0, [0.15, -0.1, 1.1]); revalidateGeometry(mesh);
  assert.equal(mesh.topology.ready, true);
  assert.deepEqual(mesh.faces, faces);
  assert.deepEqual(solve(mesh, 'uniform', boundary), original);
  const updated = solve(mesh, 'meanValue', boundary);
  assert.ok(updated.some((uv, id) => uv.some((value, axis) => Math.abs(value - geometric[id][axis]) > 1e-5)));
});

test('border UVs freeze by default, refresh on request, and remain valid constraints', () => {
  const mesh = prepareMesh(createExampleMesh());
  const before = selectBoundaryState(mesh, 'arcLength', null);
  const id = mesh.boundary[0], position = mesh.positions[id].slice(); position[2] += 0.8;
  setVertexPosition(mesh, id, position); revalidateGeometry(mesh);
  assert.deepEqual(selectBoundaryState(mesh, 'arcLength', before), before);
  const refreshed = selectBoundaryState(mesh, 'arcLength', before, true);
  assert.notDeepEqual(refreshed.vertices, before.vertices);
  assert.deepEqual(validateBoundary(mesh, before.vertices), before.vertices);
  assert.throws(() => validateBoundary(mesh, before.vertices.slice(1)), /complete boundary/);
  const duplicate = structuredClone(before.vertices); duplicate[1] = duplicate[0];
  assert.throws(() => validateBoundary(mesh, duplicate), /duplicate IDs/);
});

test('undo and redo restore geometry, boundary snapshots, and deterministic UV results', () => {
  const mesh = prepareMesh(createExampleMesh()), history = new GeometryHistory();
  const beforeBoundary = selectBoundaryState(mesh, 'arcLength', null), beforeUVs = solve(mesh, 'meanValue', beforeBoundary);
  const before = mesh.positions[0].slice(), after = [0.12, 0, 0.9];
  setVertexPosition(mesh, 0, after); revalidateGeometry(mesh);
  const afterBoundary = selectBoundaryState(mesh, 'arcLength', beforeBoundary, true);
  history.record([{ id: 0, before, after }], beforeBoundary, afterBoundary);
  const afterUVs = solve(mesh, 'meanValue', afterBoundary);
  assert.notDeepEqual(afterUVs, beforeUVs);
  const undone = history.undo(mesh);
  assert.deepEqual(mesh.positions[0], before);
  assert.deepEqual(solve(mesh, 'meanValue', undone.boundary), beforeUVs);
  const redone = history.redo(mesh);
  assert.deepEqual(mesh.positions[0], after);
  assert.deepEqual(solve(mesh, 'meanValue', redone.boundary), afterUVs);
  assert.deepEqual(mesh.originalPositions[0], before);
});

test('a degenerating edit remains inspectable and undo restores solve eligibility', () => {
  const mesh = prepareMesh(createExampleMesh()), history = new GeometryHistory();
  const boundary = selectBoundaryState(mesh, 'uniform', null), before = mesh.positions[0].slice(), after = mesh.positions[1].slice();
  setVertexPosition(mesh, 0, after); revalidateGeometry(mesh);
  history.record([{ id: 0, before, after }], boundary, boundary);
  assert.equal(mesh.topology.ready, false);
  assert.ok(mesh.topology.degenerateFaces.length >= 2);
  assert.deepEqual(selectBoundaryState(mesh, 'uniform', boundary, true), boundary);
  assert.ok(mesh.displayPositions.flat().every(Number.isFinite));
  history.undo(mesh);
  assert.equal(mesh.topology.ready, true);
  assert.equal(mesh.topology.degenerateFaces.length, 0);
});

test('the viewing frame and original model units stay stable across edits', () => {
  const mesh = prepareMesh({ positions: [[100, 200, 300], [102, 200, 300], [100, 202, 300]], faces: [[0, 1, 2]] });
  const bounds = structuredClone(mesh.bounds), original = structuredClone(mesh.originalPositions), position = [103, 201, 305];
  setVertexPosition(mesh, 1, position); revalidateGeometry(mesh);
  assert.deepEqual(mesh.bounds, bounds);
  assert.deepEqual(mesh.originalPositions, original);
  assert.deepEqual(displayToModel(mesh, modelToDisplay(mesh, position)), position);
  assert.deepEqual(mesh.displayPositions[1], modelToDisplay(mesh, position));
  assert.throws(() => setVertexPosition(mesh, 0, [NaN, 0, 0]), /finite/);
  assert.throws(() => setVertexPosition(mesh, 500, [0, 0, 0]), /existing vertex/);
});

test('mesh-plane detection supports arbitrary planes and rejects curved geometry', () => {
  assert.equal(findMeshPlane(prepareMesh(createExampleMesh())), null);
  const flat = prepareMesh(createPlanarExampleMesh());
  assert.ok(Math.abs(findMeshPlane(flat)[2]) > 0.999999);
  const rotated = prepareMesh({ ...createPlanarExampleMesh(), positions: flat.positions.map(([x, y]) => [x, y, x + y]) });
  const normal = findMeshPlane(rotated);
  assert.ok(normal && Math.abs(normal[0] + normal[2]) < 1e-12 && Math.abs(normal[1] + normal[2]) < 1e-12);
});

test('restore is undoable, history is bounded, and a new edit clears redo', () => {
  const mesh = prepareMesh(createExampleMesh()), history = new GeometryHistory(2);
  for (const z of [0.8, 0.9, 1]) {
    const before = mesh.positions[0].slice(), after = [0, 0, z];
    setVertexPosition(mesh, 0, after); history.record([{ id: 0, before, after }], null, null);
  }
  assert.equal(history.undoStack.length, 2);
  const before = mesh.positions[0].slice(), after = mesh.originalPositions[0].slice();
  setVertexPosition(mesh, 0, after); history.record([{ id: 0, before, after }], null, null, 'Restore geometry');
  history.undo(mesh); assert.deepEqual(mesh.positions[0], before);
  history.redo(mesh); assert.deepEqual(mesh.positions, mesh.originalPositions);
  history.undo(mesh);
  history.record([{ id: 0, before: mesh.positions[0].slice(), after: [0, 0, 1.2] }], null, null);
  assert.equal(history.redo(mesh), null);
});
