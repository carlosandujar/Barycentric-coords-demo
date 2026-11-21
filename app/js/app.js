import { createExampleMesh, createPlanarExampleMesh } from './mesh.js';
import { MeshViewer } from './viewer.js';
import { initializeLayout } from './layout.js';
import { parseOBJ } from './obj.js';
import { prepareMesh } from './topology.js';
import { weightMethods, createVertexRing, validateWeights } from './weights.js';
import { SolverController } from './solver-controller.js';
import { weightExamples } from './weight-program.js';
import { WeightRunner } from './weight-runner.js';
import { initializeWeightEditor } from './editor.js';
import { GeometryHistory, setVertexPosition, revalidateGeometry, selectBoundaryState } from './geometry-editing.js';
import { loadOBJExample } from './examples.js';
import { analyzeParameterization } from './distortion.js';
import { createDistortionLegend } from './distortion-legend.js';
import { createDistortionInfo } from './distortion-info.js';
import { PATTERN_CELLS } from './settings.js';

let mesh = prepareMesh(createExampleMesh());
let selection = { type: 'vertex', id: 0 };
const viewers = [];
const getElement = id => document.getElementById(id);
const distortionLegends = ['source-view', 'uv-view'].map(id => createDistortionLegend(getElement(id)));
const distortionInfo = ['source-view', 'uv-view'].map(id => createDistortionInfo(getElement(id)));
Object.assign(getElement('checker-size'), { min: PATTERN_CELLS.min, max: PATTERN_CELLS.max, step: PATTERN_CELLS.step, value: PATTERN_CELLS.default });
const solver = new SolverController();
const weightRunner = new WeightRunner();
let activeProgram = { method: 'uniform', source: weightExamples.uniform };

let evaluatedCache = null;
let evaluationRevision = 0;
let displayedWeightRows = new Map();
let weightEditor;
let meshId = 1;
let calculationId = 0;
let displayedSolution = null;
let geometryHistory = new GeometryHistory();
let boundaryState = null;
let editTool = 'select';
let dragTransaction = null;
let moveConstraint = 'gizmo';
let meshLoadPending = false;
let analysisSnapshot = null;
let loadedModel = 'curved';
let importedModel = null;
let lastGeometryMessage = null;
let lastSolverMessage = null;
initializeLayout();
try {
  viewers.push(new MeshViewer(getElement('source-view'), mesh, 'source', selectElement, { onBegin: beginGeometryEdit, onMove: previewGeometryEdit, onEnd: finishGeometryEdit, onCancel: cancelGeometryEdit }));
  viewers.push(new MeshViewer(getElement('uv-view'), mesh, 'uv', selectElement));
} catch (error) {
  viewers.forEach(viewer => viewer.dispose());
  throw error;
}

weightEditor = initializeWeightEditor(getElement('weight-code'), () => {
  getElement('weight-method').value = identifyMethod(weightEditor.getValue());
  showEditorFeedback('Unapplied changes. Apply to evaluate the function and update the UV solution.');
});
weightEditor.setValue(activeProgram.source);

function formatCoordinate(value) {
  return (Math.abs(value) < 0.00005 ? 0 : value).toFixed(4);
}

function renderSelectionOverlays() {
  distortionInfo.forEach(update => update(analysisSnapshot, selection));
  getElement('source-selection').hidden = !selection;
  getElement('uv-selection').hidden = !selection;
  if (!selection) return;
  const vertexSelected = selection.type === 'vertex';
  getElement('source-selection-title').textContent = `${vertexSelected ? 'Vertex' : 'Triangle'} ${selection.id} selected`;
  if (vertexSelected) {
    const vertex = mesh.topology.vertices[selection.id];
    getElement('source-coordinates').textContent = mesh.positions[selection.id].map((value, axis) => `${'xyz'[axis]} ${formatCoordinate(value)}`).join('  ');
    getElement('source-selection-description').textContent = `${vertex.isBoundary ? 'Boundary' : vertex.faces.length ? 'Interior' : 'Unused'} vertex · ${vertex.faces.length} incident triangles`;
    getElement('uv-coordinates').textContent = mesh.uvs[selection.id].map((value, axis) => `${'uv'[axis]} ${formatCoordinate(value)}`).join('  ');
  } else {
    getElement('source-coordinates').textContent = '';
    getElement('source-selection-description').textContent = `Vertices ${mesh.faces[selection.id].join(', ')}`;
    getElement('uv-coordinates').textContent = mesh.faces[selection.id].map(id => `v${id}  u ${formatCoordinate(mesh.uvs[id][0])}  v ${formatCoordinate(mesh.uvs[id][1])}`).join('\n');
  }
}

