# Native curve analysis and drawing workflow — 26 October 2026

This report records its implementation checkpoint. For the latest release, test totals, blank startup and follow-up repairs, see [current status](CURRENT_STATUS.md). The later [Knife/pattern and native upload audit](KNIFE_PATTERN_UPLOAD_FIXES.md) supplements the findings below.

## Scope and evidence

The user clarified the Corel priorities: drawing, snapping, Knife, rectangular/circular patterns and a simple UI. REA 6.8.0 and Ghidra 12.1.4 performed static analysis of selected supplied DLLs. Neither vendor program nor the cutter was run or contacted. Original binaries remain unchanged. Decompiler output is partial pseudocode, not the original buildable source project. Existing reports/prototypes in the Corel folder are earlier reconstructions and do not establish full equivalence.

Two recovered arithmetic routines are integrated into `src/core/nativeCurveMath.ts`:

| Binary / SHA-256 | Routine | Integration |
|---|---|---|
| RDWorks `ExMath.dll` / `f871f744353c05580e9480ebfcab32dac31814a47c2f8fb1b20b9c888fb38298` | `_math_elli2bezier`, `0x100080e0` | 13 ellipse control points using width/height × 0.2761423749154; adapted to existing editor anchor order |
| Corel `CDRCRV.dll` / `0e676932d879d202a63b00cd01c6377d82b13367de16efdacd791e768f9b2f81` | cubic evaluator, `0x180018f90` | Horner-form coordinate evaluation with exact endpoint guards |

REA evidence IDs:

- RDWorks: `ev_0f29ad8a1bbf3a997365f00dd8c28516da521857842c8be44984ee2bf5dee2b8`, [record and pseudocode](reverse-engineering/rdworks-ellipse.json).
- Corel: `ev_4e09377508830ed60670010295abcbdc5c713b0f8bc6918b6b73870b8c23371e`, [record and pseudocode](reverse-engineering/corel-cubic.json). [Call-chain findings and limitations](reverse-engineering/COREL_FINDINGS.md).

Corel's evaluator is mathematically equivalent to the previous Bernstein evaluator. It alone does not improve machine smoothness. General vendor snapping, Knife, pattern, curve sampling and motion-planning implementations have not been recovered or substituted wholesale. A circular arc routine with uncertain recovered arguments was inspected but not ported.

## Cutting quality repair

Machining now uses adaptive Bézier subdivision with a 0.005 mm chord-error bound and 1.5° endpoint tangent constraint, independently of display sampling. Distance-only point deletion was removed to preserve short intentional corners. DXF arcs and bulges retain curved spans with source approximation below 0.001 mm instead of coarse polylines. Reimport old polygonized DXFs to recover their source arcs. Image/PDF traces remain pixel-derived vectors.

Short burning moves use native RDWorks-style relative XY commands (0xA9); long moves retain absolute 0xA8. Deltas are differences of rounded absolute micron coordinates, preventing cumulative rounding drift. Positioning between contours remains laser-off. Existing contour-only, layer settings and inner-first ordering remain in place.

Independent decoded metrics for the supplied 25 mm native circle:

| Output | Segments | Largest vertex turn | Maximum radial deviation |
|---|---:|---:|---:|
| Previous Corelith | 32 | 11.516° | 0.063060 mm |
| Native RDWorks | 112 | 3.3513° | 0.005113 mm |
| Updated Corelith | 128 | 2.9871° | 0.003894 mm |

Run `node scripts/compare-rd-circle.mjs` to reproduce the diagnostic. Native points match 28 uniform parameter steps per quarter of the four ellipse cubics after micron rounding; one fixture does not establish the vendor's general sampling algorithm. Actual motor smoothness, controller acceleration and material results still need an operator-run comparison cut. No physical cut was performed.

## Drawing tools and simpler controls

- The previously unmounted tool-options bar is now visible below the main toolbar. Select offers direct Rectangular pattern, Circular pattern and Snapping actions.
- Knife exposes 2-point/freehand/Bézier paths, Slice/Gap/Overlap, width, auto-close and selected-only/all-under-path scope. Corner hits are deduplicated and endpoint touches do not create false cuts. Curve pieces retain Bézier geometry.
- Rectangular patterns repeat a multi-object selection as an assembly, using common bounds for spacing. Columns/rows include the source. Circular patterns preserve the assembly, use a shared pivot and show the number of new copies. Both operations undo as one edit.
- Snapping has compact target controls, screen-space radius and clear labels. Open paths no longer gain phantom closing edges for intersections; hidden/locked artwork is excluded from alignment guides; tangent detection uses the tangent condition instead of perpendicular projection. These are Corelith repairs, not claims of recovered Corel snapping code.
- Advanced effects and pattern formula details are collapsed to keep routine controls easier to find.

## Verification and remaining limits

78 JavaScript + 10 Python tests and the production build pass. Coverage includes native arithmetic equivalence, adaptive curve accuracy, small corners, DXF arcs/bulges, relative command rounding across origins, snapping, Knife and multi-object patterns. Browser checks covered both pattern modes, actual Knife splitting, undo, the property bar and snapping layout. Original Audit Workflow geometry was restored after temporary edits. Screenshots: [Knife](drawing-knife.png), [rectangular](drawing-rectangular-pattern.png), [circular](drawing-circular-pattern.png), [snapping](drawing-snapping.png).

Pre-change source backup: `backups/corelith-source-before-rea-2026-10-26.tar.gz`. No upload, controller write, motion or laser firing occurred. Automatic LCD refresh remains unresolved; use Esc → File → select filename after uploading.
