import test from 'node:test';
import assert from 'node:assert/strict';
import { createExampleMesh } from '../app/js/mesh.js';

test('example is a consistently oriented triangular disk with shared UV indices', () => {
  const mesh = createExampleMesh();
  assert.equal(mesh.positions.length, mesh.uvs.length);
  const edges = new Map();
  for (const face of mesh.faces) {
    assert.equal(new Set(face).size, 3);
    face.forEach(id => assert.ok(id >= 0 && id < mesh.positions.length));
    const [a, b, c] = face.map(id => mesh.uvs[id]);
    assert.ok((b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0]) > 0);
    for (let i = 0; i < 3; i++) {
      const from = face[i];
      const to = face[(i + 1) % 3];
      const key = [from, to].sort((x, y) => x - y).join(':');
      const entries = edges.get(key) || [];
      entries.push([from, to]);
      edges.set(key, entries);
    }
  }
  const boundaryEdges = [];
  for (const entries of edges.values()) {
    assert.ok(entries.length === 1 || entries.length === 2);
    if (entries.length === 1) boundaryEdges.push(entries[0]);
    else assert.deepEqual(entries[0], entries[1].toReversed());
  }
  assert.equal(mesh.positions.length - edges.size + mesh.faces.length, 1);
  assert.equal(boundaryEdges.length, mesh.boundary.length);
  mesh.boundary.forEach((id, index) => {
    const next = mesh.boundary[(index + 1) % mesh.boundary.length];
    assert.ok(boundaryEdges.some(([from, to]) => from === id && to === next));
  });
});
