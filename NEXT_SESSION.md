# Corelith Studio — next-session roadmap

Created: 24 October 2026. Last updated: 26 October 2026.

## Current handoff

Read [current status and documentation index](docs/CURRENT_STATUS.md) first.

- Latest verified implementation: **99 JavaScript + 10 Python tests passed**; production build passed. Counts in the historical progress entries below refer to earlier checkpoints.
- Installed desktop release: `2026-10-26T12-36-19-596Z`, serving on `http://127.0.0.1:5188`. Source remains in this folder; old releases are preserved.
- Startup is intentionally blank (one sheet, no objects). Do not restore the demo or previous drawing automatically. **File → Restore last autosave** is the explicit recovery action; an untouched startup canvas does not overwrite it.
- Knife accepts click–click/drag; circular previews use actual geometry and Apply keeps source selection. Read [the fixes and native upload audit](docs/KNIFE_PATTERN_UPLOAD_FIXES.md).
- Image/PDF import is implemented as monochrome tracing into editable outlines or vector engraving spans. Read [the import guide](docs/IMAGE_PDF_IMPORT.md) for usage and limits; native/lossless PDF vector extraction and grayscale/dither raster output remain future scope.
- Automatic cutter LCD refresh remains unresolved. Current guidance is **Esc → File → select uploaded filename**. Do not claim the panel refresh is fixed or send undocumented selection/start commands.
- Corel drawing priorities implemented: visible property bar, Knife, shared-assembly rectangular/circular patterns, simpler snapping/effect controls. Selected native Corel/RDWorks curve arithmetic is integrated, with finer machining curves, curved DXF imports and native short relative burn moves. Read `docs/RDWORKS_REVERSE_ENGINEERING.md` for evidence, metrics and limitations. No cutter access occurred.

## Progress — 26 October 2026

Circle sizing: NumField no longer commits untouched rounded values on blur (which could unexpectedly resize geometry). Explicit Make circle for a selected ellipse uses its current width, preserves centre/style/identity and locks proportions. Lock help distinguishes independent dimensions from proportional resizing. Browser verified unchanged-field focus creates no undo edit, 25 × 25 mm circle sizing, and undo restoration of the original two-object Audit Workflow. **99 JavaScript + 10 Python tests and build pass**. Installed release `2026-10-26T12-36-19-596Z`, served bundle `index-shWk_QUb.js`; idle local server restarted, readiness verified. No cutter access. Screenshot `docs/circle-sizing-fixed.png`.

Clean startup: every launch/reload now opens one empty sheet, no artwork or selection. Previous autosave is preserved until document changes and can be opened explicitly with File → Restore last autosave. Showcase remains an explicit File action. Browser verified recovery of Audit Workflow and subsequent blank reload. **97 JavaScript + 10 Python tests and build pass**; installed desktop release `2026-10-26T12-25-11-263Z`, readiness and served bundle verified. Screenshot: `docs/clean-startup.png`. No cutter access.

Knife/circular-pattern follow-up: click–click and short drag Knife repaired; real cubic crossing refinement; explicit cut feedback. Circular arrays now use actual geometry preview, correct custom-radius full-circle spacing, fresh-source pivot initialization and stable source selection after Apply. Source appearance is preserved. Browser verified both Knife gestures, pattern preview/Apply and undo restoration. **96 JavaScript + 10 Python tests and build pass**. Static REA upload audit confirms existing framing/cipher/checksum/ACK fundamentals; transport left unchanged. No cutter access. Read [fix report](docs/KNIFE_PATTERN_UPLOAD_FIXES.md).

UI/UX redesign implemented in the existing application. Three top-level workspaces: Design, Laser, Preview & Send. Compact header/rail, searchable Objects/Sheets, contextual inspector, light/dark themes, local-save states, command palette, fit-selection/all, aspect lock, grouped exports, expandable layer settings, focused optimization sections, calculated nesting preview, clear job-check severity and explicit connection/upload review. Existing geometry, project schema, RD encoding, protocol and bridge preserved. Top-bar Upload opens review; a verified non-motion handshake is required before the existing storage upload action. Transfer results distinguish verified bytes, unavailable readback and mismatch. Original two-object Audit Workflow restored after temporary browser edits. **90 JavaScript + 10 Python tests and build passed**; installed release `2026-10-26T11-46-04-978Z` serves the exact tested bundle, launcher readiness passed. Browser screenshots cover light/dark, operations, preview, exports and compact layouts. No cutter connection check, upload or motion was performed. Read [audit](docs/ui-redesign-audit.md) and [implementation report/file list](docs/ui-redesign-report.md). Backup: `backups/corelith-before-ui-redesign-2026-10-26.tar.gz`. Built-in preset editing, Assets, sheet duplication and grouping remain unavailable; do not claim otherwise.


