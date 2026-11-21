# Technical and implementation details

Barycentric weights demo is a static, buildless mesh parameterization laboratory. This document covers its architecture, numerical methods, data contracts, development checks, and deployment. For a student-oriented introduction, see [README.md](../README.md). The interface, source comments, and function names use US English.

## Run locally

From the repository root, with Node.js 20 or newer:

```sh
npm start
```

Open http://127.0.0.1:4173. No installation or build is required. Three.js 0.170.0 and OrbitControls load from jsDelivr, so an internet connection is needed. Any static HTTP host can serve the application. Opening index.html directly with file:// is not supported.

## Deploy to GitHub Pages

The workflow in `.github/workflows/pages.yml` publishes the static app on pushes to `main` that change website assets or the workflow. It can also be started manually with **Actions → Deploy to GitHub Pages → Run workflow**, selecting `main`.

1. In the GitHub repository, open **Settings → Pages**.
2. Under **Build and deployment**, set **Source** to **GitHub Actions**.
3. Push the project and workflow to `main`, or run the workflow manually.
4. Open the deployed URL shown in the workflow's `github-pages` environment.

No build step, npm installation, personal access token, or repository-specific URL configuration is required. The app uses relative URLs for modules, workers, OBJ models, and images, so it can run under a repository subpath. CDN dependencies still require internet access.

The workflow copies the contents of `app/` into the deployment artifact, with `LICENSE` added at its root. The published URL opens the application directly, without an `/app/` suffix. Documentation, its illustrations and GIF, development dependencies, tests, scripts, model source downloads, and raw GIF frames are excluded. `_site/` and `.demo-frames/` are ignored by Git.

## Viewing and mesh representation

- Independent 3D and orthographic UV cameras.
- A deterministic curved disk: 37 vertices and 60 triangles.
- Automatic linked vertex and triangle selection, with stable zero-based identifiers.
- Selection overlays with original coordinates in Triangle mesh and UV coordinates in Parameterization.
- Mouse and keyboard resizing of the viewer split and inspector.
- Edge and vertex display controls and independent camera resets.
- Stacked views on narrow screens.

## OBJ import and topology

- Local OBJ import, including triangles, convex polygons, and simple concave polygons.
- Ear-clipping triangulation preserves polygon winding and retains the source OBJ polygon and line for each triangle.
- Positive and negative position indices, slash-separated face references, comments, and line continuations.
- Texture and normal references never split position indices. Materials and OBJ texture coordinates are ignored. Coincident positions are not welded.
- Original model coordinates and an independent original-position snapshot are preserved. Only display coordinates are normalized.
- Edge and face incidence, ordered vertex one-rings, connected components, and ordered boundary loops.
- Checks for disk topology, orientability, inconsistent winding, nonmanifold edges and vertices, duplicate triangles, unused positions, and degenerate triangles.
- Diagnostics explain preparation requirements. Closed or invalid-topology meshes remain viewable. Invalid syntax or polygons that cannot be triangulated keep the previous mesh unchanged.
- Replacing a mesh reuses both WebGL contexts and disposes the old geometry.

Before a solution is available, imported meshes use a projection onto their two largest bounding-box axes in the UV view, explicitly labeled as a projection rather than a solved parameterization. The built-in example initially uses its predefined UV layout.

## Parameterization solver

- Uniform / Tutte, Mean Value, Cotangent / Harmonic, and Inverse Distance weights.
- Circular or Square boundary with uniform or 3D arc-length spacing. Circular is centered at (0.5, 0.5), with radius 0.5; Square uses the unit square with counterclockwise orientation.
- Automatic solving for every valid disk, on import and when the method or boundary spacing changes.
- Sparse LU with math.js 14.8.1, loaded from jsDelivr inside a module Worker. Both U and V use one factorization. The application remains static and buildless.
- A cached factorization is reused when only boundary spacing changes. A mesh, program, or evaluated-weight revision change requires a new factorization. Cancel terminates the solver Worker and discards its cache; the next request recreates it.
- Worker request IDs suppress obsolete results. A 30-second limit terminates stalled calculations. Change a dropdown or use Apply in the function editor to retry after a CDN loading failure.
- Solver details shows interior unknowns, matrix nonzeros, the maximum relative residual across U and V, solve time, and LU factorization time or reuse. Counts of negative and zero directed weights and the individual U/V residuals are calculated internally. The previous valid UV solution remains visible on failure or cancellation; its displayed method and boundary settings remain labeled.
- Meshes failing the topology and geometry checks remain inspectable, with solving disabled.

