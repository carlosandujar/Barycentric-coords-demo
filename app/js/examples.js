export const objExamples = {
  head: { label: 'Human head · Neck', path: './examples/human-head.obj', description: 'MakeHuman head with a single open neck boundary. Simplified for interactive experiments.' },
  headDetailed: { label: 'Human head · Detailed', path: './examples/human-head-detailed.obj', description: 'A higher-resolution version of the same head, with the same open neck boundary.' },
  torso: { label: 'Human torso · Waist', path: './examples/human-torso.obj', description: 'Headless torso with an open waist. The neck and cut arm ends are capped to retain disk topology.' },
  bust: { label: 'Human bust · Waist', path: './examples/human-bust.obj', description: 'Head and upper body with an open waist. Cut arm ends are capped to retain disk topology.' },
};

/** Load real OBJ assets through the same parser used for local imports. */
export async function loadOBJExample(id, parseOBJ, fetchAsset = fetch) {
  const example = objExamples[id];
  if (!example) throw new Error(`Unknown OBJ example: ${id}.`);
  const response = await fetchAsset(new URL(example.path, new URL('../', import.meta.url)));
  if (!response.ok) throw new Error(`Could not load ${example.label} (HTTP ${response.status}).`);
  return { ...parseOBJ(await response.text(), example.label), example: true, exampleDescription: example.description,
    viewPreset: { position: [1.5, -4.2, 1.1] } };
}
