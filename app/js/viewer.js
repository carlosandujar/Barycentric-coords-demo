import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { TransformControls } from 'three/addons/controls/TransformControls.js';
import { displayToModel } from './geometry-editing.js';
import { distortionColor } from './distortion.js';
import { PATTERN_CELLS, VIEW_LIMITS } from './settings.js';

const colors = { surface: 0xb1d9cb, edges: 0x527f76, points: 0x3f6d65, selection: 0xeb8b35, boundary: 0x21846e };
const UV_PATTERN_OPACITY = 0.3;

/** A view owns its camera and rendering resources; selection belongs to the app. */
export class MeshViewer {
  constructor(container, mesh, kind, onSelect, editCallbacks = {}) {
    this.container = container;
    this.mesh = mesh;
    this.kind = kind;
    this.onSelect = onSelect;
    this.editCallbacks = editCallbacks;
    this.editTool = 'select';
    this.moveConstraint = 'gizmo';
    this.selection = null;
    this.vertexDragging = false;
    this.visualizationMode = 'solid';
    this.displayOptions = { edges: true, vertices: true };
    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color(0xf6f9f9);
    this.renderer = new THREE.WebGLRenderer({ antialias: true, alpha: false });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.domElement.tabIndex = 0;
    this.renderer.domElement.setAttribute('aria-label', kind === 'source' ? 'Interactive 3D mesh. Click a vertex or triangle to select it.' : 'Interactive UV mesh. Click a vertex or triangle to select it.');
    container.append(this.renderer.domElement);
    this.camera = kind === 'source'
      ? new THREE.PerspectiveCamera(38, 1, VIEW_LIMITS.sourceNear, VIEW_LIMITS.far)
      : new THREE.OrthographicCamera(-1, 1, 1, -1, 0.01, VIEW_LIMITS.far);
    this.camera.up.set(0, 0, 1);
    if (kind === 'uv') this.camera.up.set(0, 1, 0);
    this.controls = new OrbitControls(this.camera, this.renderer.domElement);
    this.controls.enableDamping = true;
    this.controls.minDistance = VIEW_LIMITS.sourceMinDistance;
    this.controls.maxDistance = VIEW_LIMITS.sourceMaxDistance;
    this.controls.zoomToCursor = kind === 'uv';
    if (kind === 'source') this.controls.addEventListener('change', () => this.normalizeSourceZoom());
    if (kind === 'uv') {
      this.controls.enableRotate = false;
      this.controls.minZoom = VIEW_LIMITS.uvMinZoom;
      this.controls.maxZoom = VIEW_LIMITS.uvMaxZoom;
      this.controls.mouseButtons.LEFT = THREE.MOUSE.PAN;
      this.controls.touches.ONE = THREE.TOUCH.PAN;
    }
    this.scene.add(new THREE.HemisphereLight(0xffffff, 0x78918a, 2.3));
    const light = new THREE.DirectionalLight(0xffffff, 2);
    light.position.set(-2, -3, 5);
    this.scene.add(light);
    this.coordinates = kind === 'source' ? mesh.displayPositions : mesh.uvs.map(([u, v]) => [u * 2 - 1, v * 2 - 1, 0]);
    this.meshGroup = new THREE.Group();
    this.checkerTexture = new THREE.DataTexture(new Uint8Array([236, 244, 240, 255, 38, 99, 91, 255, 38, 99, 91, 255, 236, 244, 240, 255]), 2, 2);
    this.checkerTexture.wrapS = this.checkerTexture.wrapT = THREE.RepeatWrapping;
    this.checkerTexture.magFilter = THREE.NearestFilter;
    this.checkerTexture.colorSpace = THREE.SRGBColorSpace;
    this.checkerTexture.needsUpdate = true;
    this.scene.add(this.meshGroup);
    this.buildMesh();
    this.resetCamera();
    this.raycaster = new THREE.Raycaster();
    if (kind === 'source') this.initializeEditing();
    this.resizeObserver = new ResizeObserver(() => this.resize());
    this.resizeObserver.observe(container);
    this.bindPicking();
    this.contextLost = event => {
      event.preventDefault();
      this.container.dispatchEvent(new CustomEvent('viewererror', { bubbles: true, detail: 'The graphics context was lost. Reload the page to restore the viewers.' }));
    };
    this.renderer.domElement.addEventListener('webglcontextlost', this.contextLost);
    this.renderer.setAnimationLoop(() => {
      this.controls.update();
      this.renderer.render(this.scene, this.camera);
    });
  }