The operator uses one equation per interior vertex: sum_j w_ij (UV_i - UV_j) = 0. Boundary vertices are eliminated from the unknowns. Each row is scaled by its largest absolute weight for numerical stability, without changing its solution. A row with all-zero weights or a nearly canceling sum is rejected with the vertex ID. Negative weights are not clamped and symmetry is not assumed.

The solver calls `math.slu(A, 2, 1)` on a sparse matrix assembled directly from its nonzeros, then `math.lusolve(factorization, rhs)` for each coordinate. It never constructs a dense n-by-n matrix or an explicit inverse. The acceptance threshold is 1e-8 for the infinity-norm relative residual ||Ax-b|| / ||b||; a zero right-hand side uses ||A|| ||x|| as the denominator, with a zero-system fallback. Residuals check the equations, not conditioning or injectivity. Separate diagnostics report inversions and distortion.

## Weight function editor and evaluation

- A JavaScript function editor with pinned CodeMirror 5.65.16 syntax highlighting and line numbers. If its CDN is unavailable, the plain-text editor remains usable.
- Selecting a built-in method loads its standalone `computeWeights(ring)` implementation. All four examples and all custom functions use the same evaluator.
- Editing marks the program Custom and shows Unapplied changes. Apply evaluates the draft; Ctrl+Enter inside the code editor triggers the same button, including in the plain-text fallback. Changing the boundary uses the last applied program rather than an unfinished draft. Choosing Custom in Weights opens the editor and applies its current draft. Selecting a built-in method in Weights reloads and applies its example.
- The UV display and local weight table change only after successful evaluation and solving. Errors preserve the last valid solution and its table. The editor reports compilation errors, the failing vertex/neighbor, invalid return lengths, and nonfinite weights.
- Input ring data shows the complete object for the selected vertex. Applied weights shows its raw and normalized weights from the displayed solution. Boundary vertices show ring data but have no evaluated weights because their UVs are fixed.
- The evaluator runs in a disposable blob Worker created by an opaque-origin sandboxed iframe. Its content security policy blocks network access. User code does not run in the UI or numerical solver Worker. Copies of ring inputs are deeply frozen; the trusted application validates all returned rows again before passing numeric weights to the solver.
- A three-second evaluation limit and Cancel stop loops. Each evaluation uses a fresh Worker, so program state is not retained between runs. The 30-second solver limit remains separate. Applying a draft or selecting a built-in method assigns a new weight revision, preventing stale LU reuse even for a function that returns different weights on successive runs. Boundary-only changes reuse the existing evaluated weights and factorization.
- The lower panel is dedicated to Weight function, applied weights, and input ring data. No source upload, backend, installation, or build is needed to use the editor.

The reported solver time excludes the separate isolated weight-evaluation step. Source is limited to 100,000 characters. Functions must return ordinary arrays synchronously; Promises and typed arrays are rejected.

### Weight function contract

`createVertexRing(mesh, vertexId)` returns an isolated data object:

- `center`: vertex ID and original model position.
- `isBoundary`: whether the fan is open.
- `neighbors`: oriented fan order; each entry has ID, original position, edge length, center angles, opposite angles, opposite vertex IDs, and incident face IDs.
- `faces`: incident face IDs, vertex IDs, original positions, areas, and unit normals.

All angles are in radians. Angle pairs refer to the previous and next side of the corresponding edge. Missing sides on an open boundary fan are null. A weight function receives this ring and returns one unnormalized finite number per neighbor. The solver evaluates weights only at interior vertices. The standalone editor examples are in `app/js/weight-program.js`; `weightMethods` in `app/js/weights.js` retains reference callbacks for numerical tests.

Nonplanar polygons are triangulated in their dominant-plane projection, with a warning. Self-intersecting or degenerate polygons that cannot be triangulated are rejected with their OBJ line number. The checks do not detect intersections between separate triangles. Near-degeneracy uses a cross-product magnitude threshold of 1e-12 after normalizing the bounding-box extent to two units.

