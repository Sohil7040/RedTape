/* Ruida DSP Controller Code (.rd / .udscmd) and RDWorks Document (.rld) Engine.
   Provides binary encoding & decoding for Ruida RDLC laser controllers and
   RDWorks V8 document interchange. */

import { Pt, makeNode, uid, Subpath } from './geometry'
import { DocumentModel, Shape, makeShape, makeFill, makeStroke, RDWORKS_PALETTE } from './model'
import { getProductionJob, toolpathPoints } from './production'
import { scrambleRuidaWasm, unscrambleRuidaWasm } from '../wasm/wasmEngine'

// Ruida controller hardware safety limits audited directly from soft.ini, vpara, and upara
export const RUIDA_HARDWARE_LIMITS = {
  bedWidth: 1220.0, // mm (X-Axis max travel from vpara & soft.ini)
  bedHeight: 915.0, // mm (Y-Axis max travel from vpara & soft.ini)
  maxRapidSpeed: 600.0, // mm/s (AxisMaxVel from vpara)
  safeRapidSpeed: 300.0, // mm/s (Default rapid from upara/soft.ini)
  maxPowerPct: 99.0, // % (Strict maximum power from upara/vpara to protect laser tube)
  minPowerPct: 1.0, // %
  defaultOrigin: 'top-right' as const, // Origin = 2 in soft.ini (Top-Right machine home)
  stepPitchX: 6.325810, // um/pulse
  stepPitchY: 6.323320, // um/pulse
  ruidaPort: 50201, // Upload/handshake port verified on this controller
  defaultDeviceIP: '192.168.1.11', // Verified active Wi-Fi IP on local subnet
}

/** Scramble bytes for disk/USB and native UDP transport. */
export function scrambleRuida(data: Uint8Array): Uint8Array {
  return scrambleRuidaWasm(data)
}

/**
 * Encode 35-bit two's complement scale factors for Ruida LCD preview viewport.
 * ScaleValue = (2^35 - Dimension_um) & ((1 << 35) - 1)
 */
export function encodeRuidaScale5(val: number): number[] {
  const v = ((1n << 35n) - BigInt(Math.max(1, Math.round(val)))) & ((1n << 35n) - 1n)
  return [
    Number((v >> 28n) & 0x7fn),
    Number((v >> 21n) & 0x7fn),
    Number((v >> 14n) & 0x7fn),
    Number((v >> 7n) & 0x7fn),
    Number(v & 0x7fn)
  ]
}

/**
 * Encode absolute coordinates in authentic Ruida 5-byte 7-bit big-endian format.
 * Coordinates are represented in micrometers (1 um = 0.001 mm).
 */
export function encodeRuidaCoord5(val: number): number[] {
  if (!Number.isFinite(val) || val < 0 || val >= 2 ** 35) throw new Error('Invalid Ruida coordinate')
  const v = BigInt(Math.round(val))
  return [28n, 21n, 14n, 7n, 0n].map(shift => Number((v >> shift) & 127n))
}

/**
 * Encode speed as a five-byte, 7-bit big-endian micrometers/sec value.
 * E.g., 30 mm/s = 30,000 um/s -> [0, 0, 1, 0x6a, 0x30]
 */
export function encodeRuidaSpeed(speedMmS: number): number[] {
  if (!Number.isFinite(speedMmS) || speedMmS <= 0 || speedMmS > RUIDA_HARDWARE_LIMITS.maxRapidSpeed) {
    throw new Error('Layer speed must be greater than 0 and at most 600 mm/s')
  }
  return encodeRuidaCoord5(speedMmS * 1000)
}

/**
 * Encode laser power (0..99%) into a 14-bit unsigned int (16383 scale) in 7-bit big-endian format.
 * E.g., 50% -> round(0.5 * 16384) = 8192 -> [0x40, 0x00]
 */
export function encodeRuidaPower(powerPct: number): number[] {
  if (!Number.isFinite(powerPct) || powerPct < 0 || powerPct > RUIDA_HARDWARE_LIMITS.maxPowerPct) {
    throw new Error('Laser power must be between 0 and 99%')
  }
  const p14 = Math.round(powerPct / 100 * 0x3fff)
  return [(p14 >> 7) & 0x7f, p14 & 0x7f]
}