function selectElement(nextSelection) {
  selection = nextSelection;
  viewers.forEach(viewer => viewer.setSelection(selection));
  renderSelectionOverlays();
  renderWeightInspection();
  updateGeometryControls();
}

getElement('reset-source').addEventListener('click', () => viewers[0].resetCamera());
getElement('reset-uv').addEventListener('click', () => viewers[1].resetCamera());

function updateDisplay() {
  const display = { edges: getElement('show-edges').checked, vertices: getElement('show-vertices').checked };
  viewers.forEach(viewer => viewer.setDisplay(display));
}
getElement('show-edges').addEventListener('change', updateDisplay);
getElement('show-vertices').addEventListener('change', updateDisplay);
document.addEventListener('keydown', event => {
  if (document.querySelector('dialog[open]')) return;
  const editingText = event.target.closest?.('input, textarea, select, .CodeMirror, [contenteditable="true"]');
  if ((event.ctrlKey || event.metaKey) && !editingText && event.key.toLowerCase() === 'z') {
    event.preventDefault(); applyGeometryHistory(event.shiftKey ? 'redo' : 'undo'); return;
  }
  if ((event.ctrlKey || event.metaKey) && !editingText && event.key.toLowerCase() === 'y') {
    event.preventDefault(); applyGeometryHistory('redo'); return;
  }
  if (editingText || event.ctrlKey || event.metaKey || event.altKey || meshLoadPending) return;
  if (event.key === 'Escape') {
    event.preventDefault();
    if (dragTransaction) viewers[0].cancelVertexDrag();
    else { setEditTool('select'); selectElement(null); }
    return;
  }
  if (dragTransaction || event.repeat) return;
  const key = event.key.toLowerCase();
  if (key === 'g') { event.preventDefault(); setEditTool('move'); }
  else if (editTool === 'move' && ['x', 'y', 'z'].includes(key)) {
    event.preventDefault();
    const constraint = event.shiftKey ? { x: 'yz', y: 'xz', z: 'xy' }[key] : key;
    setEditTool('move', moveConstraint === constraint ? 'gizmo' : constraint);
  }
});
document.addEventListener('viewererror', event => {
  getElement('load-error').hidden = false;
  getElement('load-error').textContent = event.detail;
});
function updateMeshDetails() {
  const topology = mesh.topology;
  getElement('boundary-shape').querySelector('[value="square"]').disabled = (topology.boundaryLoops[0]?.length || 0) < 4;
  getElement('mesh-summary').textContent = `${mesh.faces.length.toLocaleString('en-US')} triangles\n${topology.edges.length.toLocaleString('en-US')} edges\n${mesh.positions.length.toLocaleString('en-US')} vertices`;
  const badge = getElement('mesh-details');
  badge.textContent = 'Mesh details';
  badge.title = topology.ready ? 'Mesh topology and geometry statistics' : 'Mesh preparation required; open statistics for details';
  badge.dataset.ready = topology.ready;
  getElement('uv-view').querySelector('.axis-label').textContent = mesh.uvKind === 'projection'
    ? `UV / ${mesh.projectionAxes.map(axis => 'XYZ'[axis]).join('')} PROJECTION · NOT SOLVED`
    : 'UV / REFERENCE LAYOUT · NOT SOLVED';
  getElement('topology-status').textContent = topology.ready
    ? 'The mesh satisfies the disk topology and geometry checks for the parameterization solver.'
    : 'The mesh can be inspected, but the following issues must be addressed before parameterization.';
  const stats = [
    ['Mesh', mesh.name], ['Vertices / Edges / Triangles', `${mesh.positions.length} / ${topology.edges.length} / ${mesh.faces.length}`],
    ['Connected components', topology.components], ['Boundary loops', topology.boundaryLoops.length],
    ['Euler characteristic', topology.eulerCharacteristic], ['Manifold', topology.manifold ? 'Yes' : 'No'],
    ['Orientable', topology.manifold ? topology.orientable ? 'Yes' : 'No' : 'Not applicable'],
    ['Consistent face winding', topology.inconsistentEdges.length ? 'No' : 'Yes'],
    ['Degenerate triangles', topology.degenerateFaces.length],
  ];
  if (mesh.importInfo) stats.push(['OBJ polygons / Triangulated polygons', `${mesh.importInfo.polygonCount} / ${mesh.importInfo.triangulatedPolygons}`]);
  const statsElement = getElement('topology-stats'); statsElement.replaceChildren();
  for (const [label, value] of stats) {
    const term = document.createElement('dt'), description = document.createElement('dd');
    term.textContent = label; description.textContent = value; statsElement.append(term, description);
  }
  const issues = getElement('topology-issues'); issues.replaceChildren();
  for (const issue of [...topology.issues, ...(mesh.importInfo?.warnings || [])]) {
    const item = document.createElement('li'); item.textContent = issue; issues.append(item);
  }
  if (mesh.exampleDescription) {
    const item = document.createElement('li'); item.textContent = mesh.exampleDescription; issues.append(item);
  }
}