Corel drawing/curve-quality follow-up: installed and used the REA skill for static native analysis. Ported the observed Corel cubic evaluator and RDWorks ellipse controls, without claiming original source recovery. Replaced coarse machining flattening and short-edge deletion; preserved DXF arcs/bulges; added quantization-safe relative burn commands. A 25 mm circle improved from 0.063060 mm to 0.003894 mm maximum radial deviation, versus native RDWorks 0.005113 mm. This is geometric evidence, not a physical cut comparison. Repaired snapping, Knife corner hits and multi-object pattern assemblies; exposed previously hidden tool controls and simplified panels. **78 JavaScript + 10 Python tests and build pass**. Browser verified both patterns and a real Knife split; undo restored original Audit Workflow artwork. Source backup: `backups/corelith-source-before-rea-2026-10-26.tar.gz`. See the [evidence and drawing guide](docs/RDWORKS_REVERSE_ENGINEERING.md).


Image/PDF import: File and Laser import controls now accept PNG/JPEG/WebP/BMP/GIF and PDF. New local preview offers PDF page selection, physical width with locked aspect ratio, threshold, inversion, outline-to-Cut and vector-line filled engraving-to-Engrave. Preserves islands/holes, transparent gaps and laser-off travel; imports are editable vectors with undo. PDF.js and its worker/fonts/CMaps/WASM are bundled for offline desktop use; desktop `.mjs` MIME handling repaired. PDF is rendered then monochrome traced (1024 px maximum side), **not lossless vector PDF extraction or grayscale/dither raster engraving**. See README for size/detail limits. Browser checked PNG outline/engraving, second PDF page, layer modes/export readiness, and undo restoration of the original Audit Workflow drawing. Regression coverage: **60 JavaScript + 10 Python tests passed**, production build passed. Screenshot: `docs/pdf-image-import.png`. No controller commands or uploads were sent.

LCD follow-up: user reports newly sent files appear after Esc and reopening File. Storage upload/readback does not explicitly select a panel job or refresh its open menu. Protocol reference review did not establish a verified refresh-only command for this firmware. Added persistent guidance and filename-specific upload success instructions: **Esc → File → select uploaded filename**. Automatic LCD refresh is **not implemented or physically verified**; do not claim it is fixed. No remote Escape/select/start commands or controller index edits were added. If investigating further, use a vendor-confirmed command or a captured RDWorks transfer before changing the known-working upload sequence.

Desktop import release: installed `~/.local/share/corelith-studio/releases/2026-10-26T09-26-44-613Z`, restarted only the verified idle prior backend, and passed launcher `--check`. Browser verified the production desktop server on port 5188 renders both PDF pages with its bundled worker and correct page aspect ratio (70.56 × 42.34 mm for the fixture). Final screenshot is from the installed build. Temporary test tab closed; source, older installed releases and original source drawing preserved.

Additional burn-only verification: an independent absolute/relative motion decoder confirms native RDWorks `20MMSQR.RD` and Corelith's square cover only the intended perimeter. Outer rectangle + inner hole + separate score, two passes at all four origins, have exact intended burn coverage and six laser-off positioning moves, without entry/exit burns in Contour only mode even with saved 5 mm lead lengths. **53 JavaScript + 10 Python tests passed**. Only tests/docs changed in this follow-up; no installation refresh needed. No physical comparison cut or controller write was performed. See `docs/RDWORKS_COMPARISON.md` for evidence and limits.

RDWorks/score investigation: see `docs/RDWORKS_COMPARISON.md`. Contour-only is now the default, outer-only leads are optional, and rapid optimization chooses nearer closed-contour vertices without changing geometry. Fixed operation changes resetting entered speed/power, intermediate typed power digits reducing linked minimums, and missing explicit air-OFF on layer transitions. Independent decoder verifies synthetic 200 mm/s / 12% minimum+maximum in header and runtime commands; user was unsure of RDWorks minimum. Browser checked that typing the intermediate digit 1 leaves minimum unchanged until committing 12, and switching to Score preserves 200/12. Authorized read-only FTP retrieved new entries KEYCHAIN.RD and UNNAMEDS.RD. **KEYCHAIN.RD actually contains 200 mm/s, ~1% minimum, ~12% maximum**. This confirms the hidden low minimum. The exact working RDWorks 200/12 file was unavailable; the PRL reference follow-up below records the user's clarification. UNNAMEDS.RD is 30 mm/s at ~50–55%, not the reported 200/12 job. Controller copies/hashes are recorded in the comparison report. No machine writes or motion were sent; do not claim physical equivalence until tested by the operator.