/**
 * Build a complete Ruida controller machine file (.rd / .udscmd).
 * Ready to be sent to Ruida RDPA8445S / RDC6442 / RDC6445 DSP controller or loaded into RDWorks.
 */
export function ruidaFilename(name: string): string {
  const base = name.replace(/\.[^/.]+$/, '').toUpperCase().replace(/[^A-Z0-9_-]/g, '').slice(0, 8)
  if (!base) throw new Error('Use an ASCII file name containing letters or numbers')
  return base
}

export function buildJobRD(doc: DocumentModel, customFilename = doc.name): Uint8Array {
  if (!Number.isFinite(doc.page.width) || !Number.isFinite(doc.page.height) || doc.page.width <= 0 || doc.page.height <= 0) throw new Error('Invalid sheet dimensions')
  if (doc.production.overcut) throw new Error('Ruida overcut is not implemented; set Overcut to 0')
  const job = getProductionJob(doc)
  if (job.errors.length) throw new Error(job.errors.join(' '))
  const paths = job.paths.filter(p => p.operation !== 'ignore' && p.points.length >= 2)
  if (!paths.length) throw new Error('No machinable paths to export')
  const cleanName = ruidaFilename(customFilename)
  // The RDWorks files read from this machine use job-local coordinates. A page-sized
  // offset must not be included in the LCD scope or the machine's frame rectangle.
  const contours = paths.map(path => {
    let points = toolpathPoints(path)
    points = points.filter((p, i, all) => i === 0 ||
      Math.round(p.x * 1000) !== Math.round(all[i - 1].x * 1000) ||
      Math.round(p.y * 1000) !== Math.round(all[i - 1].y * 1000))
    if (points.length < 2) throw new Error('Toolpath collapses at 0.001 mm machine resolution')
    for (const p of points) {
      if (!Number.isFinite(p.x) || !Number.isFinite(p.y) || p.x < 0 || p.y < 0 ||
          p.x > Math.min(doc.page.width, RUIDA_HARDWARE_LIMITS.bedWidth) ||
          p.y > Math.min(doc.page.height, RUIDA_HARDWARE_LIMITS.bedHeight)) {
        throw new Error('Toolpath (including leads) extends outside the sheet or machine bed')
      }
    }
    return { path, points }
  })
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity
  for (const { points } of contours) for (const p of points) {
    x0 = Math.min(x0, p.x); y0 = Math.min(y0, p.y)
    x1 = Math.max(x1, p.x); y1 = Math.max(y1, p.y)
  }
  const origin = doc.production.originCorner
  const mapPt = (p: Pt) => ({
    x: Math.round((origin.endsWith('right') ? x1 - p.x : p.x - x0) * 1000),
    y: Math.round((origin.startsWith('bottom') ? y1 - p.y : p.y - y0) * 1000),
  })
  const width = Math.round((x1 - x0) * 1000), height = Math.round((y1 - y0) * 1000)
  const zero = encodeRuidaCoord5(0)
  const maxX = encodeRuidaCoord5(width), maxY = encodeRuidaCoord5(height)
  const layerIds = [...new Set(paths.map(p => p.layerId))]
  if (layerIds.length > 16) throw new Error('Ruida export supports at most 16 active layers')
  const configs = layerIds.map(id => {
    const op = doc.production.layers?.[id]
    const path = paths.find(p => p.layerId === id)!
    if (op?.microLink || op?.overcut || (op?.repeatCount ?? 1) > 1) throw new Error('Ruida micro-links, overcut and repeatCount are not implemented; use Passes for repeats')
    const min = op?.minPower ?? path.power, max = op?.maxPower ?? path.power
    if (min > max) throw new Error(`${path.layerName}: minimum laser power ${min}% exceeds maximum ${max}%. Open Laser → Layers to correct this layer.`)
    if (!Number.isInteger(path.passes) || path.passes < 1 || path.passes > 100) {
      throw new Error('Pass count must be an integer from 1 to 100')
    }
    if (path.operation === 'pen' || path.operation === 'dot') {
      throw new Error('Pen and timed dot operations are not supported by the Ruida exporter')
    }
    return { speed: encodeRuidaSpeed(path.speed), min: encodeRuidaPower(min),
      max: encodeRuidaPower(max), second: encodeRuidaPower(op?.laser2Power ?? 0), blower: op?.blower !== false }
  })
  const buf: number[] = []
  const emit = (...bytes: number[]) => buf.push(...bytes)
  const pair = (a: number, b: number, x: number[], y: number[]) => emit(a, b, ...x, ...y)
  emit(0xe7, 0x01, ...Array.from(cleanName, c => c.charCodeAt(0)), 0)
  emit(0xd8, 0x10, 0xe7, 0x32, 1, 0x50, 0x28, 0x1e, 9, 1, 0x50, 0x28, 0x1e, 9,
    0xf0, 0xf1, 2, 0, 0xe7, 0x3b, 0x41, 0xd8, 0)
  pair(0xe7, 6, zero, zero)
  emit(0xe7, 0x38, 0)
  pair(0xe7, 3, zero, zero)
  pair(0xe7, 7, maxX, maxY)
  pair(0xe7, 0x50, zero, zero)
  pair(0xe7, 0x51, maxX, maxY)
  emit(0xe7, 4, 0, 1, 0, 1, ...zero, ...zero, 0xe7, 5, 0)
  configs.forEach((cfg, index) => {
    emit(0xc9, 4, index, ...cfg.speed, 0xc6, 0x65, index, 0x3f)
    emit(0xc6, 0x31, index, ...cfg.min, 0xc6, 0x32, index, ...cfg.max)
    emit(0xc6, 0x41, index, ...cfg.second, 0xc6, 0x42, index, ...cfg.second)
    const layer = doc.layers.find(l => l.id === layerIds[index])!
    const color = Number.parseInt(layer.color.replace('#', ''), 16) || 0
    const bgr = ((color & 255) << 16) | (color & 0xff00) | ((color >>> 16) & 255)
    emit(0xca, 6, index, ...encodeRuidaCoord5(bgr), 0xca, 0x41, index, 0)
    let lx0 = Infinity, ly0 = Infinity, lx1 = 0, ly1 = 0
    for (const c of contours.filter(c => c.path.layerId === layerIds[index])) for (const p of c.points) {
      const q = mapPt(p)
      lx0 = Math.min(lx0, q.x); ly0 = Math.min(ly0, q.y)
      lx1 = Math.max(lx1, q.x); ly1 = Math.max(ly1, q.y)
    }
    for (const sub of [0x52, 0x61]) emit(0xe7, sub, index, ...encodeRuidaCoord5(lx0), ...encodeRuidaCoord5(ly0))
    for (const sub of [0x53, 0x62]) emit(0xe7, sub, index, ...encodeRuidaCoord5(lx1), ...encodeRuidaCoord5(ly1))
  })
  emit(0xca, 0x22, configs.length - 1)
  for (const sub of [0x54, 0x55]) for (const index of [0, 1]) emit(0xe7, sub, index, ...zero)
  pair(0xf1, 3, zero, zero)
  emit(0xf1, 0, 0, 0xf1, 1, 0)
  // Feature defaults observed in both working 20MMSQR.RD and CIR.RD readbacks.
  emit(0xf1, 7, 0, 2, 0x69, 0x40, 0x5c, 0x30, 2, 1, 0, 0x40, 0x20)
  emit(0xf2, 0, 0, 0xf2, 2, 2, 0x69, 0x40, 0x5c, 0x30, 2, 1, 0, 0x40, 0x20)
  pair(0xf2, 3, zero, zero)
  pair(0xf2, 4, maxX, maxY)
  const sx = encodeRuidaScale5(width), sy = encodeRuidaScale5(height)
  emit(0xf2, 5, 0, 1, 0, 1, ...sx, ...sy)
  pair(0xf2, 6, zero, zero)
  emit(0xf2, 7, 0)
  pair(0xf2, 8, sx, sy)
  emit(0xe7, 0x0a, ...zero, 0xea, 0, 0xe7, 0x60, 0, 0, 0xe3, 0, 0xe7, 0x0b, 0)
  pair(0xe7, 0x13, zero, zero)
  pair(0xe7, 0x17, maxX, maxY)
  pair(0xe7, 0x23, zero, zero)
  emit(0xe7, 0x24, 0)
  pair(0xe7, 0x37, sx, sy)
  emit(0xe7, 8, 0, 1, 0, 1, ...sx, ...sy)
  let activeLayer = -1, cutLength = 0
  for (const { path, points } of contours) {
    const index = layerIds.indexOf(path.layerId), cfg = configs[index]
    if (index !== activeLayer) {
      emit(0xca, 1, 0, 0xca, 2, index, 0xca, 1, 0x30, 0xca, 1, 0x10)
      emit(0xca, 1, cfg.blower ? 0x13 : 0x12)
      emit(0xc9, 2, ...cfg.speed, 0xc6, 0x12, ...zero, 0xc6, 0x13, ...zero)
      emit(0xc6, 0x50, 0x3f, 0x7f, 0xc6, 0x51, 0, 0)
      emit(0xc6, 1, ...cfg.min, 0xc6, 2, ...cfg.max, 0xc6, 0x21, ...cfg.second, 0xc6, 0x22, ...cfg.second)
      emit(0xca, 3, 0x3f, 0xca, 0x10, 0)
      activeLayer = index
    }
    for (let pass = 0; pass < path.passes; pass++) {
      points.forEach((p, i) => {
        const q = mapPt(p)
        emit(i === 0 ? 0x88 : 0xa8, ...encodeRuidaCoord5(q.x), ...encodeRuidaCoord5(q.y))
        if (i) cutLength += Math.hypot(p.x - points[i - 1].x, p.y - points[i - 1].y)
      })
    }
  }
  emit(0, 0xe4, 0xeb, 0xe7, 0, 0xda, 1, 6, 0x20,
    ...encodeRuidaCoord5(cutLength), ...encodeRuidaCoord5(cutLength), 0xd7)
  return scrambleRuida(new Uint8Array(buf))
}