function loadMesh(nextMesh) {
  if (dragTransaction) return;
  calculationId++;
  solver.cancel();
  weightRunner.cancel();
  evaluatedCache = null;
  displayedWeightRows = new Map();
  displayedSolution = null;
  meshId++;
  mesh = nextMesh;
  if ((mesh.topology.boundaryLoops[0]?.length || 0) < 4) getElement('boundary-shape').value = 'circular';
  boundaryState = null;
  geometryHistory = new GeometryHistory();
  editTool = 'select';
  geometryFeedback('');
  viewers.forEach(viewer => viewer.setMesh(mesh));
  updateDisplay();
  updateMeshDetails();
  updateAnalysis();
  selectElement({ type: 'vertex', id: 0 });
  getElement('load-error').hidden = true;
  requestParameterization();
}

getElement('import-obj').addEventListener('click', () => getElement('obj-file').click());
getElement('obj-file').addEventListener('change', async event => {
  const file = event.target.files[0];
  if (!file || meshLoadPending || dragTransaction) return;
  meshLoadPending = true;
  updateGeometryControls();
  try {
    const source = parseOBJ(await file.text(), file.name);
    const nextMesh = prepareMesh(structuredClone(source));
    importedModel = source;
    let option = getElement('mesh-example').querySelector('[value="imported"]');
    if (!option) { option = new Option(file.name, 'imported'); getElement('mesh-example').append(option); }
    option.textContent = file.name;
    getElement('mesh-example').value = loadedModel = 'imported';
    loadMesh(nextMesh);
    if (!mesh.topology.ready || mesh.importInfo.warnings.length) getElement('topology-dialog').showModal();
  } catch (error) {
    getElement('import-error-message').textContent = error.message;
    getElement('import-error-dialog').showModal();
  } finally {
    event.target.value = '';
    meshLoadPending = false;
    updateGeometryControls();
  }
});
getElement('mesh-example').addEventListener('change', async () => {
  if (meshLoadPending || dragTransaction) return;
  const id = getElement('mesh-example').value;
  meshLoadPending = true;
  setEditTool('select');
  updateGeometryControls();
  try {
    const source = id === 'curved' ? createExampleMesh() : id === 'planar' ? createPlanarExampleMesh()
      : id === 'imported' ? structuredClone(importedModel) : await loadOBJExample(id, parseOBJ);
    const nextMesh = prepareMesh(source);
    if (nextMesh.example) getElement('show-vertices').checked = false;
    loadMesh(nextMesh);
    loadedModel = id;
  } catch (error) {
    getElement('mesh-example').value = loadedModel;
    getElement('import-error-message').textContent = error.message;
    getElement('import-error-dialog').showModal();
  } finally { meshLoadPending = false; updateGeometryControls(); }
});
getElement('mesh-details').addEventListener('click', () => getElement('topology-dialog').showModal());
getElement('close-details').addEventListener('click', () => getElement('topology-dialog').close());
getElement('solver-details').addEventListener('click', () => {
  renderSolverDetails();
  getElement('solver-dialog').showModal();
});
getElement('close-solver-details').addEventListener('click', () => getElement('solver-dialog').close());
getElement('interface-details').addEventListener('click', () => getElement('interface-dialog').showModal());
getElement('close-interface-details').addEventListener('click', () => getElement('interface-dialog').close());
updateMeshDetails();
selectElement(selection);

