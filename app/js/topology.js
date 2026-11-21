export function getMeshBounds(positions) {
  const min = [Infinity, Infinity, Infinity], max = [-Infinity, -Infinity, -Infinity];
  for (const point of positions) for (let axis = 0; axis < 3; axis++) {
    min[axis] = Math.min(min[axis], point[axis]);
    max[axis] = Math.max(max[axis], point[axis]);
  }
  const center = min.map((value, axis) => value / 2 + max[axis] / 2);
  const extent = Math.max(...max.map((value, axis) => value - min[axis]));
  if (!Number.isFinite(extent)) throw new Error('The coordinate range is too large to display.');
  return { min, max, center, scale: extent > 0 ? 2 / extent : 1 };
}

/** Build edge incidence, vertex links, ordered rings, components, and boundary loops. */
export function buildTopology(positions, faces) {
  const vertices = positions.map(() => ({ neighbors: new Set(), faces: [], edges: [], link: new Map(), isBoundary: false }));
  const edgeMap = new Map(), duplicateFaces = [], degenerateFaces = [];
  const seenFaces = new Set();
  const bounds = getMeshBounds(positions);
  const normalized = positions.map(point => point.map((value, axis) => (value - bounds.center[axis]) * bounds.scale));
  faces.forEach((face, faceId) => {
    if (face.length !== 3 || face.some(id => !Number.isInteger(id) || id < 0 || id >= positions.length)) throw new Error(`Invalid triangle ${faceId}.`);
    const key = face.slice().sort((a, b) => a - b).join(':');
    if (seenFaces.has(key)) duplicateFaces.push(faceId);
    seenFaces.add(key);
    const [a, b, c] = face.map(id => normalized[id]);
    const ab = b.map((v, axis) => v - a[axis]), ac = c.map((v, axis) => v - a[axis]);
    if (new Set(face).size < 3 || Math.hypot(ab[1] * ac[2] - ab[2] * ac[1], ab[2] * ac[0] - ab[0] * ac[2], ab[0] * ac[1] - ab[1] * ac[0]) <= 1e-12) degenerateFaces.push(faceId);
    for (const id of new Set(face)) vertices[id].faces.push(faceId);
    for (let i = 0; i < 3; i++) {
      const from = face[i], to = face[(i + 1) % 3], opposite = face[(i + 2) % 3];
      if (from === to) continue;
      vertices[from].neighbors.add(to);
      vertices[to].neighbors.add(from);
      const edgeKey = `${Math.min(from, to)}:${Math.max(from, to)}`;
      if (!edgeMap.has(edgeKey)) edgeMap.set(edgeKey, { id: edgeMap.size, vertices: [Math.min(from, to), Math.max(from, to)], halfedges: [] });
      edgeMap.get(edgeKey).halfedges.push({ from, to, face: faceId, opposite });
      if (to !== opposite && from !== opposite) {
        if (!vertices[from].link.has(to)) vertices[from].link.set(to, new Set());
        if (!vertices[from].link.has(opposite)) vertices[from].link.set(opposite, new Set());
        vertices[from].link.get(to).add(opposite);
        vertices[from].link.get(opposite).add(to);
      }
    }
  });
  const edges = [...edgeMap.values()];
  const boundaryEdges = edges.filter(edge => edge.halfedges.length === 1);
  const nonmanifoldEdges = edges.filter(edge => edge.halfedges.length > 2).map(edge => edge.id);
  const inconsistentEdges = edges.filter(edge => edge.halfedges.length === 2 && edge.halfedges[0].from === edge.halfedges[1].from).map(edge => edge.id);
  const boundaryAdjacency = new Map();
  for (const edge of edges) for (const id of edge.vertices) vertices[id].edges.push(edge.id);
  for (const edge of boundaryEdges) {
    const [a, b] = edge.vertices;
    vertices[a].isBoundary = vertices[b].isBoundary = true;
    if (!boundaryAdjacency.has(a)) boundaryAdjacency.set(a, []);
    if (!boundaryAdjacency.has(b)) boundaryAdjacency.set(b, []);
    boundaryAdjacency.get(a).push(b);
    boundaryAdjacency.get(b).push(a);
  }
  let components = 0;
  const visited = new Set();
  vertices.forEach((vertex, id) => {
    if (visited.has(id)) return;
    components++;
    const stack = [id];
    visited.add(id);
    while (stack.length) for (const neighbor of vertices[stack.pop()].neighbors) if (!visited.has(neighbor)) { visited.add(neighbor); stack.push(neighbor); }
  });
  const nonmanifoldVertices = [];
  vertices.forEach((vertex, id) => {
    const link = vertex.link;
    const endpoints = [...link.keys()].filter(key => link.get(key).size === 1);
    let valid = vertex.faces.length > 0 && link.size === vertex.neighbors.size &&
      [...link.values()].every(neighbors => neighbors.size === 1 || neighbors.size === 2) &&
      endpoints.length === (vertex.isBoundary ? 2 : 0);
    let start = endpoints[0] ?? link.keys().next().value;
    // Choose the face orientation when a coherent cyclic ring is available.
    if (!vertex.isBoundary && vertex.faces.length) {
      const face = faces[vertex.faces[0]], index = face.indexOf(id);
      start = face[(index + 1) % 3];
    } else if (vertex.isBoundary && valid) {
      const first = endpoints.find(endpoint => vertex.faces.some(faceId => {
        const face = faces[faceId], index = face.indexOf(id);
        return face[(index + 1) % 3] === endpoint;
      }));
      if (first !== undefined) start = first;
    }
    const ordered = [], seen = new Set();
    let previous, current = start;
    while (current !== undefined && !seen.has(current)) {
      ordered.push(current); seen.add(current);
      const choices = [...(link.get(current) || [])].filter(next => next !== previous);
      let next = choices[0];
      if (previous === undefined && choices.length === 2) {
        const face = faces[vertex.faces[0]], index = face.indexOf(id);
        if (face[(index + 1) % 3] === current) next = face[(index + 2) % 3];
      }
      previous = current; current = next;
    }
    valid &&= ordered.length === vertex.neighbors.size;
    if (!valid && vertex.faces.length) nonmanifoldVertices.push(id);
    vertex.orderedNeighbors = valid ? ordered : [];
    vertex.ringValid = valid;
    vertex.neighbors = [...vertex.neighbors];
    delete vertex.link;
  });
  const boundaryLoops = [], boundaryVisited = new Set();
  let boundaryRegular = [...boundaryAdjacency.values()].every(neighbors => neighbors.length === 2);
  if (boundaryRegular) for (const edge of boundaryEdges) {
    const start = edge.halfedges[0].from;
    if (boundaryVisited.has(start)) continue;
    const loop = [start]; boundaryVisited.add(start);
    let previous = start, current = edge.halfedges[0].to;
    while (current !== start && !boundaryVisited.has(current)) {
      loop.push(current); boundaryVisited.add(current);
      const next = boundaryAdjacency.get(current).find(id => id !== previous);
      previous = current; current = next;
    }
    if (current !== start) boundaryRegular = false;
    else boundaryLoops.push(loop);
  }
  const unusedVertices = vertices.flatMap((vertex, id) => vertex.faces.length ? [] : [id]);
  const eulerCharacteristic = positions.length - edges.length + faces.length;
  const manifold = !nonmanifoldEdges.length && !nonmanifoldVertices.length && !duplicateFaces.length && boundaryRegular;
  // Propagate face flips to distinguish inconsistent winding from nonorientability.
  const faceAdjacency = faces.map(() => []);
  for (const edge of edges) if (edge.halfedges.length === 2) {
    const [a, b] = edge.halfedges;
    const flip = a.from === b.from ? 1 : 0;
    faceAdjacency[a.face].push([b.face, flip]); faceAdjacency[b.face].push([a.face, flip]);
  }
  const flips = new Map(); let orientable = true;
  faces.forEach((_, id) => {
    if (flips.has(id)) return;
    flips.set(id, 0); const stack = [id];
    while (stack.length) {
      const face = stack.pop();
      for (const [neighbor, parity] of faceAdjacency[face]) {
        const expected = flips.get(face) ^ parity;
        if (flips.has(neighbor)) { if (flips.get(neighbor) !== expected) orientable = false; }
        else { flips.set(neighbor, expected); stack.push(neighbor); }
      }
    }
  });
  const isDisk = manifold && orientable && components === 1 && boundaryLoops.length === 1 && eulerCharacteristic === 1;
  const ready = isDisk && !inconsistentEdges.length && !degenerateFaces.length && !unusedVertices.length;
  const issues = [];
  if (components !== 1) issues.push(`${components} connected components; a single connected surface is required.`);
  if (unusedVertices.length) issues.push(`${unusedVertices.length} unused vertex/vertices retained to preserve OBJ indices.`);
  if (nonmanifoldEdges.length) issues.push(`${nonmanifoldEdges.length} nonmanifold edge(s) with more than two incident faces.`);
  if (nonmanifoldVertices.length) issues.push(`${nonmanifoldVertices.length} vertex/vertices have a disconnected or branching one-ring.`);
  if (duplicateFaces.length) issues.push(`${duplicateFaces.length} duplicate triangle(s).`);
  if (!boundaryRegular) issues.push('The boundary branches or does not form simple loops.');
  if (manifold && !orientable) issues.push('The surface is nonorientable.');
  if (inconsistentEdges.length) issues.push(`${inconsistentEdges.length} edge(s) have inconsistent face winding; faces were not changed.`);
  if (degenerateFaces.length) issues.push(`${degenerateFaces.length} degenerate or near-degenerate triangle(s).`);
  if (boundaryRegular && boundaryLoops.length !== 1) issues.push(`${boundaryLoops.length} boundary loops; a disk requires exactly one.`);
  if (manifold && orientable && components === 1 && !isDisk) issues.push(`The surface is not a topological disk (Euler characteristic ${eulerCharacteristic}).`);
  return { vertices, edges, boundaryEdges: boundaryEdges.map(edge => edge.vertices), boundaryLoops, components, eulerCharacteristic, manifold, orientable, isDisk, ready, issues, degenerateFaces, duplicateFaces, nonmanifoldEdges, nonmanifoldVertices, inconsistentEdges, unusedVertices };
}

/** Preserve model units; normalized coordinates are used only by the renderer. */
export function prepareMesh(mesh) {
  const bounds = getMeshBounds(mesh.positions);
  const topology = buildTopology(mesh.positions, mesh.faces);
  const displayPositions = mesh.positions.map(point => point.map((value, axis) => (value - bounds.center[axis]) * bounds.scale));
  const spans = bounds.max.map((value, axis) => value - bounds.min[axis]);
  const projectionAxes = [0, 1, 2].sort((a, b) => spans[b] - spans[a]).slice(0, 2).sort((a, b) => a - b);
  const uvs = mesh.uvs || displayPositions.map(point => projectionAxes.map(axis => point[axis] / 2 + 0.5));
  return { ...mesh, name: mesh.name || 'Curved disk', uvs, displayPositions, projectionAxes,
    uvKind: mesh.uvs ? 'reference' : 'projection', topology, bounds,
    boundary: topology.boundaryLoops[0] || [],
    originalPositions: mesh.positions.map(point => point.slice()) };
}