Reference follow-up: the user said the exact RDWorks job is missing and supplied **PRL.RD** instead. It was retrieved read-only and has 100 mm/s at ~20% min/max, then 15 mm/s at ~70% min/max. Synthetic Corelith header/runtime parameter comparison agrees within encoding quantization. PRL does not establish the missing job's exact minimum. Raw copies and comparison JSON are preserved; no more filename question is pending. Final verification: **51 JavaScript + 10 Python tests passed**, build passed, browser checks passed. The desktop release was refreshed with these repairs; existing controller jobs remain unchanged and must be regenerated/resubmitted explicitly after parameter review.

Power/infill follow-up: synchronized maximum/power fields and both sidebars; lowering maximum lowers a stale minimum rather than raising power. Legacy missing bounds derive from saved power; explicitly invalid saved bounds still block with layer name/values and a visible repair action. Added undoable per-text **Filled text engraving** with hatch spacing for editable/converted text, preserving counters and layer speed/power/passes; it engraves before cuts without changing other shapes' operations. Conversion is still required before machining editable text. Mixed layer timing is labelled correctly. **45 JavaScript + 10 Python tests pass** and build passes; browser checked 20% max/min and infill export readiness. Original artwork restored after testing. Screenshot: `docs/text-infill-fixed.png`. Desktop release refreshed; no cutter commands or uploads sent.

Drawing/alignment follow-up: live rectangle/ellipse/polygon/line drafts were missing the world-to-screen zoom/pan transform and rectangle drafts reused an old canvas path. Fixed both; preview strokes remain a consistent screen width. Corrected alignment icons to match their axes and clarified the actual page target for a single selected object. Browser confirmed Center X changes only X, Middle Y changes only Y, and drawing matches drag endpoints. Temporary geometry was undone and snapping restored. **42 JavaScript + 10 Python tests pass**, build passes. Screenshot: `docs/drawing-alignment-fixed.png`. Installed desktop build refreshed; no cutter commands sent.

Text visibility follow-up: repaired rendering of outline-only text (new text has no fill), added readable source text to Laser preview instead of only an empty rectangle, and explicitly styled/labelled the Typography text editor. Verified both canvas modes and editor visually; temporary text was undone afterwards. **40 JavaScript + 10 Python tests pass** and the build passes. Desktop release refreshed. Proof: `docs/text-visible-design.png` and `docs/text-visible-preview.png`. Text conversion remains required before machining.

Completed the first workflow phase plus requested repairs:

- Selected hollow objects/groups can now be dragged from their interiors; browser verification confirmed position changes and undo.
- Added undoable text-to-curves actions in Design/Typography and directly beside the text preflight error. Bundled offline fonts preserve glyph curves/holes, multiline spacing, alignment and rotation. Unsupported scripts/glyphs remain explicitly blocked. Browser conversion changed a blocked job to export-ready with Send enabled.
- Added sticky Design → Prepare → Preview → Send steps, readiness/time status, layer path/time selection, selection highlighting, and a full execution list. The older truncated queue was replaced; stronger layer-table editing is still future work.
- Added custom layer colour pickers and standard palette selection. Existing, new and transferred objects inherit chosen colours; source fills/outlines remain enabled/disabled as before. Preview paths and RD layer colours agree. Changes are undoable.
- Installed a Linux desktop application-window copy with a bundled Node runtime, localhost production server and Chrome/Chromium UI. Desktop and app-menu entries are **Corelith Studio**. Uploads are enabled for explicit sends. See README's desktop section for launch, data locations and migration of browser projects.
- Source backup: `backups/corelith-source-before-2026-10-26.tar.gz`. Drawing backup used during checks: `backups/audit-workflow-before-ui-checks.corelith.json`. Source remains in this folder; installed releases are separate in `~/.local/share/corelith-studio/releases/`.
- Verification: **39 JavaScript + 10 Python tests passed**, production build passed, browser checks covered dragging, conversion, upload readiness, colour matching and execution list. No cutter commands or uploads were sent. Screenshot: `docs/workflow-2026-10-26.png`.

Remaining priorities: richer unified layer editing, calibrated material library/test grids, geometry repair, shape-aware nesting, native raster engraving, and complete tab support. Do not assume these future items were implemented.

## How to resume

Read this file, `README.md`, `docs/ui-redesign-audit.md`, `docs/ui-redesign-report.md`, `docs/RDWORKS_REVERSE_ENGINEERING.md`, `docs/APP_AUDIT.md`, `docs/IMAGE_PDF_IMPORT.md`, and `docs/RUIDA_PROTOCOL_SPECIFICATION.md`, then inspect the current source and working changes before implementing anything. Several original roadmap items have now been implemented; the current handoff and dated progress entries take precedence over the original proposals below. Follow the user's next request and preserve the working upload and geometry behaviour.

Suggested prompt:

> Read corelith-studio/NEXT_SESSION.md and the referenced documentation. Start implementing the next UI and laser workflow improvements, preserving the working upload and RD generation behaviour.

## Working behaviour to preserve

