import { assembleSystem, createBoundary, validateBoundary, factorSystem, solveSystem } from './parameterization.js';

const MATH_URL = 'https://cdn.jsdelivr.net/npm/mathjs@14.8.1/+esm';
let mathPromise, cache, latestRequest = 0;

self.onmessage = async ({ data }) => {
  const { requestId, meshId, mesh, method, spacing, programKey, weightRows } = data;
  latestRequest = requestId;
  try {
    const start = performance.now();
    const boundary = data.boundary ? validateBoundary(mesh, data.boundary) : createBoundary(mesh, data.shape || 'circular', spacing);
    const reused = cache?.meshId === meshId && cache?.programKey === programKey;
    const rowsById = new Map(weightRows.map(row => [row.id, row.weights]));
    const system = reused ? cache.system : assembleSystem(mesh, method, ring => rowsById.get(ring.center.id));
    let math;
    if (system.size) {
      self.postMessage({ type: 'progress', requestId, message: mathPromise ? 'Preparing sparse LU…' : 'Loading math.js from CDN…' });
      mathPromise ??= import(MATH_URL).catch(() => {
        mathPromise = null;
        throw new Error('Could not load math.js 14.8.1 from the CDN. Check your internet connection and retry.');
      });
      math = await mathPromise;
    }
    if (requestId !== latestRequest) return;
    const factorStart = performance.now();
    const factorization = reused ? cache.factorization : factorSystem(system, math);
    const factorMs = reused ? 0 : performance.now() - factorStart;
    cache = { meshId, programKey, system, factorization };
    const solution = solveSystem(system, factorization, boundary, mesh.positions.length, math);
    self.postMessage({ type: 'result', requestId, ...solution, diagnostics: {
      interiorVertices: system.size, nonzeros: system.nonzeros, negativeWeights: system.negativeWeights, zeroWeights: system.zeroWeights,
      factorizationReused: reused, factorMs, elapsedMs: performance.now() - start,
    } });
  } catch (error) {
    if (requestId === latestRequest) self.postMessage({ type: 'error', requestId, message: error.message || String(error) });
  }
};