function setSolverFeedback(message, state) {
  lastSolverMessage = { message, state };
  const feedback = getElement('solver-feedback');
  feedback.dataset.state = state;
  feedback.textContent = message;
  feedback.hidden = !['error', 'blocked'].includes(state);
  if (getElement('solver-dialog').open) renderSolverDetails();
  if (state === 'pending') getElement('uv-view').querySelector('.axis-label').textContent = `${getMethodName(activeProgram.method)} · Solving…`;
}

function renderSolverDetails() {
  const solution = displayedSolution;
  const method = solution?.method || activeProgram.method;
  getElement('method-formula').textContent = weightMethods[method]?.formula || 'Custom computeWeights(ring)';
  const stats = getElement('solver-detail-stats');
  stats.replaceChildren();
  stats.hidden = !solution;
  if (!solution) {
    getElement('solver-detail-status').textContent = lastSolverMessage?.state === 'pending' ? 'Computing parameterization…'
      : !mesh.topology.ready ? 'Mesh preparation required before solving.' : 'No solution available yet.';
    return;
  }
  const state = solution.meshId !== meshId ? 'Previous geometry · ' : lastSolverMessage?.state === 'error' ? 'Last valid solution · ' : lastSolverMessage?.state === 'pending' ? 'Last solved · ' : '';
  getElement('solver-detail-status').textContent = `${state}${getMethodName(method)} · ${solution.shape === 'square' ? 'Square' : 'Circular'} · ${solution.spacing === 'uniform' ? 'Uniform' : 'Arc length'}`;
  const entries = [
    ['System', `${solution.interiorVertices.toLocaleString('en-US')} unknowns · ${solution.nonzeros.toLocaleString('en-US')} nonzeros`],
    ['Max relative residual', Math.max(...solution.residuals).toExponential(2)],
    ['Solve time', `${solution.elapsedMs.toFixed(1)} ms`],
    ['LU factorization', solution.interiorVertices === 0 ? 'Not needed' : solution.factorizationReused ? 'Reused' : `${solution.factorMs.toFixed(1)} ms`],
  ];
  for (const [name, value] of entries) {
    const term = document.createElement('dt'), description = document.createElement('dd');
    term.textContent = name; description.textContent = value; stats.append(term, description);
  }
}

function updateSolutionLabel() {
  const axisLabel = getElement('uv-view').querySelector('.axis-label');
  if (displayedSolution) {
    const name = getMethodName(displayedSolution.method);
    const stale = displayedSolution.meshId !== meshId;
    axisLabel.textContent = `${name} · ${stale ? 'Previous geometry' : `Solved in ${displayedSolution.elapsedMs.toFixed(1)} ms`}`;
  } else {
    axisLabel.textContent = mesh.uvKind === 'projection' ? `UV / ${mesh.projectionAxes.map(axis => 'XYZ'[axis]).join('')} PROJECTION · NOT SOLVED` : 'UV / REFERENCE LAYOUT · NOT SOLVED';
  }
  updateAnalysis();
}

function applyVisualization() {
  const mode = getElement('surface-mode').value;
  const size = Math.max(PATTERN_CELLS.min, Math.min(PATTERN_CELLS.max, Number(getElement('checker-size').value) || PATTERN_CELLS.default));
  viewers.forEach(viewer => viewer.setVisualization(mode, analysisSnapshot, size));
  distortionLegends.forEach(update => update(mode, analysisSnapshot));
  getElement('checker-size-label').hidden = !['checker', 'grid'].includes(mode);
  getElement('pattern-size-label-text').textContent = mode === 'grid' ? 'Grid cells' : 'Checker cells';
}

function updateAnalysis() {
  analysisSnapshot = displayedSolution?.meshId === meshId && mesh.topology.ready && !dragTransaction ? analyzeParameterization(mesh) : null;
  applyVisualization(); renderSelectionOverlays();
}

getElement('surface-mode').addEventListener('change', applyVisualization);
getElement('checker-size').addEventListener('input', applyVisualization);