  buildMesh() {
    const vertices = this.coordinates.flat();
    this.geometry = new THREE.BufferGeometry();
    this.geometry.setAttribute('position', new THREE.Float32BufferAttribute(vertices, 3));
    this.geometry.setIndex(this.mesh.faces.flat());
    this.geometry.computeVertexNormals();
    const material = this.createSurfaceMaterial();
    this.surface = new THREE.Mesh(this.geometry.toNonIndexed(), material);
    this.meshGroup.add(this.surface);
    this.edges = new THREE.LineSegments(new THREE.WireframeGeometry(this.geometry), new THREE.LineBasicMaterial({ color: colors.edges, transparent: true, opacity: 0.65 }));
    this.meshGroup.add(this.edges);
    const pointMaterial = new THREE.PointsMaterial({ color: colors.points, size: 5, sizeAttenuation: false });
    this.points = new THREE.Points(this.geometry, pointMaterial);
    this.meshGroup.add(this.points);
    const boundaryPoints = this.mesh.topology.boundaryEdges.flatMap(edge => edge.map(id => new THREE.Vector3(...this.coordinates[id])));
    this.boundaryLine = new THREE.LineSegments(new THREE.BufferGeometry().setFromPoints(boundaryPoints), new THREE.LineBasicMaterial({ color: colors.boundary }));
    this.meshGroup.add(this.boundaryLine);
    // Draw UV topology after transparent patterns so edges and vertices stay crisp.
    if (this.kind === 'uv') {
      for (const object of [this.edges, this.points, this.boundaryLine]) {
        object.material.transparent = true;
        object.renderOrder = 1;
      }
    }
    this.selectionGeometry = new THREE.BufferGeometry();
    this.selectionGeometry.setAttribute('position', new THREE.Float32BufferAttribute([0, 0, 0], 3));
    this.selectedPoint = new THREE.Points(this.selectionGeometry, new THREE.PointsMaterial({ color: colors.selection, size: 14, sizeAttenuation: false, depthTest: false }));
    this.selectedPoint.renderOrder = 5;
    this.meshGroup.add(this.selectedPoint);
    this.selectedFace = new THREE.Mesh(new THREE.BufferGeometry(), new THREE.MeshBasicMaterial({ color: colors.selection, transparent: true, opacity: 0.65, side: THREE.DoubleSide, depthTest: false }));
    this.selectedFace.renderOrder = 4;
    this.meshGroup.add(this.selectedFace);
    this.selectedPoint.visible = false;
    this.selectedFace.visible = false;
    const grid = new THREE.GridHelper(3.6, 18, 0xcbd9d8, 0xe5ecec);
    grid.rotation.x = Math.PI / 2;
    grid.position.z = this.kind === 'source' ? -1.1 : -0.02;
    this.meshGroup.add(grid);
    this.resize();
  }

  createSurfaceMaterial() {
    const options = { side: THREE.DoubleSide, polygonOffset: true, polygonOffsetFactor: 1, polygonOffsetUnits: 1 };
    return this.kind === 'source'
      ? new THREE.MeshStandardMaterial({ ...options, color: colors.surface, roughness: 0.85, metalness: 0 })
      : new THREE.MeshBasicMaterial({ ...options, color: 0xd9eee5 });
  }

