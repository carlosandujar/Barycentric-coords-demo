const cross2 = (a, b, c) => (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0]);

/** Ear clipping on a normalized dominant-plane projection preserves OBJ winding. */
export function triangulatePolygon(ids, positions) {
  if (ids.length === 3) return { triangles: [ids.slice()], nonplanar: false };
  if (new Set(ids).size !== ids.length) throw new Error('A polygon repeats a position index.');
  const points = ids.map(id => positions[id]);
  const origin = points[0];
  const scale = Math.max(...[0, 1, 2].map(axis => {
    let min = Infinity, max = -Infinity;
    for (const point of points) { min = Math.min(min, point[axis]); max = Math.max(max, point[axis]); }
    return max - min;
  }));
  if (!(scale > 0) || !Number.isFinite(scale)) throw new Error('The polygon has no usable extent.');
  const local = points.map(point => point.map((value, axis) => (value - origin[axis]) / scale));
  const normal = [0, 0, 0];
  local.forEach((point, index) => {
    const next = local[(index + 1) % local.length];
    normal[0] += (point[1] - next[1]) * (point[2] + next[2]);
    normal[1] += (point[2] - next[2]) * (point[0] + next[0]);
    normal[2] += (point[0] - next[0]) * (point[1] + next[1]);
  });
  const length = Math.hypot(...normal);
  // A zero Newell normal also occurs for self-intersecting polygons.
  if (length < 1e-12) throw new Error('The polygon is degenerate or self-intersecting.');
  const drop = normal.map(Math.abs).indexOf(Math.max(...normal.map(Math.abs)));
  const axes = [0, 1, 2].filter(axis => axis !== drop);
  const projected = local.map(point => axes.map(axis => point[axis]));
  const epsilon = 1e-12;
  const onSegment = (a, b, p) => Math.abs(cross2(a, b, p)) <= epsilon &&
    p[0] >= Math.min(a[0], b[0]) - epsilon && p[0] <= Math.max(a[0], b[0]) + epsilon &&
    p[1] >= Math.min(a[1], b[1]) - epsilon && p[1] <= Math.max(a[1], b[1]) + epsilon;
  function intersects(a, b, c, d) {
    const abC = cross2(a, b, c), abD = cross2(a, b, d);
    const cdA = cross2(c, d, a), cdB = cross2(c, d, b);
    return ((abC > epsilon && abD < -epsilon || abC < -epsilon && abD > epsilon) &&
      (cdA > epsilon && cdB < -epsilon || cdA < -epsilon && cdB > epsilon)) ||
      onSegment(a, b, c) || onSegment(a, b, d) || onSegment(c, d, a) || onSegment(c, d, b);
  }
  for (let i = 0; i < ids.length; i++) {
    for (let j = i + 1; j < ids.length; j++) {
      if (j === i + 1 || i === 0 && j === ids.length - 1) continue;
      if (intersects(projected[i], projected[(i + 1) % ids.length], projected[j], projected[(j + 1) % ids.length])) {
        throw new Error('The polygon intersects itself in its dominant-plane projection.');
      }
    }
  }
  let signedArea = 0;
  projected.forEach((p, i) => { const q = projected[(i + 1) % ids.length]; signedArea += p[0] * q[1] - p[1] * q[0]; });
  const sign = Math.sign(signedArea);
  const remaining = ids.map((_, index) => index);
  const triangles = [];
  while (remaining.length > 3) {
    let found = false;
    for (let i = 0; i < remaining.length; i++) {
      const a = remaining[(i + remaining.length - 1) % remaining.length];
      const b = remaining[i], c = remaining[(i + 1) % remaining.length];
      if (sign * cross2(projected[a], projected[b], projected[c]) <= epsilon) continue;
      const containsPoint = remaining.some(p => p !== a && p !== b && p !== c &&
        sign * cross2(projected[a], projected[b], projected[p]) >= -epsilon &&
        sign * cross2(projected[b], projected[c], projected[p]) >= -epsilon &&
        sign * cross2(projected[c], projected[a], projected[p]) >= -epsilon);
      if (containsPoint) continue;
      triangles.push([ids[a], ids[b], ids[c]]);
      remaining.splice(i, 1);
      found = true;
      break;
    }
    if (!found) throw new Error('The polygon could not be triangulated without degeneracies.');
  }
  if (Math.abs(cross2(...remaining.map(i => projected[i]))) <= epsilon) throw new Error('The polygon ends in a degenerate triangle.');
  triangles.push(remaining.map(i => ids[i]));
  const nonplanar = local.some(point => Math.abs(point.reduce((sum, value, axis) => sum + value * normal[axis], 0)) / length > 1e-6);
  return { triangles, nonplanar };
}

/** Parse only OBJ geometry; texture and normal indices never split position indices. */
export function parseOBJ(text, name = 'Imported mesh') {
  const positions = [], faces = [], faceSources = [], warnings = [];
  let polygonCount = 0, triangulatedPolygons = 0, nonplanarPolygons = 0;
  let logicalLine = '', firstLine = 0;
  const lines = text.replace(/^\uFEFF/, '').split(/\r?\n/);
  function fail(line, message) { throw new Error(`OBJ line ${line}: ${message}`); }
  lines.forEach((raw, index) => {
    let line = raw.split('#')[0].trim();
    if (!logicalLine) firstLine = index + 1;
    const continued = line.endsWith('\\');
    if (continued) line = line.slice(0, -1);
    logicalLine += ` ${line}`;
    if (continued) return;
    const [command, ...fields] = logicalLine.trim().split(/\s+/);
    logicalLine = '';
    if (command === 'v') {
      if (fields.length < 3) fail(firstLine, 'A vertex needs three coordinates.');
      const point = fields.slice(0, 3).map(Number);
      if (!point.every(Number.isFinite)) fail(firstLine, 'Vertex coordinates must be finite numbers.');
      positions.push(point);
    } else if (command === 'f') {
      polygonCount++;
      if (fields.length < 3) fail(firstLine, 'A face needs at least three vertices.');
      const ids = fields.map(field => {
        const token = field.split('/')[0];
        if (!/^[+-]?\d+$/.test(token)) fail(firstLine, `Invalid position index "${token}".`);
        const rawId = Number(token);
        const id = rawId > 0 ? rawId - 1 : positions.length + rawId;
        if (!Number.isSafeInteger(rawId) || rawId === 0 || id < 0 || id >= positions.length) fail(firstLine, `Position index ${token} is out of range.`);
        return id;
      });
      let result;
      try { result = triangulatePolygon(ids, positions); }
      catch (error) { fail(firstLine, error.message); }
      if (ids.length > 3) triangulatedPolygons++;
      if (result.nonplanar) nonplanarPolygons++;
      for (const triangle of result.triangles) {
        faces.push(triangle);
        faceSources.push({ polygon: polygonCount - 1, line: firstLine });
      }
    }
  });
  if (logicalLine.trim()) fail(firstLine, 'Unfinished line continuation.');
  if (!positions.length || !faces.length) throw new Error('The OBJ must contain positions and polygon faces.');
  if (nonplanarPolygons) warnings.push(`${nonplanarPolygons} nonplanar polygon(s) triangulated using a dominant-plane projection.`);
  return { name, positions, faces, faceSources, importInfo: { polygonCount, triangulatedPolygons, warnings } };
}