async function requestParameterization() {
  if (dragTransaction) return;
  const currentCalculation = ++calculationId;
  const program = { ...activeProgram };
  const method = program.method;
  const spacing = getElement('boundary-spacing').value;
  const shape = getElement('boundary-shape').value;
  solver.rejectPending('Superseded by a newer calculation.');
  weightRunner.cancel('Superseded by a newer weight calculation.');
  const ready = mesh.topology.ready;
  for (const id of ['weight-method', 'boundary-shape', 'boundary-spacing']) getElement(id).disabled = !ready;
  getElement('cancel-solve').hidden = !ready;
  getElement('apply-weights').disabled = !ready;
  if (!ready) {
    solver.cancel();
    setSolverFeedback('Parameterization unavailable. Open Mesh details to review the mesh.', 'blocked');
    updateSolutionLabel();
    showEditorFeedback('This mesh requires preparation before weight evaluation. Its ring data can still be inspected.');
    return;
  }
  setSolverFeedback(`Computing ${getMethodName(method)}… ${displayedSolution ? 'The previous solution remains visible.' : 'The reference layout remains visible.'}`, 'pending');
  showEditorFeedback('Evaluating the applied function. Cancel stops evaluation or solving.');
  try {
    boundaryState = selectBoundaryState(mesh, spacing, boundaryState, false, shape);
    let weightRows;
    if (evaluatedCache?.meshId === meshId && evaluatedCache.source === program.source) weightRows = evaluatedCache.rows;
    else {
      const rings = mesh.topology.vertices.flatMap((vertex, id) => vertex.isBoundary ? [] : [createVertexRing(mesh, id)]);
      weightRows = await weightRunner.evaluate(program.source, rings);
      if (currentCalculation !== calculationId) return;
      evaluatedCache = { meshId, source: program.source, rows: weightRows, revision: ++evaluationRevision };
    }
    if (currentCalculation !== calculationId) return;
    const result = await solver.solve({ meshId, mesh: { positions: mesh.positions, faces: mesh.faces, topology: mesh.topology }, method, shape, spacing, boundary: boundaryState.vertices, programKey: `${meshId}:${evaluatedCache.revision}`, weightRows }, message => {
      if (currentCalculation === calculationId) setSolverFeedback(message, 'pending');
    });
    if (currentCalculation !== calculationId) return;
    displayedSolution = { method, shape, spacing, meshId, programKey: program.source, residuals: result.residuals, ...result.diagnostics };
    displayedWeightRows = new Map(weightRows.map(row => [row.id, row.weights]));
    mesh.uvs = result.uvs;
    viewers[1].updateUVs(mesh.uvs, selection, { edges: getElement('show-edges').checked, vertices: getElement('show-vertices').checked });
    selectElement(selection);
    updateSolutionLabel();
    const d = result.diagnostics;
    const residual = Math.max(...result.residuals).toExponential(2);
    setSolverFeedback(`${getMethodName(method)} solved · Max relative residual ${residual} · ${d.elapsedMs.toFixed(1)} ms · ${d.interiorVertices === 0 ? 'Boundary-only mesh' : d.factorizationReused ? 'LU reused' : 'New LU factorization'}${d.negativeWeights ? ` · ${d.negativeWeights} negative weights` : ''}`, 'success');
    showEditorFeedback(weightEditor.getValue() === program.source ? 'Function applied. The table shows weights used in the displayed solution.' : 'Solution updated. The editor contains newer, unapplied changes.');
  } catch (error) {
    if (currentCalculation !== calculationId) return;
    setSolverFeedback(`${error.message} ${displayedSolution ? 'The last valid solution is still displayed.' : 'No solution applied; the reference layout is still displayed.'}`, 'error');
    showEditorFeedback(error.message, true);
    updateSolutionLabel();
  } finally {
    if (currentCalculation === calculationId) getElement('cancel-solve').hidden = true;
  }
}

function getDisplayOptions() { return { edges: getElement('show-edges').checked, vertices: getElement('show-vertices').checked }; }

function geometryFeedback(message, isError = false) {
  lastGeometryMessage = { message, isError };
  const feedback = getElement('geometry-feedback');
  feedback.hidden = !isError;
  feedback.textContent = isError ? message : '';
}

