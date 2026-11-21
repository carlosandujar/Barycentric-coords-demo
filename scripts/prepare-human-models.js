import { readFile, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { MeshoptSimplifier } from 'meshoptimizer';
import { parseOBJ, triangulatePolygon } from '../app/js/obj.js';
import { buildTopology } from '../app/js/topology.js';

const sourcePath = fileURLToPath(new URL('../.model-sources/base.obj', import.meta.url));
const source = await readFile(sourcePath, 'utf8');
let group = '';
const geometry = source.split(/\r?\n/).filter(line => {
  if (line.startsWith('g ')) group = line.slice(2).trim();
  return line.startsWith('v ') || group === 'body' && line.startsWith('f ');
}).join('\n');

function compact(mesh) {
  const used = [...new Set(mesh.faces.flat())].sort((a, b) => a - b);
  const map = new Map(used.map((id, i) => [id, i]));
  return { positions: used.map(id => mesh.positions[id]), faces: mesh.faces.map(face => face.map(id => map.get(id))) };
}

function report(label, mesh) {
  const topology = buildTopology(mesh.positions, mesh.faces);
  console.log(JSON.stringify({ label, vertices: mesh.positions.length, faces: mesh.faces.length,
    min: [0, 1, 2].map(axis => Math.min(...mesh.positions.map(p => p[axis]))),
    max: [0, 1, 2].map(axis => Math.max(...mesh.positions.map(p => p[axis]))),
    components: topology.components, euler: topology.eulerCharacteristic,
    loops: topology.boundaryLoops.map(loop => ({ count: loop.length, center: [0, 1, 2].map(axis => loop.reduce((sum, id) => sum + mesh.positions[id][axis], 0) / loop.length) })), issues: topology.issues }));
  return topology;
}

const positions = [], faces = [];
for (const line of geometry.split('\n')) {
  const [command, ...fields] = line.trim().split(/\s+/);
  if (command === 'v') positions.push(fields.slice(0, 3).map(Number));
  if (command === 'f') {
    const ids = fields.map(field => Number(field.split('/')[0]) - 1);
    for (let i = 1; i + 1 < ids.length; i++) faces.push([ids[0], ids[i], ids[i + 1]]);
  }
}
const sourceHash = createHash('sha256').update(source).digest('hex');
if (sourceHash !== '8e761e6624b8f54536409135d1636da63b32486a90d4897f84e121d144f6fb4c') throw new Error('Unexpected MakeHuman source checksum. See docs/MODELS.md.');
const body = compact({ positions, faces });

/** Clip triangles while sharing every intersection on a source edge. */
function clipCoordinate(mesh, height, keepAbove, axis = 1) {
  const positions = mesh.positions.map(point => point.slice()), faces = [], intersections = new Map();
  function intersection(a, b) {
    if (Math.abs(positions[a][axis] - height) < 1e-10) return a;
    if (Math.abs(positions[b][axis] - height) < 1e-10) return b;
    const key = [a, b].sort((x, y) => x - y).join(':');
    if (!intersections.has(key)) {
      const t = (height - positions[a][axis]) / (positions[b][axis] - positions[a][axis]);
      const point = positions[a].map((value, coordinate) => value + t * (positions[b][coordinate] - value));
      point[axis] = height;
      intersections.set(key, positions.length); positions.push(point);
    }
    return intersections.get(key);
  }
  const inside = id => keepAbove ? positions[id][axis] >= height : positions[id][axis] <= height;
  for (const face of mesh.faces) {
    const polygon = [];
    for (let i = 0; i < 3; i++) {
      const a = face[i], b = face[(i + 1) % 3];
      if (inside(a)) polygon.push(a);
      if (inside(a) !== inside(b)) polygon.push(intersection(a, b));
    }
    const ids = polygon.filter((id, i) => id !== polygon[(i + polygon.length - 1) % polygon.length]);
    for (let i = 1; i + 1 < ids.length; i++) if (new Set([ids[0], ids[i], ids[i + 1]]).size === 3) faces.push([ids[0], ids[i], ids[i + 1]]);
  }
  return compact({ positions, faces });
}

function largestComponent(mesh) {
  const adjacency = mesh.positions.map(() => []);
  mesh.faces.forEach(face => face.forEach((id, i) => { adjacency[id].push(face[(i + 1) % 3], face[(i + 2) % 3]); }));
  const visited = new Set(); let largest = [];
  for (let id = 0; id < mesh.positions.length; id++) {
    if (visited.has(id)) continue;
    const component = [], stack = [id]; visited.add(id);
    while (stack.length) {
      const current = stack.pop(); component.push(current);
      for (const next of adjacency[current]) if (!visited.has(next)) { visited.add(next); stack.push(next); }
    }
    if (component.length > largest.length) largest = component;
  }
  const keep = new Set(largest);
  return compact({ positions: mesh.positions, faces: mesh.faces.filter(face => keep.has(face[0])) });
}

function capExceptOpening(mesh, openingHeight) {
  const topology = buildTopology(mesh.positions, mesh.faces);
  const area = loop => Math.abs(loop.reduce((sum, id, i) => {
    const p = mesh.positions[id], q = mesh.positions[loop[(i + 1) % loop.length]];
    return sum + p[0] * q[2] - q[0] * p[2];
  }, 0));
  const candidates = topology.boundaryLoops.filter(loop => loop.every(id => Math.abs(mesh.positions[id][1] - openingHeight) < 1e-7));
  candidates.sort((a, b) => area(b) - area(a));
  const opening = candidates[0];
  if (!opening) throw new Error(`No opening at height ${openingHeight}.`);
  const faces = mesh.faces.map(face => face.slice());
  for (const loop of topology.boundaryLoops) if (loop !== opening) {
    const { triangles } = triangulatePolygon(loop.slice().reverse(), mesh.positions);
    faces.push(...triangles);
  }
  const result = { positions: mesh.positions, faces };
  const check = buildTopology(result.positions, result.faces);
  if (!check.ready) throw new Error(`Cap validation failed: ${check.issues.join(' ')}`);
  return result;
}

await MeshoptSimplifier.ready;
const definitions = [
  { file: 'human-head.obj', name: 'Human head - neck boundary', bottom: 5.9, targetFaces: 2200 },
  { file: 'human-head-detailed.obj', name: 'Human head - detailed', bottom: 5.9, targetFaces: 4200 },
  { file: 'human-torso.obj', name: 'Human torso - waist boundary', bottom: 1.8, top: 5.9, armCut: 2.3, targetFaces: 2800 },
  { file: 'human-bust.obj', name: 'Human bust - waist boundary', bottom: 1.8, armCut: 2.3, targetFaces: 4200 },
];
for (const definition of definitions) {
  let mesh = largestComponent(clipCoordinate(body, definition.bottom, true));
  if (definition.top) mesh = largestComponent(clipCoordinate(mesh, definition.top, false));
  if (definition.armCut) {
    mesh = largestComponent(clipCoordinate(mesh, -definition.armCut, true, 0));
    mesh = largestComponent(clipCoordinate(mesh, definition.armCut, false, 0));
  }
  mesh = capExceptOpening(mesh, definition.bottom);
  const [indices, error] = MeshoptSimplifier.simplify(new Uint32Array(mesh.faces.flat()), new Float32Array(mesh.positions.flat()), 3, definition.targetFaces * 3, 0.015, ['LockBorder']);
  const triangles = Array.from({ length: indices.length / 3 }, (_, i) => Array.from(indices.slice(i * 3, i * 3 + 3)));
  // Collapsing tiny closed folds can leave paired, opposite duplicate faces.
  const faceGroups = new Map();
  triangles.forEach((face, i) => {
    const key = face.slice().sort((a, b) => a - b).join(':');
    if (!faceGroups.has(key)) faceGroups.set(key, []);
    faceGroups.get(key).push(i);
  });
  const paired = new Set();
  for (const ids of faceGroups.values()) if (ids.length === 2) {
    const a = triangles[ids[0]], b = triangles[ids[1]], start = b.indexOf(a[0]);
    if (b[(start + 1) % 3] === a[2]) ids.forEach(id => paired.add(id));
  }
  mesh = compact({ positions: mesh.positions, faces: triangles.filter((_, id) => !paired.has(id)) });
  // Rotate Y-up MakeHuman coordinates into the application's Z-up model space.
  mesh.positions = mesh.positions.map(([x, y, z]) => [x, -z, y - definition.bottom]);
  const lines = [
    `# ${definition.name}`, '# Source: MakeHuman HM08 base mesh, CC0 1.0 Universal.',
    '# Source URL: https://github.com/makehumancommunity/makehuman/blob/master/makehuman/data/3dobjs/base.obj',
    `# Source SHA-256: ${sourceHash}`, '# Prepared by clipping, capping secondary openings, simplifying, and rotating to Z-up.',
    `# Boundary: ${definition.bottom === 5.9 ? 'neck' : 'waist'} at Z = 0; all other openings are capped.`,
    '# See docs/MODELS.md for provenance and preparation details.',
    ...mesh.positions.map(point => `v ${point.map(value => Math.abs(value) < 1e-10 ? '0' : value.toFixed(9)).join(' ')}`),
    ...mesh.faces.map(face => `f ${face.map(id => id + 1).join(' ')}`), '',
  ];
  const obj = lines.join('\n');
  const parsed = parseOBJ(obj);
  const checked = report(definition.file, parsed);
  if (!checked.ready) throw new Error(`Prepared OBJ is invalid: ${checked.issues.join(' ')}`);
  await writeFile(new URL(`../app/examples/${definition.file}`, import.meta.url), obj);
  console.log(`Simplification error for ${definition.file}: ${error.toFixed(6)}`);
}