/**
 * Native RLD serialization is unavailable; never disguise a custom archive as RLD.
 */
export function buildJobRLD(_doc: DocumentModel): Uint8Array {
  throw new Error('Native RDWorks .rld serialization is not implemented. Export DXF and import it in RDWorks.')
}

export interface RLDParseResult {
  shapes: Shape[]
  warnings: string[]
  bed?: { width: number; height: number }
}

/** Recover vector motion for inspection; machine settings are deliberately not imported. */
export function parseRD(data: Uint8Array): RLDParseResult {
  const raw = unscrambleRuidaWasm(data)
  const shapes: Shape[] = [], warnings: string[] = []
  if (raw[0] !== 0xe7 || raw[1] !== 1 || raw[raw.length - 1] !== 0xd7) {
    return { shapes, warnings: ['Invalid or incomplete scrambled RD machine file'] }
  }
  let points: Pt[] = [], cursor: Pt = { x: 0, y: 0 }
  const flush = () => {
    if (points.length > 1) {
      const first = points[0], last = points[points.length - 1]
      const closed = Math.hypot(first.x - last.x, first.y - last.y) < 0.002
      if (closed) points.pop()
      shapes.push(makeShape('path', [{ id: uid('sp'), closed, nodes: points.map(p => makeNode(p.x, p.y)) }], {
        name: `RD contour ${shapes.length + 1}`, fill: makeFill({ type: 'none' }), stroke: makeStroke({ enabled: true, color: '#000000' }),
      }))
    }
    points = []
  }
  const num = (at: number, length: number) => {
    let n = 0
    for (let j = 0; j < length; j++) n = n * 128 + raw[at + j]
    return n
  }
  const rel = (at: number) => { const n = num(at, 2); return (n > 8191 ? n - 16384 : n) / 1000 }
  for (let i = 0; i < raw.length;) {
    const start = i++, op = raw[start]
    while (i < raw.length && raw[i] < 128) i++
    if (![0x88, 0x89, 0x8a, 0x8b, 0xa8, 0xa9, 0xaa, 0xab].includes(op)) continue
    const length = [0x88, 0xa8].includes(op) ? 10 : [0x89, 0xa9].includes(op) ? 4 : 2
    if (i - start - 1 < length) { warnings.push('Truncated motion command'); break }
    let next: Pt
    if (op === 0x88 || op === 0xa8) next = { x: num(start + 1, 5) / 1000, y: num(start + 6, 5) / 1000 }
    else if (op === 0x89 || op === 0xa9) next = { x: cursor.x + rel(start + 1), y: cursor.y + rel(start + 3) }
    else if (op === 0x8a || op === 0xaa) next = { x: cursor.x + rel(start + 1), y: cursor.y }
    else next = { x: cursor.x, y: cursor.y + rel(start + 1) }
    if (op < 0xa0) { flush(); points = [next] }
    else { if (!points.length) points.push(cursor); points.push(next) }
    cursor = next
  }
  flush()
  warnings.push('RD import recovers controller-coordinate geometry only. Review orientation, layer settings and passes before exporting a new job.')
  return { shapes, warnings }
}

