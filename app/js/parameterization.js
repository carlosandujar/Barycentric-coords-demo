import { createVertexRing, validateWeights, weightMethods } from './weights.js';

/** Boundary coordinates are independent of the selected weight method. */
export function createCircularBoundary(mesh, spacing = 'arcLength') {
  return createBoundary(mesh, 'circular', spacing);
}

/** Four distinct boundary vertices anchor square corners; spacing is local to each side. */
export function createBoundary(mesh, shape = 'circular', spacing = 'arcLength') {
  if (!mesh.topology.ready) throw new Error('This mesh is not ready for disk parameterization. Open Mesh Details for the required preparation.');
  if (!['circular', 'square'].includes(shape)) throw new Error(`Unknown boundary shape: ${shape}.`);
  if (!['uniform', 'arcLength'].includes(spacing)) throw new Error(`Unknown boundary spacing: ${spacing}.`);
  const loop = mesh.topology.boundaryLoops[0];
  const lengths = loop.map((id, i) => Math.hypot(...mesh.positions[id].map((value, axis) => value - mesh.positions[loop[(i + 1) % loop.length]][axis])));
  const perimeter = lengths.reduce((a, b) => a + b, 0);
  if (!(perimeter > 0) || !Number.isFinite(perimeter)) throw new Error('The boundary perimeter must be positive and finite.');
  if (shape === 'square') {
    if (loop.length < 4) throw new Error('Square boundary requires at least four boundary vertices. Choose Circular for this mesh.');
    const cumulative = [0]; lengths.forEach(length => cumulative.push(cumulative.at(-1) + length));
    const parameters = spacing === 'uniform' ? loop.map((_, i) => i / loop.length) : cumulative.slice(0, -1).map(value => value / perimeter);
    const corners = [0];
    for (let side = 1; side < 4; side++) {
      let best = corners.at(-1) + 1;
      for (let i = best + 1; i <= loop.length - (4 - side); i++) {
        if (Math.abs(parameters[i] - side / 4) < Math.abs(parameters[best] - side / 4)) best = i;
      }
      corners.push(best);
    }
    corners.push(loop.length);
    const targets = [[1, 0], [1, 1], [0, 1], [0, 0], [1, 0]], result = [];
    for (let side = 0; side < 4; side++) {
      const start = corners[side], end = corners[side + 1];
      for (let i = start; i < end; i++) {
        const t = spacing === 'uniform' ? (i - start) / (end - start) : (cumulative[i] - cumulative[start]) / (cumulative[end] - cumulative[start]);
        result.push({ id: loop[i], uv: targets[side].map((value, axis) => value + t * (targets[side + 1][axis] - value)) });
      }
    }
    return result;
  }
  let distance = 0;
  return loop.map((id, i) => {
    const angle = 2 * Math.PI * (spacing === 'uniform' ? i / loop.length : distance / perimeter);
    distance += lengths[i];
    return { id, uv: [0.5 + 0.5 * Math.cos(angle), 0.5 + 0.5 * Math.sin(angle)] };
  });
}

/** Assemble sparse rows after boundary elimination; no dense n-by-n array is created. */
export function assembleSystem(mesh, method, computeWeights = weightMethods[method]?.computeWeights) {
  if (!mesh.topology.ready) throw new Error('Mesh preparation is required before solving.');
  if (typeof computeWeights !== 'function') throw new Error(`Unknown weight method: ${method}.`);
  const interiorIds = mesh.topology.vertices.flatMap((vertex, id) => vertex.isBoundary ? [] : [id]);
  const interiorIndex = new Map(interiorIds.map((id, index) => [id, index]));
  let negativeWeights = 0, zeroWeights = 0, nonzeros = 0;
  const rows = interiorIds.map((id, row) => {
    const ring = createVertexRing(mesh, id);
    let raw;
    try { raw = computeWeights(ring); }
    catch (error) { throw new Error(`Vertex ${id}: ${error.message}`); }
    const { scaled, sum } = validateWeights(ring, raw);
    const coefficients = new Map([[row, sum]]), boundaryTerms = [];
    raw.forEach(weight => { if (weight < 0) negativeWeights++; if (weight === 0) zeroWeights++; });
    scaled.forEach((weight, i) => {
      if (weight === 0) return;
      const neighborId = ring.neighbors[i].id;
      if (interiorIndex.has(neighborId)) coefficients.set(interiorIndex.get(neighborId), -weight);
      else boundaryTerms.push({ id: neighborId, weight });
    });
    const entries = [...coefficients].filter(([, value]) => value !== 0);
    nonzeros += entries.length;
    return { id, entries, boundaryTerms };
  });
  return { interiorIds, rows, size: interiorIds.length, nonzeros, negativeWeights, zeroWeights };
}