function updateGeometryControls() {
  const moving = Boolean(dragTransaction);
  getElement('select-tool').setAttribute('aria-pressed', editTool === 'select');
  getElement('move-tool').setAttribute('aria-pressed', editTool === 'move');
  viewers[0]?.setEditMode(meshLoadPending ? 'select' : editTool, moveConstraint);
  const captions = { gizmo: 'Drag gizmo · X/Y/Z to constrain · G for 3D', x: 'Move · X axis · Drag gizmo', y: 'Move · Y axis · Drag gizmo', z: 'Move · Z axis · Drag gizmo', xy: 'Move · XY plane · Drag a vertex', xz: 'Move · XZ plane · Drag a vertex', yz: 'Move · YZ plane · Drag a vertex' };
  getElement('source-view').querySelector('.view-caption').textContent = editTool === 'move' ? captions[moveConstraint] : 'Drag to orbit · Scroll to zoom · Right-drag to pan';
  getElement('mesh-example').disabled = moving || meshLoadPending;
  for (const id of ['select-tool', 'move-tool', 'import-obj', 'weight-method', 'boundary-shape', 'boundary-spacing', 'apply-weights']) {
    getElement(id).disabled = moving || (meshLoadPending && ['import-obj', 'move-tool'].includes(id)) || (['weight-method', 'boundary-shape', 'boundary-spacing', 'apply-weights'].includes(id) && !mesh.topology.ready);
  }
}

function setEditTool(tool, constraint = 'gizmo') {
  if (dragTransaction || meshLoadPending && tool === 'move') return;
  editTool = tool;
  moveConstraint = constraint;
  if (tool === 'move') {
    const id = selection?.type === 'vertex' ? selection.id : selection?.type === 'face' ? mesh.faces[selection.id][0] : 0;
    selectElement({ type: 'vertex', id });
  } else updateGeometryControls();
  geometryFeedback('');
}

function invalidateGeometryCalculation() {
  calculationId++; if (solver.pending) solver.cancel(); weightRunner.cancel();
  evaluatedCache = null; displayedWeightRows = new Map();
}

function beginGeometryEdit(id) {
  if (dragTransaction || !mesh.positions[id]) return;
  invalidateGeometryCalculation();
  dragTransaction = { id, before: mesh.positions[id].slice(), beforeBoundary: structuredClone(boundaryState) };
  updateAnalysis();
  updateGeometryControls();
  geometryFeedback(`Moving vertex ${id} in model units. UVs will update on release.`);
  setSolverFeedback('Editing geometry · The previous UV layout stays visible until release.', 'pending');
  getElement('uv-view').querySelector('.axis-label').textContent = 'UV / GEOMETRY MOVING · NOT UPDATED';
}

function previewGeometryEdit(id, position) {
  if (!dragTransaction || dragTransaction.id !== id) return;
  try {
    setVertexPosition(mesh, id, position);
    viewers[0].refreshSourceGeometry(selection, getDisplayOptions());
    renderSelectionOverlays();
  } catch (error) { geometryFeedback(error.message, true); }
}

function finishGeometryEdit(id) {
  if (!dragTransaction || dragTransaction.id !== id) return;
  const transaction = dragTransaction;
  dragTransaction = null;
  commitGeometryChanges([{ id, before: transaction.before, after: mesh.positions[id].slice() }], transaction.beforeBoundary, 'Move vertex');
}

function cancelGeometryEdit() {
  if (!dragTransaction) return;
  const transaction = dragTransaction; dragTransaction = null;
  setVertexPosition(mesh, transaction.id, transaction.before);
  refreshEditedGeometry();
  geometryFeedback('Vertex move canceled.');
  requestParameterization();
}

function commitGeometryChanges(changes, beforeBoundary, label) {
  revalidateGeometry(mesh);
  const boundaryMoved = changes.some(change => mesh.topology.vertices[change.id].isBoundary);
  boundaryState = selectBoundaryState(mesh, getElement('boundary-spacing').value, boundaryState, boundaryMoved, getElement('boundary-shape').value);
  if (geometryHistory.record(changes, beforeBoundary, boundaryState, label)) meshId++;
  refreshEditedGeometry();
  if (mesh.topology.degenerateFaces.length) geometryFeedback(`Geometry retained. Degenerate triangle IDs: ${mesh.topology.degenerateFaces.slice(0, 8).join(', ')}${mesh.topology.degenerateFaces.length > 8 ? '…' : ''}. Solving is paused; use Undo or move the vertex again.`, true);
  else geometryFeedback(`${label} applied.`);
  requestParameterization();
}

function refreshEditedGeometry() {
  viewers[0].refreshSourceGeometry(selection, getDisplayOptions());
  updateMeshDetails(); selectElement(selection); updateSolutionLabel();
}