  createGridMaterial() {
    const material = new THREE.ShaderMaterial({
      side: THREE.DoubleSide, polygonOffset: true, polygonOffsetFactor: 1, polygonOffsetUnits: 1,
      uniforms: { cells: { value: PATTERN_CELLS.default }, lineColor: { value: new THREE.Color('#071b38') }, opacity: { value: 1 } },
      vertexShader: `varying vec2 gridUV;
        void main() {
          gridUV = uv;
          gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
        }`,
      fragmentShader: `uniform float cells;
        uniform float opacity;
        uniform vec3 lineColor;
        varying vec2 gridUV;
        void main() {
          vec2 coordinate = gridUV * cells;
          vec2 distanceToLine = abs(fract(coordinate + 0.5) - 0.5);
          vec2 pixelDistance = distanceToLine / max(fwidth(coordinate), vec2(0.000001));
          float line = 1.0 - smoothstep(0.55, 1.25, min(pixelDistance.x, pixelDistance.y));
          gl_FragColor = vec4(mix(vec3(1.0), lineColor, line), opacity);
          #include <colorspace_fragment>
        }`,
    });
    material.userData.uvGrid = true;
    return material;
  }

  setMesh(mesh) {
    this.clearMesh();
    this.mesh = mesh;
    this.coordinates = this.kind === 'source' ? mesh.displayPositions : mesh.uvs.map(([u, v]) => [u * 2 - 1, v * 2 - 1, 0]);
    this.buildMesh();
    this.resetCamera();
  }

  updateUVs(uvs, selection, display) {
    if (this.kind !== 'uv') return;
    this.mesh.uvs = uvs;
    this.coordinates = uvs.map(([u, v]) => [u * 2 - 1, v * 2 - 1, 0]);
    this.clearMesh();
    this.buildMesh();
    this.setDisplay(display);
    this.setSelection(selection);
  }

  refreshSourceGeometry(selection, display) {
    if (this.kind !== 'source') return;
    this.coordinates = this.mesh.displayPositions;
    this.clearMesh(); this.buildMesh();
    this.setDisplay(display); this.setSelection(selection);
    const ids = this.mesh.topology.degenerateFaces;
    if (ids.length) {
      const positions = ids.flatMap(id => {
        const face = this.mesh.faces[id];
        return face.flatMap((vertex, i) => [...this.coordinates[vertex], ...this.coordinates[face[(i + 1) % 3]]]);
      });
      const geometry = new THREE.BufferGeometry();
      geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
      const overlay = new THREE.LineSegments(geometry, new THREE.LineBasicMaterial({ color: 0xd64735, depthTest: false }));
      overlay.renderOrder = 6; this.meshGroup.add(overlay);
    }
  }

  initializeEditing() {
    this.editAnchor = new THREE.Object3D(); this.scene.add(this.editAnchor);
    this.transform = new TransformControls(this.camera, this.renderer.domElement);
    this.transform.setMode('translate'); this.transform.setSpace('world'); this.transform.setSize(1.2);
    this.scene.add(this.transform.getHelper());
    this.transform.enabled = false;
    this.transform.addEventListener('mouseDown', () => this.beginVertexDrag(this.selection?.id));
    this.transform.addEventListener('objectChange', () => {
      if (this.vertexDragging) this.editCallbacks.onMove?.(this.dragVertexId, displayToModel(this.mesh, this.editAnchor.position.toArray()));
    });
    this.transform.addEventListener('mouseUp', () => this.endVertexDrag());
    const canvas = this.renderer.domElement;
    canvas.addEventListener('pointerup', () => { if (!this.vertexDragging) this.controls.enabled = true; });
    canvas.addEventListener('pointerdown', event => {
      if (event.button !== 0 || !event.isPrimary || this.editTool !== 'move') return;
      if (['gizmo', 'x', 'y', 'z'].includes(this.moveConstraint)) {
        if (this.transform.axis) this.controls.enabled = false;
        return;
      }
      this.setPointerRay(event);
      if (!this.raycaster.intersectObject(this.surface).length) return;
      const id = this.findVertexAt(event);
      if (id === null) return;
      this.onSelect({ type: 'vertex', id });
      const normals = { xy: [0, 0, 1], xz: [0, 1, 0], yz: [1, 0, 0], mesh: this.meshPlane };
      const normal = normals[this.moveConstraint];
      if (!normal) return;
      const point = new THREE.Vector3(...this.coordinates[id]);
      this.dragPlane = new THREE.Plane().setFromNormalAndCoplanarPoint(new THREE.Vector3(...normal), point);
      this.setPointerRay(event);
      const hit = this.raycaster.ray.intersectPlane(this.dragPlane, new THREE.Vector3());
      if (!hit) return;
      this.dragOffset = hit.sub(point); this.planePointerId = event.pointerId;
      this.beginVertexDrag(id); canvas.setPointerCapture(event.pointerId);
      event.preventDefault(); event.stopImmediatePropagation();
    }, true);
    canvas.addEventListener('pointermove', event => {
      if (this.planePointerId !== event.pointerId || !this.vertexDragging) return;
      this.setPointerRay(event);
      const hit = this.raycaster.ray.intersectPlane(this.dragPlane, new THREE.Vector3());
      if (hit) this.editCallbacks.onMove?.(this.dragVertexId, displayToModel(this.mesh, hit.sub(this.dragOffset).toArray()));
      event.preventDefault(); event.stopImmediatePropagation();
    }, true);
    canvas.addEventListener('pointerup', event => {
      if (this.planePointerId !== event.pointerId) return;
      this.planePointerId = null;
      if (canvas.hasPointerCapture(event.pointerId)) canvas.releasePointerCapture(event.pointerId);
      this.endVertexDrag(); event.stopImmediatePropagation();
    }, true);
    canvas.addEventListener('pointercancel', () => this.cancelVertexDrag());
  }