- Each layer has independent Cut / Engrave / Score / Ignore operation, speed, minimum/maximum power, passes and air assist under **Laser → Operations**.
- Generated jobs use **Engrave → Score → Cut** ordering. **Inside-to-Outside**, enabled by default, places nested closed cut contours before containing outlines, even when rapid optimisation is disabled.
- Engraving currently uses vector hatching; native photo/raster engraving is not implemented.
- Image/PDF imports offer a preview before committing. Preserve holes, transparent gaps, physical aspect ratio, selected PDF page, explicit sizing, operation mapping and undo. Reimporting is required to change tracing settings after acceptance.
- The Laser panel now has **Estimated job time**, with operation/layer breakdowns, passes, leads and laser-off travel. A saved 0–300% planning allowance adjusts only the estimate, never machine settings, RD bytes or simulation timing.
- Time is theoretical: path length / speed, without acceleration, cornering or controller delays. Travel assumes the configured preview start point. Measured jobs are needed to calibrate the allowance.
- RD export blocks unsupported production features instead of silently dropping them. Preserve this behaviour while extending support.

## Proposed UI improvements

1. **Guided workflow:** Design → Prepare → Preview → Send, with estimated time and preflight status persistently visible. Keep navigation simple and preserve editing context.
2. **Unified layer/process table:** Show operation, speed, minimum/maximum power, passes and estimated time together. Allow efficient editing without repeatedly opening separate controls.
3. **Linked selection:** Selecting a layer highlights its toolpaths; make burning versus laser-off travel clear in the preview, including accessible labels beyond colour alone.
4. **Visible execution sequence:** Show the ordered operations/shapes and explain engrave-first and inside-out ordering. Any later manual ordering must clearly handle these constraints.

## Proposed laser features

1. **Calibrated material library and test grids:** Store material, thickness and machine-specific settings. Generate power/speed test grids with labels. Existing example presets are not calibrated machine recommendations.
2. **Geometry checking and repair:** Extend preflight with duplicate-line detection and open-contour repair/joining. Repairs should be previewable and undoable; avoid silently changing intentional geometry.
3. **Shape-aware nesting:** Improve the current shelf-packing approach to reduce waste while respecting sheet bounds, spacing, margins and supported rotations.
4. **Native photo/raster engraving:** Implement the full image-processing, preview and supported controller-output path; do not present vector hatching as native raster support.
5. **Holding tabs:** Implement and verify micro-tab geometry, preview and RD output together before enabling export. Existing unsupported options must remain blocked until correct end-to-end support exists.

These are future proposals, not claims of completed functionality. Prefer completing and validating one coherent feature at a time.

## Cutter and upload context

- Verified machine connection: **192.168.1.11, UDP 50201** (source port 40200 in the successful transfer).
- The user explicitly requested a prior UDP sample upload and confirmed it worked. The hardware-verified sample is `corrected/GEN100.rd`, stored as `GEN100.RD`, controller file index 81, 6,271 bytes.
- Verified sample SHA-256: `af0c15cc2a1e17c626b0a60b97de425011ef89a7a3c91156021735c414c70600`.
- Preserve acknowledged-byte progress, transfer locking, status recovery without automatic resending, and stored-file readback verification.
- **For future development, keep hardware checks read-only unless the user explicitly requests a specific upload. Never start cutting, framing, jogging or firing as part of software verification.** The previous sample upload was specific to that request.
- `npm run laser` enables explicit storage uploads and normally serves port 5178. `npm run dev` / `npm run preview` use a read-only bridge. Inspect existing processes before starting another server.

## Validation and useful files

- At this handoff, `npm test` passed **44 tests** (34 JavaScript + 10 Python), and `npm run build` passed. Re-run checks after implementation; this is a historical baseline, not a guarantee about later changes.
- Browser verification covered the time breakdown and allowance update, then restored allowance to 0%. No cutter commands were sent during the estimate update.
- `docs/time-estimate.png` shows the estimate panel. `docs/audit-workflow.png` shows the earlier audited workflow.
- Key implementation areas:
  - `src/components/panels/ProductionPanel.tsx`: laser controls, layers, simulation, estimate, machine workflow.
  - `src/core/model.ts`: saved production and layer settings.
  - `src/core/production.ts`: toolpaths, ordering, nesting and time estimates.
  - `src/core/ruidaIO.ts`: RD encoding and supported-output validation.
  - `src/core/vectorIO.ts`: exchange formats and JSON handoff.
  - `src/core/laserClient.ts`, `server/ruidaBridge.mjs`, `ruida_upload.py`: transfer workflow.
  - `tests/app-audit.test.mjs`: estimate, ordering and other regression coverage.

After each feature, run appropriate offline tests and a build, verify the UI in the browser, and update this roadmap with completed items and remaining limitations. Keep machine actions separate from offline verification.
