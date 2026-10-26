# Corelith UI redesign audit — 26 October 2026

This report records its implementation checkpoint. For the latest release, test totals, blank startup and follow-up repairs, see [current status](CURRENT_STATUS.md). The later [Knife/pattern and native upload audit](KNIFE_PATTERN_UPLOAD_FIXES.md) supplements the findings below.

## Source-based baseline

React 18, TypeScript 5.7, Vite 6, lucide-react icons; custom Canvas2D rendering and geometry, no routing library or UI framework. `src/main.tsx` mounts `App.tsx`. `core/store.ts` exposes one `EditorStore` via useSyncExternalStore. Document snapshots provide 80-step undo and redo; clipboard is session-local. Millimetre geometry is mapped through zoom/pan with screen-space pointer transforms. Existing project schema and machining output must remain compatible.

Baseline: 78 JavaScript + 10 Python tests pass; TypeScript/production build passes. Vite reports a large-bundle advisory, not a failure. No lint script exists. Source backup: `backups/corelith-before-ui-redesign-2026-10-26.tar.gz`. Existing uncommitted work is preserved.

## Feature / component map

| Capability | Authoritative implementation / UI |
|---|---|
| Documents, pages, layers, history, selection, transformations | core/model.ts, core/store.ts; LeftDock, PageBar, DesignPanel |
| Drawing, drag/resize/rotate, keyboard pan, nodes, guides | CanvasStage.tsx; ToolRail, ToolOptions; geometry.ts |
| Canvas passes, preview, selection/snap/node overlays | render/renderer.ts; CanvasStage ResizeObserver |
| Snapping, Knife, patterns | core/snapping.ts, knife.ts, patterns.ts; SnapPanel, PatternsPanel, ToolOptions |
| Fill/stroke/text/clipping/booleans | DesignPanel; model.ts, textCurves.ts, booleans.ts, exporters.ts |
| Vector/image/PDF imports | svgIO.ts, vectorIO.ts, mediaImport.ts, bitmapTrace.ts; App, MediaImportModal |
| Export / projects | exporters.ts, vectorIO.ts, ruidaIO.ts; TopBar, ProductionPanel |
| Operations, nesting, timing, sequencing/simulation | model.ts, production.ts; store.ts, ProductionPanel, renderer.ts |
| Preflight / RD readiness | production.ts + laserClient.prepareLaserJob + ruidaIO validation |
| Controller | laserClient.ts → server/ruidaBridge.mjs → ruida_upload.py; UDP, FTP readback |
| Desktop | server/desktopServer.mjs, scripts/desktop-launch.mjs, install-desktop.mjs |
| Persistence | App delayed localStorage autosave; store normalizes existing document on load |
| Tests | node:test bundled TS through scripts/load-core.mjs; Python unittest; native RD and media fixtures |

Inspected actual App, store/model, dock/tool/property components, production panel, renderer/CanvasStage, shared input components, job/laser client, bridge, exporters, build/server and test implementations. Existing REA is for native artifacts, so no decompilation is needed for this source-only redesign. Available code-review MCP supports PR CI lookup; no PR is involved.

## Current problems and constraints

Top bar has fake-looking LOCAL metadata; autosave silently catches errors. Canvas has permanent instruction banner, chips, repeated dimensions and WASM badge. Two separate workflow/tab systems compete. Both object tree and Laser panel edit speed/power. Inspector uses tiny labels and renders long advanced sections. No dark theme, search, fit-selection/all, or meaningful small-screen panel behavior. Layer/object rows need keyboard access and named controls.

ProductionPanel owns connection and transfer polling in local state. It must remain mounted when workflow changes so transfer recovery is not lost. Existing transfer IDs and no-automatic-resend behavior must remain. No controller request will be made during verification; bridge tests use mocks. Dot/pen modes, micro-tabs and unsupported effects retain validator blocking; no new machine motion commands. Material presets are built-in apply-only data; no existing preset editor/library CRUD. Assets have no authoritative storage model; do not add an empty assets tab. Sheets currently support add, rename, resize, switch and delete, but no duplication action. Group/ungroup is not supported. Do not expose placeholder controls for these gaps.

