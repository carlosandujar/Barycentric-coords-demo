/** Shared limits for UV patterns and close inspection of normalized meshes. */
export const PATTERN_CELLS = Object.freeze({ min: 2, max: 256, step: 2, default: 12 });

export const VIEW_LIMITS = Object.freeze({
  sourceNear: 0.01,
  sourceMinDistance: 0.001,
  sourceMaxDistance: 15,
  sourceMinZoom: 0.35,
  sourceMaxZoom: 4096,
  uvMinZoom: 0.35,
  uvMaxZoom: 4096,
  far: 100,
});
