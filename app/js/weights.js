const subtract = (a, b) => a.map((value, axis) => value - b[axis]);
const dot = (a, b) => a.reduce((sum, value, axis) => sum + value * b[axis], 0);
const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const length = vector => Math.hypot(...vector);

function angleAt(center, first, second) {
  const a = subtract(first, center), b = subtract(second, center);
  const la = length(a), lb = length(b);
  if (!(la > 0 && lb > 0)) throw new Error('An edge has zero length.');
  const u = a.map(value => value / la), v = b.map(value => value / lb);
  return Math.atan2(length(cross(u, v)), dot(u, v));
}

/**
 * Create the public weight-function input. Positions use original model units.
 * neighbors follow the oriented face fan; boundary fans are open.
 * centerAngles and oppositeAngles are [previous face, next face], in radians.
 * A missing boundary-side face is represented by null, never a fictitious angle.
 * A weight callback returns one unnormalized number per neighbor, in this order.
 */
export function createVertexRing(mesh, vertexId) {
  const vertex = mesh.topology.vertices[vertexId];
  if (!vertex?.ringValid) throw new Error(`Vertex ${vertexId} has no valid ordered one-ring.`);
  const center = mesh.positions[vertexId];
  const ids = vertex.orderedNeighbors;
  const faces = vertex.faces.map(id => {
    const vertexIds = mesh.faces[id].slice();
    const positions = vertexIds.map(index => mesh.positions[index].slice());
    const normal = cross(subtract(positions[1], positions[0]), subtract(positions[2], positions[0]));
    const magnitude = length(normal);
    return { id, vertexIds, positions, area: magnitude / 2, normal: normal.map(value => value / magnitude) };
  });
  const faceByPair = new Map();
  for (const face of faces) {
    const pair = face.vertexIds.filter(id => id !== vertexId).sort((a, b) => a - b).join(':');
    faceByPair.set(pair, face.id);
  }
  const neighbors = ids.map((id, index) => {
    const position = mesh.positions[id];
    const previous = index > 0 ? ids[index - 1] : vertex.isBoundary ? null : ids.at(-1);
    const next = index + 1 < ids.length ? ids[index + 1] : vertex.isBoundary ? null : ids[0];
    const sides = [previous, next];
    return {
      id, position: position.slice(), edgeLength: length(subtract(position, center)),
      centerAngles: sides.map(other => other === null ? null : angleAt(center, position, mesh.positions[other])),
      oppositeAngles: sides.map(other => other === null ? null : angleAt(mesh.positions[other], center, position)),
      oppositeVertexIds: sides,
      incidentFaceIds: sides.map(other => other === null ? null : faceByPair.get([id, other].sort((a, b) => a - b).join(':'))),
    };
  });
  return { center: { id: vertexId, position: center.slice() }, isBoundary: vertex.isBoundary, neighbors, faces };
}

export const weightMethods = {
  uniform: { name: 'Uniform / Tutte', formula: 'wᵢⱼ = 1', computeWeights: ring => ring.neighbors.map(() => 1) },
  meanValue: { name: 'Mean Value', formula: 'wᵢⱼ = [tan(θprev / 2) + tan(θnext / 2)] / ℓᵢⱼ', computeWeights: ring => ring.neighbors.map(neighbor => {
    if (neighbor.centerAngles.some(angle => angle === null)) throw new Error('Mean Value weights require a closed interior ring.');
    return neighbor.centerAngles.reduce((sum, angle) => sum + Math.tan(angle / 2), 0) / neighbor.edgeLength;
  }) },
  cotangent: { name: 'Cotangent / Harmonic', formula: 'wᵢⱼ = cot(αprev) + cot(αnext)', computeWeights: ring => ring.neighbors.map(neighbor => {
    if (neighbor.oppositeAngles.some(angle => angle === null)) throw new Error('Cotangent weights require a closed interior ring.');
    return neighbor.oppositeAngles.reduce((sum, angle) => sum + 1 / Math.tan(angle), 0);
  }) },
  inverseDistance: { name: 'Inverse Distance', formula: 'wᵢⱼ = 1 / ℓᵢⱼ', computeWeights: ring => ring.neighbors.map(neighbor => 1 / neighbor.edgeLength) },
};

export function validateWeights(ring, weights) {
  const id = ring.center.id;
  if (!Array.isArray(weights) || weights.length !== ring.neighbors.length) throw new Error(`Vertex ${id}: expected ${ring.neighbors.length} weights.`);
  let maximum = 0;
  for (let i = 0; i < weights.length; i++) {
    if (typeof weights[i] !== 'number' || !Number.isFinite(weights[i])) throw new Error(`Vertex ${id}, neighbor ${ring.neighbors[i].id}: weight must be finite.`);
    maximum = Math.max(maximum, Math.abs(weights[i]));
  }
  if (maximum === 0) throw new Error(`Vertex ${id}: all weights are zero; the row has no constraint.`);
  const scaled = weights.map(weight => weight / maximum);
  const sum = scaled.reduce((a, b) => a + b, 0);
  const absoluteSum = scaled.reduce((a, b) => a + Math.abs(b), 0);
  if (Math.abs(sum) <= 1e-12 * absoluteSum) throw new Error(`Vertex ${id}: the weight sum is zero or nearly cancels; barycentric normalization is undefined.`);
  return { scaled, sum };
}