Text uses bundled Liberation-compatible fonts, not arbitrary installed fonts. PDF is rasterized and traced; images/PDF are not native grayscale output or lossless PDF vectors. Nesting is shelf packing. Timing excludes acceleration/corner/controller delays. Automatic LCD refresh is unresolved. These limits remain visible.

## Proposed structure and migration

1. Add presentation-only workflow/theme/preferences, persistent section expansion and accurate autosave status; keep project schema unchanged. Add fit-selection/all using existing bounds and viewport utilities.
2. Compact top bar with three workflows, real local-save state, menus/panel/theme controls and contextual primary action. Upload CTA opens review; only the named transfer button invokes existing upload code.
3. Searchable Objects / Sheets panel; remove duplicate process editors there. Keep layer colours, transfer, visibility/locking and stacking. Existing sheet management remains accessible.
4. One contextual inspector with Design properties / Snapping / Patterns, Laser operations / optimization, Preview summary/simulation / connection / export. Preserve ProductionPanel lifecycle across modes.
5. Reusable progressive sections and light/dark tokens; larger readable controls, reduced canvas overlays, responsive slide-over docks and focused dialogs. No new UI dependency.
6. Improve operation expansion, validation severity, time summary, nesting preview and upload review without duplicating domain calculations.
7. Test workflow transitions and unchanged RD bytes, fitting, persistence failures/preferences and compatibility. Run existing geometry/ordering/export/transfer tests. Browser check drawing, both themes, workflows, selection, scrolling and mobile panel layout using actual screenshots. Refresh installed desktop only after checks.

## Regression strategy

No renderer coordinate semantics, machining algorithms, controller protocol or import/export formats will change. Tests establish byte-for-byte RD stability across presentation changes, selection/history stability, and view fitting. Existing 88 tests cover node/transform/snapping, project compatibility, power validation, ordering, timing, imports/exports and mocked transfer success/failure/readback. Add targeted presentation-state/persistence tests, then run full suite/build and inspect actual UI. No hardware test jobs or connection verification against the cutter.

## Milestone log

- M1 complete: source audit, backup, baseline 88 tests/build passed.
- M2 complete: three workflows, compact top bar, searchable commands, quieter canvas, responsive dock state and persistent themes. Existing geometry/store retained. Existing 88 tests/build passed after shell integration.
- M3 complete: searchable Objects/Sheets, one contextual inspector, persistent section expansion, aspect lock, fit-selection/all, grouped exports, honest bundled font labels and Regular/Bold weights. Existing drawing/node/snapping/Knife/pattern interfaces retained. 95 tests/build passed at the first added-regression checkpoint. Browser checked aspect-lock resize and undo, object search, command search and export dialog.
- M4 complete: expandable operation settings preserve independent process values; optimization split into kerf/origin, entry/exit, vector engraving, sequencing, geometry quality and shelf nesting. Preview calls the existing nesting algorithm and labels bounding-box coverage accurately. Existing job/export regressions and build pass. Preset editing was not fabricated: the repository has built-in apply-only presets, with an explicit replacement notice.
- M5 complete: dedicated Summary, selectable execution list, simulation and theoretical time breakdown; severity-specific JobChecks with object/layer actions where a validator message identifies them. Browser verified execution selection and progressing/reset simulation. Domain timing/ordering unchanged.
- M6 complete: connection/profile and review separated from manufacturing settings; real transfer outcomes distinguish mismatch, unavailable readback and verified bytes. Explicit verified connection is now required in the UI before the existing storage upload handler can run. Top-bar Upload opens review; it does not send. Bridge, protocol and uploader files unchanged. Mocked bridge/Python regressions and new result-presentation tests pass; physical connection/upload deliberately untested.
- M7 complete: light/dark themes, keyboard focus and custom-dialog containment/restoration, contextual inspector, compact responsive panels and final browser inspection. **90 JavaScript + 10 Python tests pass**, TypeScript/production build and git diff whitespace check pass. Existing Vite large-bundle advisory remains. Installed desktop verification and screenshots are recorded in `ui-redesign-report.md`.
