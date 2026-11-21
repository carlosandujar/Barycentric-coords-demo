/** Create a deterministic disk with shared indices and a predefined UV layout. */
export function createExampleMesh() {
  const positions = [[0, 0, 0.65]];
  const uvs = [[0.5, 0.5]];
  const faces = [];
  const segments = 12;
  const ringCount = 3;
  for (let ring = 1; ring <= ringCount; ring++) {
    const radius = ring / ringCount;
    for (let segment = 0; segment < segments; segment++) {
      const angle = segment * Math.PI * 2 / segments;
      const x = radius * Math.cos(angle);
      const y = radius * Math.sin(angle);
      positions.push([x, y, 0.65 * (1 - radius * radius) + 0.14 * Math.sin(2 * angle) * radius]);
      uvs.push([0.5 + x * 0.5, 0.5 + y * 0.5]);
    }
  }
  const ringVertex = (ring, segment) => 1 + (ring - 1) * segments + segment % segments;
  for (let segment = 0; segment < segments; segment++) {
    faces.push([0, ringVertex(1, segment), ringVertex(1, segment + 1)]);
  }
  for (let ring = 1; ring < ringCount; ring++) {
    for (let segment = 0; segment < segments; segment++) {
      const a = ringVertex(ring, segment);
      const b = ringVertex(ring + 1, segment);
      const c = ringVertex(ring + 1, segment + 1);
      const d = ringVertex(ring, segment + 1);
      faces.push([a, b, c], [a, c, d]);
    }
  }
  return { positions, uvs, faces, boundary: Array.from({ length: segments }, (_, i) => ringVertex(ringCount, i)) };
}

export function createPlanarExampleMesh() {
  const mesh = createExampleMesh();
  return { ...mesh, name: 'Planar disk', positions: mesh.positions.map(([x, y]) => [x, y, 0]) };
}