  cancelVertexDrag() {
    if (!this.vertexDragging) return;
    this.transform.reset(); this.transform.dragging = false;
    const id = this.dragVertexId, pointer = this.planePointerId;
    this.vertexDragging = false; this.planePointerId = null; this.controls.enabled = true;
    const canvas = this.renderer.domElement;
    if (pointer !== null && pointer !== undefined && canvas.hasPointerCapture(pointer)) canvas.releasePointerCapture(pointer);
    this.editCallbacks.onCancel?.(id); this.syncManipulator();
    setTimeout(() => { this.wasTransforming = false; }, 0);
  }

  beginVertexDrag(id) {
    if (this.vertexDragging || id === undefined) return;
    this.vertexDragging = true; this.wasTransforming = true; this.dragVertexId = id;
    this.controls.enabled = false; this.editCallbacks.onBegin?.(id);
  }

  endVertexDrag() {
    if (!this.vertexDragging) return;
    const id = this.dragVertexId;
    this.vertexDragging = false; this.controls.enabled = true;
    this.editCallbacks.onEnd?.(id); this.syncManipulator();
    setTimeout(() => { this.wasTransforming = false; }, 0);
  }

  setEditMode(tool, constraint = 'gizmo', meshPlane = null) {
    this.editTool = tool; this.moveConstraint = constraint; this.meshPlane = meshPlane;
    this.syncManipulator();
  }

  syncManipulator() {
    if (!this.transform || this.vertexDragging) return;
    for (const axis of ['x', 'y', 'z']) this.transform[`show${axis.toUpperCase()}`] = this.moveConstraint === 'gizmo' || this.moveConstraint === axis;
    if (this.editTool === 'move' && this.selection?.type === 'vertex') {
      this.editAnchor.position.set(...this.coordinates[this.selection.id]);
      if (['gizmo', 'x', 'y', 'z'].includes(this.moveConstraint)) { this.transform.attach(this.editAnchor); this.transform.enabled = true; }
      else { this.transform.detach(); this.transform.enabled = false; }
    } else { this.transform.detach(); this.transform.enabled = false; }
  }

  setPointerRay(event) {
    const bounds = this.renderer.domElement.getBoundingClientRect();
    this.camera.updateMatrixWorld();
    this.raycaster.setFromCamera(new THREE.Vector2((event.clientX - bounds.left) / bounds.width * 2 - 1, -(event.clientY - bounds.top) / bounds.height * 2 + 1), this.camera);
  }

