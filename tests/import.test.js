import test from 'node:test';
import assert from 'node:assert/strict';
import { parseOBJ } from '../app/js/obj.js';
import { prepareMesh, buildTopology } from '../app/js/topology.js';
import { createExampleMesh } from '../app/js/mesh.js';

const polygonOBJ = (points, indices) => points.map(point => `v ${point.join(' ')}`).join('\n') + `\nf ${indices.join(' ')}`;
const concavePoints = [[0, 0, 0], [2, 0, 0], [2, 2, 0], [1, 1, 0], [0, 2, 0]];

test('triangulates concave polygons in either winding without crossing the notch', () => {
  for (const indices of [[1, 2, 3, 4, 5], [5, 4, 3, 2, 1]]) {
    const mesh = prepareMesh(parseOBJ(polygonOBJ(concavePoints, indices)));
    assert.equal(mesh.faces.length, 3);
    assert.equal(mesh.importInfo.triangulatedPolygons, 1);
    assert.equal(mesh.topology.ready, true);
    let area = 0;
    for (const face of mesh.faces) {
      const [a, b, c] = face.map(id => mesh.positions[id]);
      const signed = ((b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0])) / 2;
      assert.equal(Math.sign(signed), indices[0] === 1 ? 1 : -1);
      area += signed;
      const centroid = [0, 1].map(axis => (a[axis] + b[axis] + c[axis]) / 3);
      assert.ok(centroid[1] <= 1 + Math.abs(centroid[0] - 1) + 1e-12);
    }
    assert.equal(Math.abs(area), 3);
  }
});

test('preserves position indices across texture seams, negative indices, and OBJ groups', () => {
  const mesh = parseOBJ('v 0 0 0\nv 1 0 0\nv 1 1 0\nv 0 1 0\nvt 0 0\nvt 1 0\ng first\nf 1/1/1 2/2/1 3/1/1\ng second\nf -4/2/2 -2/2/2 -1/1/2');
  assert.equal(mesh.positions.length, 4);
  assert.deepEqual(mesh.faces, [[0, 1, 2], [0, 2, 3]]);
  assert.equal(prepareMesh(mesh).topology.ready, true);
});

test('handles comments, CRLF, BOM, and continued faces with source line provenance', () => {
  const mesh = parseOBJ('\uFEFFv 0 0 0\r\nv 1 0 0\r\nv 1 1 0\r\nv 0 1 0\r\nf 1 2 \\\r\n3 4 # quad');
  assert.equal(mesh.faces.length, 2);
  assert.deepEqual(mesh.faceSources, [{ polygon: 0, line: 5 }, { polygon: 0, line: 5 }]);
});

test('projects vertical and nonplanar polygons and reports nonplanarity', () => {
  const vertical = concavePoints.map(([x, y]) => [3, x, y]);
  assert.equal(prepareMesh(parseOBJ(polygonOBJ(vertical, [1, 2, 3, 4, 5]))).topology.ready, true);
  const mesh = parseOBJ(polygonOBJ([[0, 0, 0], [1, 0, 0], [1, 1, 0.2], [0, 1, 0]], [1, 2, 3, 4]));
  assert.equal(mesh.faces.length, 2);
  assert.equal(mesh.importInfo.warnings.length, 1);
});

test('keeps collinear boundary vertices instead of dropping their OBJ indices', () => {
  const mesh = prepareMesh(parseOBJ(polygonOBJ([[0, 0, 0], [1, 0, 0], [2, 0, 0], [2, 1, 0], [0, 1, 0]], [1, 2, 3, 4, 5])));
  assert.equal(mesh.faces.length, 3);
  assert.equal(mesh.topology.ready, true);
  assert.equal(mesh.topology.boundaryLoops[0].length, 5);
});

test('rejects malformed indices, invalid coordinates, self-intersections, and empty geometry', () => {
  for (const index of ['0', '4', '-4', '1oops']) {
    assert.throws(() => parseOBJ(`v 0 0 0\nv 1 0 0\nv 0 1 0\nf 1 2 ${index}`), /OBJ line 4:/);
  }
  assert.throws(() => parseOBJ('v NaN 0 0'), /finite/);
  assert.throws(() => parseOBJ('v 0 0 0'), /positions and polygon faces/);
  assert.throws(() => parseOBJ(polygonOBJ([[0, 0, 0], [2, 2, 0], [0, 2, 0], [2, 0, 0]], [1, 2, 3, 4])), /OBJ line 5:/);
  assert.throws(() => parseOBJ(polygonOBJ(concavePoints, [1, 2, 3, 2, 5])), /repeats/);
});

test('keeps original units and an independent copy of positions', () => {
  const positions = [[10000, -100, 30], [10002, -100, 30], [10000, -98, 30]];
  const mesh = prepareMesh({ positions, faces: [[0, 1, 2]] });
  assert.deepEqual(mesh.positions, positions);
  assert.deepEqual(mesh.originalPositions, positions);
  mesh.positions[0][0] += 1;
  assert.equal(mesh.originalPositions[0][0], 10000);
  assert.equal(Math.max(...mesh.displayPositions.flat()), 1);
});

