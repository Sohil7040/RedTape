# RDWorks path and scoring comparison — 26 October 2026

## Evidence

- [Ruida RDWorks manual, V1.3](https://www.ruidacontroller.com/wp-content/uploads/2021/10/RDWork-Laser-Engraving-Cutting-Software-V1.3.pdf), sections 2.13.1–2.13.3, 4.2, 4.7 and 4.10.2. Imported/drawn curves do not get entry/exit leads by default; those are explicitly enabled. Path optimization reorders vectors. Cutting power follows speed between the layer's minimum and maximum values.
- Local native RDWorks files previously retrieved read-only from this controller: `tests/fixtures/controller/20MMSQR.RD`, `CIR.RD` and `MOREMORE.RD`. Their header and runtime speed/power records agree.
- [Ruida encoder implementation](https://github.com/jnweiger/ruida-laser/blob/master/src/ruida.py) and [Meerk40t Ruida command definitions](https://github.com/meerk40t/meerk40t/blob/main/meerk40t/ruida/rdjob.py) cross-check vector move/cut records, layer/runtime power fields, speed fields and explicit air-assist on/off flags.

The source code of RDWorks itself was not available or run. This comparison uses the manufacturer's documentation and native output, not a claim of reproducing its proprietary optimizer.

## Repaired path handling

- New and legacy jobs default to **Contour only**. Configured entry/exit lengths do not add burning segments unless an explicit lead mode enables them. New lead-in length is zero instead of 2 mm.
- Optional **Outer outlines only** suppresses leads on nested internal cut/score contours independently of whether inside-out ordering is enabled. **All closed contours** remains an explicit advanced option.
- Rapid optimization can rotate a closed contour's starting vertex to a nearby existing vertex, preserving its winding, dimensions and perimeter. Open paths can reverse to use a closer endpoint. Operation order and inner-first cut constraints remain enforced.
- RD output, simulation, preview and time calculations continue to use shared burn vertices. Travel to the first vertex is laser-off, not an extra cut from the preview head location. Kerf remains independently controlled.

## Confirmed score-setting faults

1. Switching the operation to Score previously replaced the entire process configuration with defaults (60 mm/s, 15–30% power). It now preserves entered speed, power, passes and air assist; operation-specific defaults only fill missing values.
2. Maximum/minimum input fields previously committed every digit. Typing `12` could temporarily apply `1`, reduce the linked minimum to 1%, then leave it there when maximum became 12%. Power fields now commit only on Enter or blur. Escape cancels. This applies to both the Artwork power field and Laser layer controls.
3. Disabled air assist previously omitted an explicit OFF record. Each runtime layer setup now explicitly emits ON or OFF, so it cannot inherit the previous layer's ON state.

Score is vector cutting motion with its layer parameters, not native raster scanning or a separate undocumented scoring command. The score panel explains minimum/maximum power and offers an explicit **Set minimum = maximum** action. It never raises minimum automatically to force constant power.

## 200 mm/s, 12% verification and limits

The user reported 200 mm/s and 12% for the successful RDWorks score, but was unsure of RDWorks' minimum value. An independent decoder verifies that a synthetic Corelith score with both minimum and maximum explicitly set to 12% contains 200 mm/s and approximately 12.00024% (14-bit quantization) in both header and runtime commands. The following cut layer receives its own different values. See `score-200-12-verification.json`.

Use `node scripts/inspect-rd-settings.mjs first.rd second.rd` for a read-only comparison of actual file records. The script does not contact the cutter.

## Actual controller readback

With the user's authorization to read the cutter, FTP retrieval of the file index identified new entries 82 `KEYCHAIN.RD` and 83 `UNNAMEDS.RD`. Only login, directory selection and RETR were used. Copies are preserved in `tests/fixtures/controller/2026-10-26/`.

- **KEYCHAIN.RD**, 5,247 bytes, SHA-256 `d40f573b16a9fb30c3111e8c5c32082570e4309a9f60849db718f44e33fb0083`: first layer has **200 mm/s, minimum 1.001%, maximum 12.000%** in both header and runtime records. The following cut layer is 30 mm/s, approximately 45–50%. There are no immediate C7/C8 power overrides. This confirms that the stored 200/12 job has a hidden 1% minimum and is consistent with the intermediate-digit editing bug.
- **UNNAMEDS.RD**, 741 bytes, SHA-256 `455356c30a8b84253e30b275a58388f79fcf810c812d6e818d67e2304ac3c8c3`: 30 mm/s and approximately 50–55%, not the reported working 200/12 comparison job.
- The user then identified **PRL.RD** as an available similar RDWorks job; the exact 200/12 reference is missing. Read-only retrieval returned 5,124 bytes, SHA-256 `d0c5ed2ca09af7b85c041669aaadf9b6f14dddec79f2480a3a74dc55694de7ad`. Its first layer is **100 mm/s, approximately 20% minimum and maximum**, followed by **15 mm/s, approximately 70% minimum and maximum**. Header and runtime records agree, with no immediate power overrides. Regression comparison against a Corelith job with these parameters confirms matching speed and powers within one encoding quantum (under 0.01 percentage points).

The exact working RDWorks 200/12 job is unavailable, so its minimum cannot be established from PRL, which uses different values. The unexpectedly low Corelith minimum is established; its contribution to the physical score difference is an inference from Ruida's documented speed/power behaviour. PRL also contains other firmware flags and Laser 2 settings that differ from Corelith; undocumented flags were not blindly copied and Corelith retains Laser 2 power zero by default. The existing controller files were left unchanged. Corrected software does not repair already uploaded files; regenerate and explicitly resend intended artwork after reviewing the actual minimum and maximum.

Offline regression coverage includes contour-only native RD readback bounds, inner-lead suppression, nearest-vertex contour preservation, operation-setting preservation and independently decoded score/cut parameter transitions. No job has been uploaded or started during this investigation.

## Independent burn-only geometry verification

Added an independent motion decoder in `tests/ruida.test.mjs` for absolute and signed-relative Ruida move/cut commands. The native `20MMSQR.RD` uses subdivided segments: every burning interval covers exactly the intended 20 mm square perimeter once, with no off-design burn segment. Its initial positioning move is laser-off. Corelith's equivalent square passes the same edge-coverage check.

A separate Corelith test combines an outer rectangle, an internal rectangular hole and a separate open score line, each with two passes. For all four origin corners, every intended edge is covered exactly twice; no extra burning interval, connecting cut or lead is present. There are six laser-off positioning moves, one per contour per pass. Positive saved lead lengths of 5 mm do not add leads in Contour only mode. Coverage checks allow collinear subdivisions while rejecting missing intervals, excess passes and segments outside the intended edges. Kerf is zero for this exact-design comparison.

Verification: **53 JavaScript + 10 Python tests passed**. This establishes the tested RD command geometry, not physical cutting accuracy or equivalence of PRL to an unavailable source drawing. No upload, start or machine configuration command was sent for this verification.