  findVertexAt(event) {
    const bounds = this.renderer.domElement.getBoundingClientRect();
    let nearest = null, distance = 8;
    this.camera.updateMatrixWorld();
    this.coordinates.forEach((position, id) => {
      const world = new THREE.Vector3(...position), projected = world.clone().project(this.camera);
      if (projected.z < -1 || projected.z > 1) return;
      const candidate = Math.hypot((projected.x + 1) * bounds.width / 2 + bounds.left - event.clientX, (1 - projected.y) * bounds.height / 2 + bounds.top - event.clientY);
      if (candidate >= distance) return;
      this.raycaster.setFromCamera(new THREE.Vector2(projected.x, projected.y), this.camera);
      const hit = this.raycaster.intersectObject(this.surface)[0];
      if (hit && hit.distance + 0.005 < world.distanceTo(this.raycaster.ray.origin)) return;
      nearest = id; distance = candidate;
    });
    return nearest;
  }

  clearMesh() {
    const geometries = new Set();
    const materials = new Set();
    this.meshGroup.traverse(object => {
      if (object.geometry) geometries.add(object.geometry);
      if (object.material) materials.add(object.material);
    });
    geometries.forEach(geometry => geometry.dispose());
    materials.forEach(material => material.dispose());
    this.meshGroup.clear();
  }

  resetCamera() {
    this.sourceOrbitDistance = null;
    this.controls.reset();
    this.controls.target.set(0, 0, 0);
    this.camera.position.set(...(this.kind === 'source' ? this.mesh.viewPreset?.position || [2.6, -3.6, 3.4] : [0, 0, 5]));
    this.camera.zoom = 1;
    this.controls.panSpeed = 1;
    if (this.kind === 'source') this.sourceOrbitDistance = this.camera.position.distanceTo(this.controls.target);
    this.camera.updateProjectionMatrix();
    this.controls.update();
  }

  /** Convert perspective dolly gestures to optical zoom, keeping the camera outside the surface. */
  normalizeSourceZoom() {
    if (!this.sourceOrbitDistance) return;
    const distance = this.camera.position.distanceTo(this.controls.target);
    if (!(distance > 0) || Math.abs(distance - this.sourceOrbitDistance) < 1e-9) return;
    this.camera.zoom = THREE.MathUtils.clamp(this.camera.zoom * this.sourceOrbitDistance / distance, VIEW_LIMITS.sourceMinZoom, VIEW_LIMITS.sourceMaxZoom);
    this.camera.position.sub(this.controls.target).setLength(this.sourceOrbitDistance).add(this.controls.target);
    this.controls.panSpeed = 1 / this.camera.zoom;
    this.camera.updateProjectionMatrix();
    this.camera.updateMatrixWorld();
  }

  resize() {
    const width = Math.max(1, this.container.clientWidth);
    const height = Math.max(1, this.container.clientHeight);
    this.renderer.setSize(width, height, false);
    const aspect = width / height;
    if (this.kind === 'source') this.camera.aspect = aspect;
    else {
      const halfHeight = 1.42 * Math.max(1, 1 / aspect);
      this.camera.left = -halfHeight * aspect;
      this.camera.right = halfHeight * aspect;
      this.camera.top = halfHeight;
      this.camera.bottom = -halfHeight;
    }
    this.camera.updateProjectionMatrix();
  }

  setSelection(selection) {
    this.selection = selection;
    this.syncManipulator();
    this.selectedPoint.visible = selection?.type === 'vertex';
    this.selectedFace.visible = selection?.type === 'face';
    if (!selection) return;
    if (selection.type === 'vertex') {
      this.selectionGeometry.attributes.position.setXYZ(0, ...this.coordinates[selection.id]);
      this.selectionGeometry.attributes.position.needsUpdate = true;
      this.selectionGeometry.computeBoundingSphere();
    } else {
      this.selectedFace.geometry.dispose();
      this.selectedFace.geometry = new THREE.BufferGeometry();
      this.selectedFace.geometry.setAttribute('position', new THREE.Float32BufferAttribute(this.mesh.faces[selection.id].flatMap(id => this.coordinates[id]), 3));
    }
  }

