# CDRCRV targeted curve investigation — 26 October 2026

Target: `/media/sohil/Vault/Corel/CorelDRAW Graphics Suite/27/Programs64/CDRCRV.dll`.
SHA-256: `0e676932d879d202a63b00cd01c6377d82b13367de16efdacd791e768f9b2f81`.
REA export Evidence: `ev_9364dff44768af0552eb39d3d58f11cbd569c7c49819a47cd75006f5af28fca6` (`cdrcrv-exports.json`). 1,362 exports; AMD64 PE, 1,230,752 bytes.

The prior `/media/sohil/Vault/Corel/analysis/inspection_coverage_report.md` explicitly says no native decompilation had been performed. Earlier completion claims do not establish recovered native curve algorithms.

## Observed static machine code

Export ordinal 863, `CdrCrv::GetPointOnCurve` double-vector overload, starts at `0x180045000`. Raw read-only objdump disassembly: `cdrcrv-getpoint-disassembly.txt`.

The wrapper tests the node type byte masked with `0xc0`: line ending (`0x40` with index > 0) linearly interpolates preceding/current vector points; cubic ending (`0x80` with index > 2) calls `0x180018f90` at `0x180045087`, using the four points ending at the supplied index. Invalid segment/index cases return zero. These are static branch observations, not execution traces. Exact parameter ABI/names depend on decompiler recovery and exported mangling.

The direct cubic evaluator occupies `0x180018f90..0x18001907b` (236 bytes including return). It reads four interleaved double-precision x/y points at offsets 0/8,16/24,32/40,48/56; evaluates x and y with the same arithmetic; writes one double-vector result. It has no calls or branching. Raw disassembly: `cdrcrv-cubic-disassembly.txt`. Read-only `.rdata` inspection identifies the referenced double constants: `0x1800ee898 = 2.0`, `0x1800ee8b0 = 3.0`.

A normalized mathematical reading of those instructions, for each coordinate independently:

```
a = P3 - 3 * (P2 - P1) - P0;
b = 3 * (P2 - 2 * P1 + P0);
c = 3 * (P1 - P0);
P(t) = ((a * t + b) * t + c) * t + P0;
```

This is cubic Bézier evaluation in Horner form. It is mathematically equivalent to Bernstein evaluation already present in Corelith; it is not by itself a flattening tolerance, smoothness guarantee, or the entire Corel geometry engine. A portable integration can use this exact arithmetic structure in `geometry.ts`'s `cubicPoint`, with tests against independent Bernstein and de Casteljau evaluations, endpoint/derivative identities, and existing editing/snapping/knife regressions. Preserve double precision; do not copy Corel's integer-coordinate ABI or node byte format into the UI model.

## Limits

No Corel executable or DLL was executed or modified. No original source, names for internal locals, native runtime verification, complete curve engine, snapping engine, knife topology, pattern implementation, or UI behaviour was recovered by this bounded inspection. Static code recovery does not establish physical laser-cut equivalence.

## Recovered Ghidra wrapper pseudocode

REA Evidence `ev_37ddad1e1c6847fc9ccd9eaac1e989b8440f5575151fbe50bae7584e84cedb67`, Ghidra 12.1.4: `cdrcrv-getpoint.json`; raw C text extracted without alteration to `cdrcrv-getpoint-pseudocode.c`. Ghidra confirms the direct call to `FUN_180018f90`. Its wrapper argument recovery is visibly inconsistent (the integer index appears as a double and hidden return storage shifts inferred arguments), so the exported decorated signature plus disassembly are needed to interpret its data flow. Do not copy the inferred wrapper C prototype into an implementation.

## Recovered Ghidra cubic-helper pseudocode

REA Evidence `ev_4e09377508830ed60670010295abcbdc5c713b0f8bc6918b6b73870b8c23371e`, Ghidra 12.1.4, operation `procedure_pseudo_code`, procedure `0x180018f90`: `cdrcrv-cubic-evaluator.json`. Raw decompiler text is extracted without alteration to `cdrcrv-cubic-evaluator-pseudocode.c`.

The recovered function is short and unambiguous: `double *FUN_180018f90(double *output, double t, double *points)`, with points laid out `x0,y0,x1,y1,x2,y2,x3,y3`. For x it reports:

```c
*output = ((((points[6] - (points[4] - points[2]) * 3.0) - points[0]) * t +
           ((points[4] - points[2] * 2.0) + points[0]) * 3.0) * t +
          (points[2] - points[0]) * 3.0) * t + points[0];
```

The y expression is identical with odd indices. This agrees with the independently read machine instructions and constants. Unlike the wrapper's inferred argument types, this helper's prototype and indexing are consistent with the machine-code ABI. Both Ghidra sessions were ephemeral and closed by CLI completion. A post-analysis SHA-256 check agrees with the original digest above. No original software was run.

This is actual decompiler output, not original authored Corel source. The portable geometry formula can be integrated while documenting which exact function and expression were recovered; none of the other Corel subsystem algorithms were established by this evidence.