Try `app/examples/concave-polygon.obj` for automatic triangulation, or `app/examples/closed-tetrahedron.obj` for a viewable mesh that needs a cut before disk parameterization.

## Geometry editing

- Select and Move tools operate on any loaded mesh, including meshes currently blocked from parameterization.
- The 3D translation gizmo offers world X/Y/Z axes and plane handles. Select a vertex in either view, then move it in Triangle mesh.
- Move uses the 3D gizmo by default. G activates Move; X, Y, or Z restricts the gizmo to that axis. Shift+X, Shift+Y, or Shift+Z enables direct vertex dragging in the perpendicular YZ, XZ, or XY plane. Set the constraint before dragging; repeat its shortcut or press G to return to the 3D gizmo. Rotate the camera if a drag plane is viewed edge-on.
- The Planar disk example provides a planar editing case alongside Curved disk.
- Geometry is edited only through Triangle mesh. Its selection overlay shows the selected vertex ID, original-unit X/Y/Z coordinates, boundary/interior classification, and incident triangle count. The UV view shows the selected vertex's U/V coordinates. These coordinates update while dragging and after solving. There is no numeric position form or separate selection inspector.
- During a drag, the original mesh updates but the last UV layout stays visible. Solving runs on release. Geometry edits invalidate evaluated weights and LU caches; draft code is retained but not applied automatically.
- Display normalization stays fixed during editing so the camera and manipulator do not jump. Original imported coordinates are retained independently.
- Keyboard undo/redo stores up to 50 geometry commands. Loading another model resets history. Connectivity and vertex IDs never change. To recover original positions, select another Model and select the desired model again; the last imported OBJ is retained in the Model selector for the same purpose.
- Moving a boundary vertex always recomputes boundary spacing from current geometry, for both boundary shapes. Interior-only edits leave boundary UVs fixed. Changing Boundary or Spacing regenerates the constraints, and undo/redo recomputes them from the restored geometry.
- Each committed edit is revalidated. Degenerate triangle edges are marked red, solving pauses, and the previous UV solution is labeled Previous geometry. Undo or another geometry edit can restore eligibility. This does not add triangle-intersection or UV-inversion tests.

Undo/redo recalculates UVs under the currently applied weight function. Deterministic functions recover their previous numerical result for the same geometry and boundary. Functions using randomness may produce new weights on reevaluation.

## Distortion diagnostics and display modes