test('orders interior and open boundary rings by the incident face fan', () => {
  const mesh = createExampleMesh();
  const topology = buildTopology(mesh.positions, mesh.faces);
  assert.equal(topology.ready, true);
  for (const [id, vertex] of topology.vertices.entries()) {
    assert.equal(vertex.ringValid, true);
    const ring = vertex.orderedNeighbors;
    assert.equal(ring.length, vertex.neighbors.length);
    const count = vertex.isBoundary ? ring.length - 1 : ring.length;
    for (let j = 0; j < count; j++) {
      assert.ok(vertex.faces.some(faceId => {
        const face = mesh.faces[faceId], offset = face.indexOf(id);
        return face[(offset + 1) % 3] === ring[j] && face[(offset + 2) % 3] === ring[(j + 1) % ring.length];
      }));
    }
  }
});

test('detects a closed orientable surface without treating it as a disk', () => {
  const topology = buildTopology([[0, 0, 0], [1, 0, 0], [0, 1, 0], [0, 0, 1]], [[0, 2, 1], [0, 1, 3], [1, 2, 3], [2, 0, 3]]);
  assert.equal(topology.manifold, true);
  assert.equal(topology.orientable, true);
  assert.equal(topology.eulerCharacteristic, 2);
  assert.equal(topology.boundaryLoops.length, 0);
  assert.equal(topology.ready, false);
});

test('detects two boundary loops on an annulus', () => {
  const positions = [], faces = [];
  for (const radius of [2, 1]) for (let i = 0; i < 8; i++) positions.push([radius * Math.cos(i * Math.PI / 4), radius * Math.sin(i * Math.PI / 4), 0]);
  for (let i = 0; i < 8; i++) { const j = (i + 1) % 8; faces.push([i, j, j + 8], [i, j + 8, i + 8]); }
  const topology = buildTopology(positions, faces);
  assert.equal(topology.manifold, true);
  assert.equal(topology.boundaryLoops.length, 2);
  assert.equal(topology.eulerCharacteristic, 0);
  assert.equal(topology.ready, false);
});

test('distinguishes inconsistent winding from a nonorientable surface', () => {
  const topology = buildTopology([[0, 0, 0], [1, 0, 0], [1, 1, 0], [0, 1, 0]], [[0, 1, 2], [0, 3, 2]]);
  assert.equal(topology.orientable, true);
  assert.equal(topology.isDisk, true);
  assert.equal(topology.inconsistentEdges.length, 1);
  assert.equal(topology.ready, false);
});

test('detects disconnected surfaces, unused vertices, and duplicate and degenerate triangles', () => {
  const positions = [[0, 0, 0], [1, 0, 0], [0, 1, 0], [3, 0, 0], [4, 0, 0], [3, 1, 0], [9, 9, 9]];
  const topology = buildTopology(positions, [[0, 1, 2], [3, 4, 5]]);
  assert.equal(topology.components, 3);
  assert.deepEqual(topology.unusedVertices, [6]);
  assert.equal(topology.ready, false);
  assert.deepEqual(buildTopology(positions, [[0, 1, 2], [2, 1, 0]]).duplicateFaces, [1]);
  assert.deepEqual(buildTopology(positions, [[0, 0, 1]]).degenerateFaces, [0]);
});

test('identifies a triangulated Mobius strip as nonorientable', () => {
  const positions = [], faces = [], segments = 8;
  for (let i = 0; i < segments; i++) {
    const angle = i * Math.PI * 2 / segments;
    for (const offset of [-0.2, 0.2]) positions.push([
      (1 + offset * Math.cos(angle / 2)) * Math.cos(angle),
      (1 + offset * Math.cos(angle / 2)) * Math.sin(angle),
      offset * Math.sin(angle / 2),
    ]);
  }
  for (let i = 0; i < segments; i++) {
    const a = i * 2, b = a + 1;
    const c = i === segments - 1 ? 1 : a + 2;
    const d = i === segments - 1 ? 0 : a + 3;
    faces.push([a, c, d], [a, d, b]);
  }
  const topology = buildTopology(positions, faces);
  assert.equal(topology.manifold, true);
  assert.equal(topology.boundaryLoops.length, 1);
  assert.equal(topology.orientable, false);
  assert.equal(topology.ready, false);
  assert.ok(topology.issues.some(issue => issue.includes('nonorientable')));
});

test('topology checks are invariant to practical model units', () => {
  for (const scale of [1e-9, 1, 1e9]) {
    const mesh = prepareMesh({ positions: [[0, 0, 0], [scale, 0, 0], [0, scale, 0]], faces: [[0, 1, 2]] });
    assert.equal(mesh.topology.ready, true);
    assert.ok(mesh.displayPositions.flat().every(Number.isFinite));
  }
});

test('detects nonmanifold edges and bow-tie vertices', () => {
  const positions = [[0, 0, 0], [1, 0, 0], [0, 1, 0], [-1, 0, 0], [0, -1, 0]];
  const bowTie = buildTopology(positions, [[0, 1, 2], [0, 3, 4]]);
  assert.equal(bowTie.components, 1);
  assert.ok(bowTie.nonmanifoldVertices.includes(0));
  assert.equal(bowTie.vertices[0].ringValid, false);
  assert.equal(bowTie.ready, false);
  const branchingEdge = buildTopology(positions, [[0, 1, 2], [1, 0, 3], [0, 1, 4]]);
  assert.equal(branchingEdge.nonmanifoldEdges.length, 1);
  assert.equal(branchingEdge.ready, false);
});
