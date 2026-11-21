const subtract = (a, b) => a.map((value, i) => value - b[i]);
const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const determinant = (a, b) => a[0] * b[1] - a[1] * b[0];
const UV_COLLAPSE_AREA_TOLERANCE = 1e-15;

function normalizeCoordinates(points, dimensions) {
  const minimum = Array(dimensions).fill(Infinity), maximum = Array(dimensions).fill(-Infinity);
  for (const point of points) for (let axis = 0; axis < dimensions; axis++) {
    minimum[axis] = Math.min(minimum[axis], point[axis]); maximum[axis] = Math.max(maximum[axis], point[axis]);
  }
  const scale = Math.max(...maximum.map((value, axis) => value - minimum[axis])) || 1;
  return points.map(point => minimum.map((value, axis) => (point[axis] - value) / scale));
}

function angles(points) {
  return points.map((point, i) => {
    const a = subtract(points[(i + 1) % 3], point), b = subtract(points[(i + 2) % 3], point);
    const sine = a.length === 3 ? Math.hypot(...cross(a, b)) : Math.abs(determinant(a, b));
    return Math.atan2(sine, a.reduce((sum, value, axis) => sum + value * b[axis], 0));
  });
}

/** Compare each triangle with its intrinsic 3D geometry, independent of model units. */
export function analyzeParameterization(mesh, uvs = mesh.uvs) {
  const positions = normalizeCoordinates(mesh.positions, 3), uv = normalizeCoordinates(uvs, 2);
  const faces = mesh.faces.map(ids => {
    const source = ids.map(id => positions[id]), target = ids.map(id => uv[id]);
    const sourceArea = Math.hypot(...cross(subtract(source[1], source[0]), subtract(source[2], source[0]))) / 2;
    const signedUVArea = determinant(subtract(target[1], target[0]), subtract(target[2], target[0])) / 2;
    const invalid = !Number.isFinite(sourceArea + signedUVArea) || sourceArea <= 1e-14;
    const collapsed = !invalid && Math.abs(signedUVArea) <= UV_COLLAPSE_AREA_TOLERANCE;
    const inverted = !invalid && !collapsed && signedUVArea < 0;
    const sourceAngles = angles(source), uvAngles = angles(target);
    const angleError = invalid || collapsed ? null : Math.max(...sourceAngles.map((value, i) => Math.abs(value - uvAngles[i]))) * 180 / Math.PI;
    return { sourceArea, signedUVArea, invalid, collapsed, inverted, angleError, areaLog2: null };
  });
  // Absolute areas keep the normalization well-defined even when folds overlap.
  const totalSourceArea = faces.reduce((sum, face) => sum + (face.invalid ? 0 : face.sourceArea), 0);
  const totalUVArea = faces.reduce((sum, face) => sum + (face.invalid ? 0 : Math.abs(face.signedUVArea)), 0);
  for (const face of faces) if (!face.invalid && !face.collapsed && totalUVArea > 0) {
    face.areaLog2 = Math.log2((Math.abs(face.signedUVArea) / totalUVArea) / (face.sourceArea / totalSourceArea));
  }
  let maxAngleError = 0, maxAreaLog2 = 0;
  let angleSum = 0, areaSum = 0, measuredFaceCount = 0;
  const inverted = [], collapsed = [], invalid = [];
  faces.forEach((face, id) => {
    if (face.inverted) inverted.push(id);
    if (face.collapsed) collapsed.push(id);
    if (face.invalid) invalid.push(id);
    maxAngleError = Math.max(maxAngleError, face.angleError || 0);
    maxAreaLog2 = Math.max(maxAreaLog2, Math.abs(face.areaLog2 || 0));
    if (Number.isFinite(face.angleError) && Number.isFinite(face.areaLog2)) {
      angleSum += face.angleError;
      areaSum += Math.abs(face.areaLog2);
      measuredFaceCount++;
    }
  });
  return { faces, inverted, collapsed, invalid, maxAngleError, maxAreaLog2, measuredFaceCount,
    meanAngleError: measuredFaceCount ? angleSum / measuredFaceCount : null,
    meanAreaLog2: measuredFaceCount ? areaSum / measuredFaceCount : null };
}

export const DISTORTION_LIMITS = Object.freeze({ angle: 60, area: 3 });

export function distortionColor(face, mode) {
  if (face.invalid) return [0.4, 0.4, 0.4];
  if (face.collapsed) return [1, 0.65, 0.05];
  if (face.inverted) return [0.85, 0.06, 0.25];
  if (mode === 'inversions') return [0.55, 0.8, 0.69];
  if (mode === 'angle') {
    const t = Math.min(1, face.angleError / DISTORTION_LIMITS.angle);
    return t < 0.5 ? [0.15 + 1.5 * t, 0.65 + 0.4 * t, 0.75 - 1.2 * t] : [0.9, 0.85 - 1.3 * (t - 0.5), 0.15];
  }
  const t = Math.min(1, Math.abs(face.areaLog2) / DISTORTION_LIMITS.area);
  const end = face.areaLog2 < 0 ? [0.16, 0.39, 0.82] : [0.9, 0.35, 0.08];
  return end.map(value => 0.95 * (1 - t) + value * t);
}