function isNormalCoord(v: number): boolean {
  return Number.isFinite(v) && (v === 0 || Math.abs(v) >= 0.01) && Math.abs(v) <= 5000
}

/**
 * Universal RDWorks (.rld) parser.
 * Supports native RDWorks V8 MFC document format, Pascal-length prefixed headers,
 * and Corelith interchange format.
 */
export function parseRLD(data: Uint8Array): RLDParseResult {
  const warnings: string[] = []
  const shapes: Shape[] = []

  if (data.byteLength < 32) {
    warnings.push('RLD file too short.')
    return { shapes, warnings }
  }

  // Scan first 256 bytes for RDFILEVER header signature
  const headLen = Math.min(data.byteLength, 256)
  const headText = new TextDecoder('latin1').decode(data.slice(0, headLen))
  const verIdx = headText.indexOf('RDFILEVER')

  if (verIdx === -1) {
    warnings.push('File is missing RDFILEVER header.')
    return { shapes, warnings }
  }

  const verString = headText.slice(verIdx, verIdx + 15)
  const view = new DataView(data.buffer, data.byteOffset, data.byteLength)

  // Try extracting machine bed dimensions
  let bed: { width: number; height: number } | undefined
  for (let p = verIdx + 15; p <= Math.min(verIdx + 64, data.byteLength - 16); p += 2) {
    const w = view.getFloat64(p, true)
    const h = view.getFloat64(p + 8, true)
    if (w >= 100 && w <= 3000 && h >= 100 && h <= 3000) {
      bed = { width: Math.round(w), height: Math.round(h) }
      break
    }
  }

  // Strategy 1: Attempt structured reader (Corelith interchange format)
  let structuredParsed = false
  const structOffset = verIdx + 16 // skip RDFILEVER8.0.01 plus 1 byte
  if (structOffset + 36 <= data.byteLength) {
    try {
      let offset = structOffset
      // Check if page dims were written
      const potW = view.getFloat64(offset, true)
      const potH = view.getFloat64(offset + 8, true)
      if (potW > 100 && potW < 3000 && potH > 100 && potH < 3000) {
        offset += 16
      }
      // Check global bounds
      offset += 32 // skip minX, maxX, minY, maxY
      const count = view.getInt32(offset, true)
      offset += 4

      if (count > 0 && count < 5000 && offset + count * 30 <= data.byteLength) {
        for (let s = 0; s < count; s++) {
          if (offset + 42 > data.byteLength) break
          const _elemType = view.getInt16(offset, true); offset += 2
          const layerIdx = view.getInt16(offset, true); offset += 2
          const _flags = view.getInt16(offset, true); offset += 2
          offset += 32 // skip bounds

          const subpathCount = view.getInt32(offset, true); offset += 4
          const subpaths: Subpath[] = []

          for (let sp = 0; sp < subpathCount; sp++) {
            if (offset + 6 > data.byteLength) break
            const closed = view.getInt16(offset, true) !== 0; offset += 2
            const nodeCount = view.getInt32(offset, true); offset += 4
            const nodes = []

            for (let n = 0; n < nodeCount; n++) {
              if (offset + 48 > data.byteLength) break
              const x = view.getFloat64(offset, true); offset += 8
              const y = view.getFloat64(offset, true); offset += 8
              const cinX = view.getFloat64(offset, true); offset += 8
              const cinY = view.getFloat64(offset, true); offset += 8
              const coutX = view.getFloat64(offset, true); offset += 8
              const coutY = view.getFloat64(offset, true); offset += 8

              const node = makeNode(x, y)
              if (Math.hypot(cinX - x, cinY - y) > 1e-3) node.in = { x: cinX, y: cinY }
              if (Math.hypot(coutX - x, coutY - y) > 1e-3) node.out = { x: coutX, y: coutY }
              nodes.push(node)
            }
            if (nodes.length > 0) subpaths.push({ id: uid('sp'), closed, nodes })
          }

          if (subpaths.length > 0) {
            const color = RDWORKS_PALETTE[Math.max(0, Math.min(15, layerIdx))] || '#ff6b3d'
            shapes.push(makeShape('path', subpaths, {
              name: `RD Curve ${s + 1}`,
              fill: makeFill({ type: 'none' }),
              stroke: makeStroke({ enabled: true, color, width: 0.35 }),
            }))
          }
        }
        if (shapes.length > 0) structuredParsed = true
      }
    } catch {
      // Fall through to Strategy 2
    }
  }

  // Strategy 2: Universal RDWorks V8 MFC Curve Scanner
  if (!structuredParsed || shapes.length === 0) {
    let pos = 36
    let shapeIndex = 0

    while (pos < data.byteLength - 48) {
      const d0 = view.getFloat64(pos, true)
      const d1 = view.getFloat64(pos + 8, true)
      const d2 = view.getFloat64(pos + 16, true)
      const d3 = view.getFloat64(pos + 24, true)

      if (isNormalCoord(d0) && isNormalCoord(d1) && isNormalCoord(d2) && isNormalCoord(d3)) {
        let b: { minX: number; maxX: number; minY: number; maxY: number } | null = null

        // minX, maxX, minY, maxY
        if (d0 >= 0 && d1 > d0 + 0.2 && d2 >= 0 && d3 > d2 + 0.2) {
          b = { minX: d0, maxX: d1, minY: d2, maxY: d3 }
        }
        // minX, minY, maxX, maxY
        else if (d0 >= 0 && d2 > d0 + 0.2 && d1 >= 0 && d3 > d1 + 0.2) {
          b = { minX: d0, maxX: d2, minY: d1, maxY: d3 }
        }

        if (b && b.maxX <= 2500 && b.maxY <= 2500) {
          const pts: Pt[] = []
          let pCur = pos + 32
          const scanLimit = Math.min(data.byteLength - 16, pos + 1200)

          while (pCur < scanLimit) {
            const px = view.getFloat64(pCur, true)
            const py = view.getFloat64(pCur + 8, true)

            if (isNormalCoord(px) && isNormalCoord(py) &&
                px >= b.minX - 0.2 && px <= b.maxX + 0.2 &&
                py >= b.minY - 0.2 && py <= b.maxY + 0.2) {
              if (!pts.length || Math.hypot(pts[pts.length - 1].x - px, pts[pts.length - 1].y - py) > 0.005) {
                pts.push({ x: px, y: py })
              }
              pCur += 16
            } else {
              if (pts.length >= 2) break
              pCur += 8
            }
          }

          if (pts.length >= 2) {
            shapeIndex++
            const closed = Math.hypot(pts[0].x - pts[pts.length - 1].x, pts[0].y - pts[pts.length - 1].y) < 0.1
            const nodes = pts.map(p => makeNode(p.x, p.y))
            const subpath: Subpath = { id: uid('sp'), closed, nodes }
            const color = RDWORKS_PALETTE[shapeIndex % 16] || '#ff6b3d'

            shapes.push(makeShape('path', [subpath], {
              name: `RD Object ${shapeIndex}`,
              fill: makeFill({ type: 'none' }),
              stroke: makeStroke({ enabled: true, color, width: 0.35 }),
            }))

            pos = pCur
            continue
          }
        }
      }
      pos += 4
    }
  }

  if (shapes.length === 0) {
    warnings.push(`Verified ${verString} format, but no vector paths could be recovered.`)
  }

  return { shapes, warnings, bed }
}
