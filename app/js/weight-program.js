/** These standalone examples use only the documented ring input and Math. */
const weightFunctionComment = `// Return one weight per neighbor.
// Positions use model units; angles use radians.
// Boundary vertices are fixed.`;

export const weightExamples = {
  uniform: `${weightFunctionComment}
function computeWeights(ring) {
  return ring.neighbors.map(() => 1);
}`,
  meanValue: `${weightFunctionComment}
function computeWeights(ring) {
  return ring.neighbors.map(neighbor => {
    const [previous, next] = neighbor.centerAngles;
    return (Math.tan(previous / 2) + Math.tan(next / 2))
      / neighbor.edgeLength;
  });
}`,
  cotangent: `${weightFunctionComment}
function computeWeights(ring) {
  return ring.neighbors.map(neighbor => {
    const [previous, next] = neighbor.oppositeAngles;
    return 1 / Math.tan(previous) + 1 / Math.tan(next);
  });
}`,
  inverseDistance: `${weightFunctionComment}
function computeWeights(ring) {
  return ring.neighbors.map(neighbor => 1 / neighbor.edgeLength);
}`,
};

/** This function is serialized into the isolated evaluator, never called by the UI. */
export function compileWeightFunction(source) {
  if (typeof source !== 'string' || source.length > 100000) throw new Error('The weight function must be text under 100,000 characters.');
  return new Function(`"use strict";\n${source}\nif (typeof computeWeights !== 'function') throw new Error('Define function computeWeights(ring).');\nreturn computeWeights;`)();
}

/** All helpers are self-contained so the same runtime can be tested independently. */
export function evaluateWeightProgram(source, rings) {
  let computeWeights;
  try { computeWeights = compileWeightFunction(source); }
  catch (error) { throw new Error(`Compilation failed: ${error.name}: ${error.message}`); }
  function freeze(value) {
    if (value && typeof value === 'object' && !Object.isFrozen(value)) {
      Object.values(value).forEach(freeze); Object.freeze(value);
    }
    return value;
  }
  return rings.map(ring => {
    const id = ring.center.id;
    try {
      const result = computeWeights(freeze(ring));
      if (!Array.isArray(result)) throw new Error('Return an array of weights, not a Promise or another value.');
      if (result.length !== ring.neighbors.length) throw new Error(`Returned ${result.length} weights for ${ring.neighbors.length} neighbors.`);
      const weights = [];
      for (let i = 0; i < result.length; i++) {
        const value = result[i];
        if (typeof value !== 'number' || !Number.isFinite(value)) throw new Error(`Neighbor ${ring.neighbors[i].id}: weight must be a finite number.`);
        weights.push(value);
      }
      return { id, weights };
    } catch (error) { throw new Error(`Vertex ${id}: ${error.message}`); }
  });
}

export function createWeightWorkerSource() {
  return `${compileWeightFunction.toString()}\n${evaluateWeightProgram.toString()}\n(${weightWorkerMain.toString()})();`;
}

function weightWorkerMain() {
  const send = self.postMessage.bind(self);
  self.onmessage = ({ data }) => {
    try { send({ type: 'result', rows: evaluateWeightProgram(data.source, data.rings) }); }
    catch (error) { send({ type: 'error', message: error.message || String(error) }); }
  };
}
