> Current app workflow and subsequent repairs: see [APP_AUDIT.md](APP_AUDIT.md). The sections below retain the original file-repair audit and its authorized upload follow-up. TCP checks and the old lack of an upload handshake were replaced in the subsequent app audit.

# Ruida file and transfer audit — 24 October 2026

This report supersedes the earlier report in this file. The earlier report claimed that LCD preview and cutting had been fixed based on file readback and a successful app build. Those checks did not establish that the controller could parse the files or execute the intended geometry.

## Evidence and access

Read-only FTP retrieval from `192.168.1.11` obtained `.filerecord`, `20MMSQR.RD`, `CIR.RD`, `MOREMORE.RD`, `GENETIC.RD`, and `SAM.RD`. Copies are in `tests/fixtures/controller/`. No uploads, filesystem edits, parameter changes, frame commands, start commands, or cutting operations were performed. The index contains 80 entries, including duplicate SAM/GENETIC names from earlier uploads. These controller entries were left untouched.

The working square and circle provide direct evidence for command lengths, frame bounds, LCD scope records, and motion encoding on this controller. External cross-checks:

- [jnweiger/ruida-laser encoder](https://github.com/jnweiger/ruida-laser/blob/master/src/ruida.py): five-byte speed/coordinate values, per-layer headers, laser 1 vs laser 2 powers and UDP ACK handling.
- [kkaempf/ruida command dictionary](https://github.com/kkaempf/ruida/blob/master/doc/commands.md): command meanings and parameter layout. Its numeric decoding prose contains errors; the actual byte streams and encoder are used for numerical validation.

## Confirmed faults and changes

| Record / behavior | Failing Corelith output | Corrected output |
| --- | --- | --- |
| E7 03 / E7 07 | Minimum fixed to zero; four coordinates appended to E7 07 | Two coordinates per command; minimum zero, maximum actual job extent |
| E7 50 / E7 51 | Zero minimum and four coordinates in maximum | Two coordinates per command, matching frame extent |
| E7 04 | One excess zero byte | Four control bytes plus two five-byte coordinates |
| E7 52 / E7 61 | Missing layer index | One index and two five-byte coordinates |
| E7 53 / E7 62 | Three index bytes | One index and two five-byte coordinates |
| LCD feature records | F1 07 and F2 02 absent relative to working files | Include the defaults observed in both working files |
| LCD scale | Negative maximum absolute page coordinate | Negative job width/height in 35-bit two's complement; job-local scope |
| Laser power | Laser 1 hard-coded to about 70%; selected power written to laser 2 | Laser 1 uses the layer's minimum/maximum; laser 2 defaults to zero |
| Multiple layers | First layer's settings applied to every contour | Separate headers and runtime speed/power changes, preserving production order |
| Passes and leads | Ignored | Included in emitted motion, bounds and distance statistics |
| Invalid geometry | Negative coordinates silently clamped; empty job given fictitious bounds | Export rejects empty/nonfinite/outside-sheet/outside-bed geometry, including leads |
| Filenames | Embedded name and uploaded name could differ | Shared ASCII 8-character name, validated before transfer |
| RD import | Machine RD sent to document RLD parser | Absolute/relative vector motion decoder for RD inspection |
| RLD export | Custom archive or scrambled RD with a version string advertised as native RLD | Disabled with an explanation; use DXF for RDWorks |

Malformed bounds and layer record lengths are consistent with the blank preview and incorrect/absent frame behavior. Their correction is verified offline. The precise failure path inside this firmware, and actual LCD/cut behavior after correction, have **not** been verified by running a corrected file.

## Coordinates and supported operations

RD coordinates are micrometers, encoded in five 7-bit big-endian bytes. Speed uses the same five-byte representation in micrometers/second. Powers use two 7-bit bytes across 0…16383. The supplied working files confirm these field widths.

Exports use the production origin corner to choose coordinate direction, then remove the common page offset. All frame, layer and LCD bounds refer to the resulting job-local geometry. Sheet placement is therefore not absolute machine positioning: the controller's current job-origin/positioning mode still determines physical placement. Verify orientation and physical placement before a future run.

Cut, score and vector hatch engraving use the production engine's toolpaths. The exporter rejects pen/timed-dot modes, enabled micro-links, nonzero overcut and repeatCount > 1 rather than silently ignoring them; use Passes for repeated contours. Native raster scan modes are not implemented. Native RLD document serialization is not implemented. RD import recovers geometry only and explicitly warns that layer settings/passes must be reviewed.

## Transport corrections and write protection

The old uploader streamed the same job to both 50201 and 50200, ignored missing ACKs, appended another EOF, then manually rewrote `.filerecord` and run-count files through FTP. It could claim success despite an unacknowledged stream. Editing the filesystem does not prove that the running controller indexed or parsed the job correctly.

The new uploader uses one selected UDP port (default 50201), prefixes download preparation once, sends the RD stream with its embedded filename and existing EOF, and requires scrambled ACK `C6` for every packet. An absent/invalid ACK fails the transfer immediately. It does not retry ambiguous data packets, switch ports, or edit FTP storage/index/statistics. A timeout may leave a partial file; no automatic cleanup command is sent to the controller. An ACK establishes packet acceptance only.

Writes are disabled by default in the bridge and Python uploader. The UI reflects this and initially reports connection state as unknown. TCP reachability is labeled accurately and is not proof of UDP protocol readiness or controller identity. The dev server binds to localhost. Neither test suite contacts the controller; UDP behavior is mocked and bridge write rejection is tested in memory.

For a separately authorized future transfer, the operator can opt in when launching the dev server with `RUIDA_ALLOW_WRITES=1 npm run dev`. The standalone uploader requires `--allow-write`. Neither opt-in was used during this audit. `npm run preview` only serves static files and does not provide the device bridge.

## Verification and local artifacts

Run `npm test` for command-length comparisons with working files, exact square frame/LCD scope comparisons, power/speed/layer/pass/lead checks, invalid-input rejection, RD decoding, read-only bridge enforcement, cipher/checksum and mocked ACK/failure tests. Run `npm run build` for TypeScript and the production bundle.

`corrected/GEN100.rd` and `corrected/GEN100.dxf` are offline examples regenerated from `../genetic-data-svgrepo-com.svg`: **100 mm artwork width**, aspect ratio preserved, one pass, 30 mm/s, laser 1 minimum 30% / maximum 50%, laser 2 off, no leads/kerf. Those are sample parameters, not a material calibration. No file was sent to the cutter. Existing broken files in the workspace and controller have not been replaced; regenerate intended jobs from their source artwork.

The offline CLI now shares the app's production/RD encoder and requires an explicit physical artwork width, avoiding the previous assumption that SVG pixels were millimeters:

```bash
node scripts/convert_svg.mjs ../genetic-data-svgrepo-com.svg corrected/GEN100 --width-mm 100 --speed 30 --power 50 --min-power 30
```

The CLI accepts untransformed paths (M/L/H/V/C/S/Z), rectangles and circles, rejects unsupported geometry, and writes RD plus DXF. Use the app for its broader SVG import support. Further physical verification requires a separately authorized upload and an operator checking LCD design, dimensions, orientation, placement and laser-off frame behavior before any cut. This audit makes no claim of that verification.

## Authorized upload follow-up

After the read-only audit, the user explicitly requested a storage upload and authorized UDP probing. Port 50200 did not acknowledge; port 50201 acknowledged the non-motion handshake and every upload packet. GEN100.RD was stored as index 81. Read-only FTP retrieval returned exactly the local 6,271 bytes (SHA-256 `af0c15cc2a1e17c626b0a60b97de425011ef89a7a3c91156021735c414c70600`). The app, bridge and uploader now default to 50201 for this controller. No job-start, frame or firing command was sent. Physical LCD, frame and cutting behavior still await the operator's check.
