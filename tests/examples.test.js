import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import * as math from 'mathjs';
import { objExamples, loadOBJExample } from '../app/js/examples.js';
import { parseOBJ } from '../app/js/obj.js';
import { prepareMesh } from '../app/js/topology.js';
import { assembleSystem, createCircularBoundary, factorSystem, solveSystem } from '../app/js/parameterization.js';

const fetchLocal = async url => ({ ok: true, text: () => readFile(url, 'utf8') });

for (const [id, definition] of Object.entries(objExamples)) {
  test(`${id}: anatomical OBJ has one basal boundary and solves with every built-in method`, async () => {
    const mesh = prepareMesh(await loadOBJExample(id, parseOBJ, fetchLocal));
    assert.equal(mesh.example, true);
    assert.equal(mesh.name, definition.label);
    assert.equal(mesh.topology.ready, true, mesh.topology.issues.join(' '));
    assert.equal(mesh.topology.components, 1);
    assert.equal(mesh.topology.boundaryLoops.length, 1);
    assert.equal(mesh.topology.eulerCharacteristic, 1);
    assert.deepEqual(mesh.topology.degenerateFaces, []);
    assert.deepEqual(mesh.topology.unusedVertices, []);
    assert.ok(mesh.positions.length >= 1000 && mesh.positions.length <= 2500);
    assert.ok(mesh.topology.boundaryLoops[0].every(vertex => Math.abs(mesh.positions[vertex][2]) < 1e-9));
    const boundary = createCircularBoundary(mesh);
    for (const method of ['uniform', 'meanValue', 'cotangent', 'inverseDistance']) {
      const system = assembleSystem(mesh, method);
      const result = solveSystem(system, factorSystem(system, math), boundary, mesh.positions.length, math);
      assert.ok(result.uvs.flat().every(Number.isFinite), method);
      assert.ok(result.residuals.every(value => value < 1e-8), method);
      boundary.forEach(({ id, uv }) => assert.deepEqual(result.uvs[id], uv));
    }
  });
}

test('example loading reports missing files and unknown examples without substituting another model', async () => {
  await assert.rejects(loadOBJExample('missing', parseOBJ, fetchLocal), /Unknown OBJ example/);
  await assert.rejects(loadOBJExample('head', parseOBJ, async () => ({ ok: false, status: 404 })), /HTTP 404/);
});
