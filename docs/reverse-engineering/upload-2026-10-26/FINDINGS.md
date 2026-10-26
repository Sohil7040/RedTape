# RDWorks upload audit — 26 October 2026

## Boundary and identity

Static, read-only investigation of the user-selected `RDWorksV8/rdcam.dll`, PE32 x86, 942,080 bytes, SHA-256 `f8611d921817fe683d2154e59527d1b7f50ae273325aade9933356fb7f4a99d3`. Export inventory Evidence `ev_9752372d245942b6905f222742c75291631ca3420bf5a57c8856eeef35266b4e`. Ghidra 12.1.4 via REA 6.8.0 supplied function pseudocode. The source DLL's SHA-256 was unchanged after analysis. No vendor code was executed and no cutter connection, command, upload, selection, motion or firing occurred. The owned Ghidra session was closed after exporting `upload-session-evidence.json`.

Pseudocode is decompiler output, not the original C/C++ source. Local assembly supplements corroborate selected byte constants/control flow. This is a narrow library call-chain audit, not a trace of the RDWorks UI or a complete transport implementation recovery.

## Findings

| Question | Static evidence and interpretation | Confidence / remaining boundary |
| --- | --- | --- |
| How does storage download begin? | `RD_StrtDownFile` at `0x10020f20` constructs `E8 02 E7 01 <filename bytes> 00`, allocates filename length + 5, and calls `FUN_10003f70(buffer,length,1)`. | Observed bytes/call; `start-download.json`, Evidence `ev_ae55940c594e781ad455c7c7a209946ef180ca00631b2e8eb02d2bee749501b7`. Corelith's `E8 02` prefix plus existing embedded `E7 01` filename has the same logical sequence. |
| Are commands scrambled and checksummed? | Dispatch wrapper assembly passes encryption enabled to `FUN_10003ea0`; lower sender `FUN_10002bd0` at `0x10002bd0` conditionally transforms every byte via `FUN_10003200`. In its checksum-enabled network branch, it sums transformed bytes modulo 16 bits and prepends high byte then low byte before invoking its socket-send wrapper. The transform's assembly swaps bit 0/7, XORs a global byte and adds 1; the global's initialized byte at `0x10035068` is `88`. | Sender pseudocode observed, Evidence `ev_1780b8e85938a37a9298620276b01dc22e77ab66cc34e552f46553746f6c4499`; `mcp-0x10002bd0-evidence.json`. Transform and default magic are assembly supplements in `check-ack-objdump.txt` and `magic-data-objdump.txt`. This matches Corelith's scramble and sum16 BE framing. Network flags are runtime globals; their actual selected values during a particular RDWorks job are not observed. |
| Does it wait for ACKs or resend ambiguous data? | `FUN_10003ea0` at `0x10003ea0` sends once through `FUN_10002bd0`, then polls `FUN_10003120` while a default 5000-clock-tick budget permits, exiting on success or cancellation. The polling loop does not call the data sender again. | Observed local flow, Evidence `ev_5f2a47eb952b1fb07f76a7dca46cb02cc12f73459ee131cf6e4a6a0c8faf31f2`, `send-dispatch.json`. This does not prove that no higher caller ever retries. Corelith's no-ambiguous-packet-retry behavior is consistent with this local flow. |
| What counts as an ACK? | `FUN_10003120` at `0x10003120` requests one decoded byte from `FUN_10002de0`; `CC` takes the success branch and `CD` maps to status `0x66`. Other receive errors map to distinct statuses. | Observed branch constants, Evidence `ev_e4dcac16e7911c1c0a333f06c7987379162034de04031509bd58ee6863e1d11f`, `mcp-0x10003120-evidence.json`. Decompiled return type is unreliable (assembly shows a returned helper value). Unknown decoded values are not as strictly rejected in this local function as Corelith rejects unexpected packets. For default magic, raw `CC` scrambles to wire `C6`. |
| Does the generic send API append special commands? | `RD_SendCommand` at `0x10020540` passes the supplied buffer and size directly to `FUN_10003f70(...,1)`. No refresh, select or start byte is added by this wrapper. | Observed wrapper only, Evidence `ev_7a0fd0e9fadbb8fd616a758d67e07ca3094081095a9b0452781a4b4f3a6fba57`, `mcp-RD_SendCommand-evidence.json`. Its caller can supply other commands; caller sequence was not recovered. |
| Is `RD_StrtWFile` an additional machine download handshake? | At `0x10005e70`, this export resets encoder buffers, state, counters and precision defaults, storing its supplied output-mode/handle value. It does not build `E8 02` or call the network dispatcher in the recovered body. | Observed function body, Evidence `ev_3ecd8e06bcdfb812f9918267993c49be167b10f3a9eff35232086e1be1914c00`, `mcp-RD_StrtWFile-evidence.json`. It initializes writer state; do not treat its name as proof of a missing on-wire step. |
| Is `RD_wSetDataEnd` the file EOF? | At `0x10007f80`, this export emits `DB` through the writer and clears state. The neighboring exported `RD_wSetFileEnd` at `0x10007ff0` emits `D7` (assembly supplement). They are distinct API operations. | Data-end decompile Evidence `ev_24ca1bcd887f7bb5f7d22bbed71151f5f8c2b3fa50c0394757a6caa750b3800f`, `mcp-RD_wSetDataEnd-evidence.json`; file-end assembly in `writer-end-objdump.txt`. This does not justify appending `DB` to a complete job or another `D7` to Corelith's already-terminated file. |

## Corelith comparison and action

`corelith-studio/ruida_upload.py` was read without alteration. It currently:

1. Validates the embedded `E7 01` filename and existing final `D7`.
2. Uses the saved controller UDP address/port, binds local port 40200 and performs a non-motion `CC` client handshake.
3. Prepends `E8 02` once to the scrambled RD stream, segments it into 1024-byte payloads and attaches a sum16 big-endian checksum.
4. Requires exact scrambled `CC` / wire `C6` for the handshake and each packet; stops on timeout or invalid response, without automatic packet retry or alternate-port upload.
5. Optionally retrieves stored bytes via read-only FTP and compares the exact file contents. It does not rewrite indexes, select a job or start it.

The newly recovered preparation, cipher structure, checksum order and acknowledgment flow support the existing transport. There is **no substantiated protocol repair** from this bounded audit, so the known-working uploader should remain unchanged. Corelith's 1024-byte payload size, fixed local port, initial handshake, timeout and readback are current app/controller-specific choices; this audit does not establish that the RDWorks UI uses those exact choices.

## Still unresolved

- The actual RDWorks UI caller sequence before and after these exports, transfer chunk size, selected networking flags and retry policy above the dispatcher.
- Whether RDWorks sends a separate panel-refresh-only operation, selects a completed file, or merely refreshes its own UI. No new refresh-only command is established here.
- LCD menu refresh, smoothness and physical placement on this specific firmware. Static library analysis cannot verify these outcomes.

A passive capture of an operator-performed RDWorks upload would answer the runtime sequence gaps more directly. Do not add speculative key, file-selection or start commands to imitate a refresh.