  bindPicking() {
    const canvas = this.renderer.domElement;
    let start = null;
    let moved = false;
    canvas.addEventListener('pointerdown', event => {
      if (this.vertexDragging || this.kind === 'source' && this.editTool === 'move' && this.transform?.axis) { start = null; return; }
      if (event.button === 0 && event.isPrimary) { start = [event.clientX, event.clientY, event.pointerId]; moved = false; }
      else { start = null; }
    });
    canvas.addEventListener('pointermove', event => {
      if (start && Math.hypot(event.clientX - start[0], event.clientY - start[1]) > 5) moved = true;
    });
    canvas.addEventListener('pointercancel', () => { start = null; });
    canvas.addEventListener('pointerup', event => {
      if (this.wasTransforming || this.vertexDragging) { start = null; return; }
      const click = start && start[2] === event.pointerId && !moved;
      start = null;
      if (!click) return;
      this.setPointerRay(event);
      const hit = this.raycaster.intersectObject(this.surface)[0];
      if (!hit) {
        this.onSelect(null);
        return;
      }
      // Visible vertices within eight CSS pixels take priority over the surface.
      const vertexId = this.findVertexAt(event);
      this.onSelect(vertexId !== null ? { type: 'vertex', id: vertexId } : { type: 'face', id: hit.faceIndex });
    });
  }

  setDisplay({ edges, vertices }) {
    this.displayOptions = { edges, vertices };
    const showTopology = this.kind === 'uv' || this.visualizationMode !== 'grid';
    this.edges.visible = edges && showTopology;
    this.boundaryLine.visible = edges && showTopology;
    this.points.visible = vertices && showTopology;
  }

  setVisualization(mode, analysis, patternCells = PATTERN_CELLS.default) {
    const geometry = this.surface.geometry;
    const active = analysis ? mode : 'solid';
    this.visualizationMode = active;
    this.setDisplay(this.displayOptions);
    if (Boolean(this.surface.material.userData.uvGrid) !== (active === 'grid')) {
      this.surface.material.dispose();
      this.surface.material = active === 'grid' ? this.createGridMaterial() : this.createSurfaceMaterial();
    }
    const material = this.surface.material;
    const transparentPattern = this.kind === 'uv' && ['grid', 'checker'].includes(active);
    material.opacity = transparentPattern ? UV_PATTERN_OPACITY : 1;
    material.transparent = transparentPattern;
    material.depthWrite = !transparentPattern;
    material.needsUpdate = true;
    if (active === 'grid') {
      geometry.setAttribute('uv', new THREE.Float32BufferAttribute(this.mesh.faces.flatMap(face => face.flatMap(id => this.mesh.uvs[id])), 2));
      material.uniforms.cells.value = patternCells;
      material.uniforms.opacity.value = material.opacity;
      return;
    }
    const colorsByFace = analysis && ['angle', 'area', 'inversions'].includes(active);
    material.vertexColors = Boolean(colorsByFace);
    material.map = active === 'checker' ? this.checkerTexture : null;
    material.color.set(colorsByFace || active === 'checker' ? 0xffffff : this.kind === 'source' ? colors.surface : 0xd9eee5);
    if (colorsByFace) {
      geometry.setAttribute('color', new THREE.Float32BufferAttribute(analysis.faces.flatMap(face => {
        const color = distortionColor(face, active); return [...color, ...color, ...color];
      }), 3));
    } else geometry.deleteAttribute('color');
    if (active === 'checker') {
      geometry.setAttribute('uv', new THREE.Float32BufferAttribute(this.mesh.faces.flatMap(face => face.flatMap(id => this.mesh.uvs[id])), 2));
      this.checkerTexture.repeat.set(patternCells / 2, patternCells / 2);
    }
    material.needsUpdate = true;
  }

  dispose() {
    this.renderer.setAnimationLoop(null);
    this.resizeObserver.disconnect();
    this.controls.dispose();
    this.transform?.dispose();
    const geometries = new Set();
    this.scene.traverse(object => {
      if (object.geometry) geometries.add(object.geometry);
      if (object.material) object.material.dispose();
    });
    geometries.forEach(geometry => geometry.dispose());
    this.renderer.dispose();
    this.checkerTexture.dispose();
    this.renderer.domElement.remove();
  }
}