- Surface visualization switches both views between Solid, Checkerboard, Grid, Angle distortion, Area distortion, and Inversions without reevaluating weights or solving again.
- A local procedural checkerboard uses the solved UVs on the original mesh and UV domain. Checker cells controls its resolution (2–256 cells across the unit domain). No image download is needed.
- Grid displays constant-U and constant-V lines on a white surface, with very dark blue lines and screen-space antialiasing. Grid cells controls the number of cells across the unit UV domain (2–256). Both views use the same UV grid, suggesting how a rectilinear remeshing would follow the parameterization; this view does not generate new mesh geometry. In the 3D view, Grid temporarily hides triangle edges, boundary edges, and vertex dots, restoring their display settings when leaving it. In the UV view, Grid and Checkerboard use alpha 0.3 and keep edges and vertices visible according to the Show checkboxes. Picking and geometry editing remain available.
- Per-triangle angle distortion is the maximum absolute difference between corresponding 3D and UV corner angles, in degrees. Its fixed color scale runs from 0 to 60 degrees; higher values saturate.
- Angle and area modes show matching compact color histograms at the lower left of both viewers. Twenty bins share the color scale: 0–60 degrees or signed log₂ area ratio −3 to +3, with area ticks at 1/8×, 1×, and 8×. Bar heights show percentages of measurable, non-inverted triangles, without area weighting; the tallest percentage labels the vertical scale. Hover a bin for its interval, count, and percentage. A continuous color scale is shown below the X-axis values. End bins include values beyond the scale limits. Special-color triangles are excluded from this distribution and their counts appear separately. Legends hide with inactive diagnostics and in other display modes.
- Area distortion is `log2((abs(UV triangle area) / total absolute UV area) / (3D triangle area / total 3D area))`. Zero preserves the triangle's fraction of total area; +1 doubles it and −1 halves it. The fixed diverging color scale clips at ±3. Absolute UV areas deliberately count overlapping folds separately.
- Inversions uses signed UV area, with positive orientation expected from the consistently oriented disk boundary mapped counterclockwise. Red means inverted, gold means collapsed, gray means invalid source geometry, and green means positive orientation. Red/gold/gray also override the distortion maps.
- Inversions shows a categorical legend with all four orientation colors and triangle counts at the lower left of both viewers.
- Areas are calculated after independently translating and uniformly normalizing source and UV coordinates by their bounding-box extent. UV triangle area at or below 1e-15 of the squared UV extent is treated as collapsed; source area at or below 1e-14 of the squared source extent is treated as invalid. These are numerical tolerances, not exact predicates.
- Both viewers show the same compact mesh distortion table: mean and maximum absolute log₂ area ratio, mean and maximum angular error in degrees, and inverted triangles / all triangles. Means are arithmetic averages over measurable triangles, without area weighting; collapsed and invalid faces are excluded and their excluded count is shown. Inverted faces remain included. Selecting a triangle adds its absolute log₂ area distortion, normalized area ratio, angular error, and exceptional orientation status to both tables. These values are not clipped to the color scale limits. Triangle selection is highlighted in both views; the source overlay shows its ID and vertex IDs, and the UV overlay shows its vertex coordinates.
- Diagnostics use the displayed solution, including when a new function fails. During geometry edits or while a previous-geometry solution is visible, diagnostic colors, checkerboard, and UV grid pause until a solution matches the current geometry. Unsolved projections are never presented as analyzed parameterizations.

These are local per-triangle measurements. They do not test intersections between separate triangles, prove global injectivity, or estimate matrix conditioning. Negative weights alone do not imply inverted triangles. Source lighting can shade the colors; both viewers share the same numeric scale.

## Controls

The compact interface places Model, Import OBJ, Mesh details, geometry tools, Display mode, pattern cell count, and Show in the Triangle mesh header. Show follows Checker cells or Grid cells when present and opens Edges and Vertices toggles shared by both views. The Parameterization header holds Boundary, Spacing, Weights, and Solver details, in that order. Mesh complexity is overlaid as separate triangle, edge, and vertex counts, followed by selection information. Successful solve time and UV coordinates appear in the UV overlay; residuals and factorization diagnostics remain inside Solver details. There is no footer status bar or separate selection inspector. Matching overlay tables show global and selected-triangle distortion in both viewers. Only errors and preparation issues produce additional viewer notices.

The Model selector includes three anatomical OBJ examples: a head with an open neck boundary, a headless torso, and a bust, both open at the waist. A more detailed head is also included in the example files but is omitted from the dropdown. All four assets are validated disks and work with the built-in weights and geometry editor. See [model documentation](MODELS.md) for preparation, source attribution, CC0 license, and regeneration instructions.