export function createRightHandSides(system, boundary) {
  const values = new Map(boundary.map(({ id, uv }) => [id, uv]));
  return [0, 1].map(axis => system.rows.map(row => row.boundaryTerms.reduce((sum, term) => {
    const uv = values.get(term.id);
    if (!uv || !uv.every(Number.isFinite)) throw new Error(`Missing or invalid boundary UV for vertex ${term.id}.`);
    return sum + term.weight * uv[axis];
  }, 0)));
}

export function validateBoundary(mesh, boundary) {
  if (!mesh.topology.ready) throw new Error('Mesh preparation is required before solving.');
  const expected = new Set(mesh.topology.boundaryLoops[0]);
  if (!Array.isArray(boundary) || boundary.length !== expected.size) throw new Error('Boundary constraints must cover the complete boundary loop.');
  for (const entry of boundary) {
    if (!entry || !expected.delete(entry.id) || !Array.isArray(entry.uv) || entry.uv.length !== 2 || !entry.uv.every(Number.isFinite)) throw new Error('Boundary constraints contain duplicate IDs, missing vertices, or invalid UV coordinates.');
  }
  return boundary.map(({ id, uv }) => ({ id, uv: uv.slice() }));
}

export function factorSystem(system, math) {
  if (system.size === 0) return null;
  const matrix = math.sparse();
  matrix.resize([system.size, system.size]);
  system.rows.forEach((row, i) => row.entries.forEach(([j, value]) => matrix.set([i, j], value)));
  try { return math.slu(matrix, 2, 1); }
  catch (error) { throw new Error(`Sparse LU factorization failed: ${error.message}`); }
}

/** Infinity-norm relative residual, with a stable zero-RHS fallback. */
export function calculateResidual(system, solution, rhs) {
  let residual = 0, rhsNorm = 0, matrixNorm = 0, solutionNorm = 0;
  solution.forEach(value => { if (!Number.isFinite(value)) throw new Error('The solver returned a nonfinite coordinate.'); solutionNorm = Math.max(solutionNorm, Math.abs(value)); });
  system.rows.forEach((row, i) => {
    const value = row.entries.reduce((sum, [j, coefficient]) => sum + coefficient * solution[j], 0);
    residual = Math.max(residual, Math.abs(value - rhs[i]));
    rhsNorm = Math.max(rhsNorm, Math.abs(rhs[i]));
    matrixNorm = Math.max(matrixNorm, row.entries.reduce((sum, [, coefficient]) => sum + Math.abs(coefficient), 0));
  });
  return residual / (rhsNorm || matrixNorm * solutionNorm || 1);
}

export function solveSystem(system, factorization, boundary, vertexCount, math) {
  const uvs = Array.from({ length: vertexCount }, () => [0, 0]);
  boundary.forEach(({ id, uv }) => { uvs[id] = uv.slice(); });
  if (!system.size) return { uvs, residuals: [0, 0] };
  const rhs = createRightHandSides(system, boundary);
  const residuals = rhs.map((column, axis) => {
    let result;
    try { result = math.lusolve(factorization, column).valueOf().map(row => Array.isArray(row) ? row[0] : row); }
    catch (error) { throw new Error(`Sparse LU solve failed: ${error.message}`); }
    if (result.length !== system.size) throw new Error('The solver returned an unexpected solution size.');
    const residual = calculateResidual(system, result, column);
    if (!Number.isFinite(residual) || residual > 1e-8) throw new Error(`The relative residual ${residual.toExponential(2)} exceeds the 1e-8 acceptance threshold.`);
    system.interiorIds.forEach((id, i) => { uvs[id][axis] = result[i]; });
    return residual;
  });
  return { uvs, residuals };
}