function applyGeometryHistory(direction) {
  if (dragTransaction || meshLoadPending) return;
  const available = direction === 'undo' ? geometryHistory.undoStack : geometryHistory.redoStack;
  if (!available.length) return;
  invalidateGeometryCalculation();
  const result = geometryHistory[direction](mesh);
  const spacing = getElement('boundary-spacing').value;
  const shape = getElement('boundary-shape').value;
  boundaryState = selectBoundaryState(mesh, spacing, boundaryState, true, shape);
  meshId++; refreshEditedGeometry();
  geometryFeedback(`${direction === 'undo' ? 'Undid' : 'Redid'} ${result.label.toLowerCase()}.`);
  requestParameterization();
}

getElement('select-tool').addEventListener('click', () => setEditTool('select'));
getElement('move-tool').addEventListener('click', () => setEditTool('move'));

function getMethodName(method) { return weightMethods[method]?.name || 'Custom'; }
function identifyMethod(source) { return Object.keys(weightExamples).find(method => weightExamples[method] === source) || 'custom'; }
function showEditorFeedback(message, isError = false) {
  getElement('editor-feedback').textContent = message;
  getElement('editor-feedback').dataset.error = isError;
}
function applyEditor() {
  const source = weightEditor.getValue();
  activeProgram = { source, method: identifyMethod(source) };
  getElement('weight-method').value = activeProgram.method;
  evaluatedCache = null;
  requestParameterization();
}
function loadWeightExample(method) {

  activeProgram = { method, source: weightExamples[method] };
  weightEditor.setValue(activeProgram.source);
  getElement('weight-method').value = method;
  evaluatedCache = null;
  requestParameterization();
}

function renderWeightInspection() {
  const body = getElement('weight-table-body'); body.replaceChildren();
  const caption = getElement('weight-table-caption');
  if (selection?.type !== 'vertex') {
    caption.textContent = 'Select a vertex to inspect its weights and ring data.';
    getElement('ring-data').textContent = 'Select a vertex in either view.';
    return;
  }
  let ring;
  try { ring = createVertexRing(mesh, selection.id); }
  catch (error) { caption.textContent = error.message; getElement('ring-data').textContent = error.message; return; }
  getElement('ring-data').textContent = JSON.stringify(ring, null, 2);
  const weights = displayedWeightRows.get(selection.id);
  if (!weights) {
    caption.textContent = ring.isBoundary ? 'Boundary vertex: UV coordinates are fixed, so no weight function is evaluated here. Input ring data is available.' : 'No applied weights yet for this vertex.';
    return;
  }
  const { scaled, sum } = validateWeights(ring, weights);
  caption.textContent = `Vertex ${selection.id} · ${getMethodName(displayedSolution.method)} · Weights from the displayed solution`;
  weights.forEach((weight, index) => {
    const row = document.createElement('tr'); row.dataset.negative = weight < 0;
    for (const value of [ring.neighbors[index].id, formatWeight(weight), formatWeight(scaled[index] / sum)]) {
      const cell = document.createElement('td'); cell.textContent = value; row.append(cell);
    }
    body.append(row);
  });
}
function formatWeight(value) { return value === 0 ? '0' : Math.abs(value) < 1e-4 || Math.abs(value) >= 1e5 ? value.toExponential(5) : value.toFixed(6); }

getElement('weight-method').addEventListener('change', event => {
  if (event.target.value !== 'custom') loadWeightExample(event.target.value);
  else applyEditor();
});
getElement('apply-weights').addEventListener('click', applyEditor);
// Capture before CodeMirror handles Enter; the textarea fallback shares this container.
getElement('weight-code').parentElement.addEventListener('keydown', event => {
  if (event.key !== 'Enter' || !event.ctrlKey || event.altKey || event.shiftKey || event.isComposing) return;
  event.preventDefault();
  event.stopPropagation();
  if (!event.repeat) getElement('apply-weights').click();
}, true);

for (const view of ['weights', 'ring']) {
  getElement(`show-${view}`).addEventListener('click', () => {
    getElement('weight-table-panel').hidden = view !== 'weights'; getElement('ring-data-panel').hidden = view !== 'ring';
    getElement('show-weights').setAttribute('aria-pressed', view === 'weights'); getElement('show-ring').setAttribute('aria-pressed', view === 'ring');
  });
}
getElement('boundary-spacing').addEventListener('change', requestParameterization);
getElement('boundary-shape').addEventListener('change', requestParameterization);
getElement('cancel-solve').addEventListener('click', () => { weightRunner.cancel(); solver.cancel(); });
window.addEventListener('pagehide', () => { weightRunner.cancel(); solver.cancel(); });
requestParameterization();