- Click near a visible vertex (within eight CSS pixels) to select it; elsewhere on the surface, click to select a triangle. Clicking outside the mesh clears selection. Selection is automatic in both views, even with vertex dots hidden. Zoom in when a dense mesh makes individual triangles difficult to target.
- Drag the 3D view to orbit; right-drag to pan; scroll to zoom.
- Drag the UV view to pan; scroll to zoom. UV rotation is disabled.
- Both views allow zoom up to 4096×. The 3D viewer converts dolly gestures to optical zoom so close inspection does not move the camera through the surface, and panning sensitivity scales with zoom. UV zoom follows the cursor. Reset camera returns its viewer to the overview. Pattern and camera limits are centralized in `app/js/settings.js`.
- Click outside the mesh or press Escape to deselect.
- Drag either separator to resize. Focus a separator and use its arrow keys; Home restores its default size.
- Each Reset camera button affects only its own view.
- Import OBJ opens a local file picker. Files are read in the browser and are not uploaded.
- Mesh details opens topology diagnostics and mesh statistics.
- Input ring data exposes the ordered neighbors of the selected vertex. Imported source polygon and line metadata are retained internally.
- Changing Model immediately loads it. A failed import or model load retains the previous mesh and selected Model.
- Weights, Boundary, and Spacing automatically recalculate when changed. Boundary and Spacing change only the constraints and reuse the current factorization. No Recompute button is needed.
- Square anchors four distinct boundary vertices at the corners. Corner candidates are chosen nearest the quarter-perimeter positions (or quarter vertex counts for Uniform), with at least one edge per side. Spacing applies within each side: equal edge intervals for Uniform, or intervals proportional to 3D edge length for Arc length. When the vertex count is not divisible by four, Uniform intervals can differ between sides. Square requires at least four boundary vertices; its option is disabled for smaller boundaries, and loading such a mesh selects Circular.
- Solver details opens a compact modal styled like Mesh details: displayed method and boundary settings, weight formula, system size, maximum relative residual, solve time, and LU factorization time or reuse. Close or Escape dismisses it. Cancel stops an active calculation.
- Weight function always shows the editor, applied weights, and input ring data. Apply uses the current draft; selecting a built-in method in Weights restores its example. Weight function help opens a large modal with the one-ring diagram, a full-size image link, and an independently scrollable reference for the input schema, angle indexing, return values, and evaluation rules. Close or Escape dismisses it.
- Move activates the 3D gizmo. G, X/Y/Z, and Shift+X/Y/Z offer keyboard access to movement constraints without a dropdown. Escape cancels an active drag; otherwise it returns to Select and clears selection. UV dragging still pans the UV camera; geometry editing happens in Triangle mesh.
- Ctrl/Cmd+Z, Ctrl/Cmd+Shift+Z, or Ctrl/Cmd+Y undo/redo geometry outside text inputs and the code editor. These advanced actions have no toolbar buttons.

## Development checks

```sh
npm test
```

Run `npm ci` first to install the pinned math.js development dependency used by the numerical tests. Installation is not needed to serve the application. Checks cover OBJ parsing, topology, analytical angle/weight values, affine reproduction, comparison with an independent dense reference, fixed boundaries, factorization reuse, invalid weights and solver results, and stale/canceled Worker requests. Interactive behavior should also be checked in a WebGL-enabled browser.

## Source structure

Application files live in `app/`, documentation lives in `docs/`, and the project overview stays in the root `README.md`. `docs/images/` contains documentation-only figures and the demo GIF.

- `app/js/mesh.js`: example geometry, shared connectivity, and reference UVs.
- `app/js/obj.js`: OBJ parsing and polygon triangulation.
- `app/js/topology.js`: connectivity, ordered neighborhoods, boundary loops, validation, and display normalization.
- `app/js/geometry-editing.js`: coordinate conversion, geometry validation, planar detection, frozen boundaries, and undo/redo commands.
- `app/js/distortion.js`: scale-independent angle/area measurements, orientation classification, and diagnostic colors.
- `app/js/distortion-histogram.js`: histogram intervals, tail grouping, counts, and percentages.
- `app/js/distortion-legend.js`: shared color scales, histograms, and orientation legends.
- `app/js/distortion-info.js`: consistent mesh and selected-triangle statistics in both viewers.
- `app/js/weights.js`: the vertex-ring contract, built-in weights, and validation.
- `app/js/parameterization.js`: circular and square boundaries, sparse assembly, LU factorization, solving, and residual checks.
- `app/js/compute-worker.js`: CDN solver loading and the factorization cache.
- `app/js/solver-controller.js`: Worker requests, cancellation, timeouts, and stale-response protection.
- `app/js/weight-program.js`: standalone examples and the serializable evaluation runtime.
- `app/js/weight-runner.js`: opaque-origin sandbox, disposable evaluation Worker, validation, and timeout.
- `app/js/editor.js`: progressive CodeMirror enhancement and plain-text fallback.
- `app/js/viewer.js`: Three.js scenes, navigation, rendering, and picking.
- `app/js/settings.js`: shared checker/grid resolution limits and camera inspection limits.
- `app/js/app.js`: application selection state, controls, and inspector.
- `app/js/layout.js`: accessible panel resizing.
- `scripts/serve.js`: optional local development server; not needed on a static host.

- `.github/workflows/pages.yml`: static asset staging and deployment to GitHub Pages.
