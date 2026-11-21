import { buildTopology } from './topology.js';
import { createBoundary } from './parameterization.js';

export function modelToDisplay(mesh, position) {
  return position.map((value, axis) => (value - mesh.bounds.center[axis]) * mesh.bounds.scale);
}

export function displayToModel(mesh, position) {
  return position.map((value, axis) => value / mesh.bounds.scale + mesh.bounds.center[axis]);
}

/** Keep the original viewing frame fixed while geometry changes in model units. */
export function setVertexPosition(mesh, id, position) {
  if (!Number.isInteger(id) || !mesh.positions[id]) throw new Error('Select an existing vertex.');
  if (!Array.isArray(position) || position.length !== 3 || !position.every(Number.isFinite)) throw new Error('X, Y, and Z must be finite numbers.');
  const display = modelToDisplay(mesh, position);
  if (!display.every(value => Number.isFinite(value) && Math.abs(value) < 1e12)) throw new Error('The position is too far outside the model viewing frame.');
  mesh.positions[id] = position.slice();
  mesh.displayPositions[id] = display;
}

export function revalidateGeometry(mesh) {
  mesh.topology = buildTopology(mesh.positions, mesh.faces);
  mesh.boundary = mesh.topology.boundaryLoops[0] || [];
}

export function selectBoundaryState(mesh, spacing, previous, refresh = false, shape = 'circular') {
  if (!mesh.topology.ready) return previous;
  if (previous?.spacing === spacing && (previous.shape || 'circular') === shape && !refresh) return previous;
  return { shape, spacing, vertices: createBoundary(mesh, shape, spacing) };
}

/** Detect a planar model without assuming its plane is XY. */
export function findMeshPlane(mesh) {
  let bestNormal, bestLength = 0;
  for (const face of mesh.faces) {
    const [a, b, c] = face.map(id => mesh.displayPositions[id]);
    const u = b.map((value, axis) => value - a[axis]), v = c.map((value, axis) => value - a[axis]);
    const normal = [u[1] * v[2] - u[2] * v[1], u[2] * v[0] - u[0] * v[2], u[0] * v[1] - u[1] * v[0]];
    const length = Math.hypot(...normal);
    if (length > bestLength) { bestNormal = normal; bestLength = length; }
  }
  if (bestLength < 1e-12) return null;
  const normal = bestNormal.map(value => value / bestLength), point = mesh.displayPositions[mesh.faces[0][0]];
  if (mesh.displayPositions.some(position => Math.abs(position.reduce((sum, value, axis) => sum + (value - point[axis]) * normal[axis], 0)) > 1e-7)) return null;
  return normal;
}

/** Commands store changed positions only; undo never changes mesh connectivity. */
export class GeometryHistory {
  constructor(limit = 50) { this.limit = limit; this.undoStack = []; this.redoStack = []; }
  record(changes, beforeBoundary, afterBoundary, label = 'Move vertex') {
    const filtered = changes.filter(change => change.before.some((value, axis) => value !== change.after[axis]));
    if (!filtered.length) return false;
    const command = structuredClone({ changes: filtered, beforeBoundary, afterBoundary, label });
    this.undoStack.push(command);
    if (this.undoStack.length > this.limit) this.undoStack.shift();
    this.redoStack.length = 0;
    return true;
  }
  undo(mesh) {
    const command = this.undoStack.pop();
    if (!command) return null;
    command.changes.forEach(change => setVertexPosition(mesh, change.id, change.before));
    revalidateGeometry(mesh); this.redoStack.push(command);
    return { boundary: structuredClone(command.beforeBoundary), label: command.label };
  }
  redo(mesh) {
    const command = this.redoStack.pop();
    if (!command) return null;
    command.changes.forEach(change => setVertexPosition(mesh, change.id, change.after));
    revalidateGeometry(mesh); this.undoStack.push(command);
    return { boundary: structuredClone(command.afterBoundary), label: command.label };
  }
}
