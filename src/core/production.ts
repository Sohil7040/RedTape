/* Production / laser job engine
   Converts visible document geometry to ordered toolpaths with kerf
   compensation, lead-ins, engrave hatching and machine time estimates. */
import {
  Bounds, Pt, clone, dist, polygonArea, polylineLength,
  unionBounds,
} from './geometry'
import {
  DocumentModel, LayerOperation, OPERATION_COLORS, ProductionMode, Shape,
  layerOperation, shapeBounds, textBoxFor,
} from './model'
import { generateHatchWasm, optimizeTourWasm, isWasmActive } from '../wasm/wasmEngine'
import { flattenMachiningSubpath } from './machiningCurves'

export interface Toolpath {
  id: string
  shapeId: string
  shapeName: string
  layerId: string
  layerName: string
  subpathIndex: number
  operation: ProductionMode
  color: string
  points: Pt[]
  closed: boolean
  isHatch: boolean
  leadIn: Pt[]
  leadOut: Pt[]
  length: number
  cutLength: number
  time: number
  order: number
  bounds: Bounds
  speed: number
  power: number
  passes: number
  blower?: boolean
}

export interface ModeStats {
  mode: ProductionMode
  paths: number
  length: number
  time: number
  color: string
}
export interface LayerStats {
  layerId: string
  layerName: string
  operation: LayerOperation
  paths: number
  length: number
  time: number
  color: string
  modes: ProductionMode[]
}
export interface ProductionJob {
  paths: Toolpath[]
  totalLength: number
  totalTime: number
  rapidLength: number
  bounds: Bounds
  byMode: ModeStats[]
  byLayer: LayerStats[]
  warnings: string[]
  errors: string[]
  rapidSpeed: number
  contourCount: number
  hatchCount: number
  objectCount: number
}

const cache = new WeakMap<DocumentModel, ProductionJob>()

export function getProductionJob(doc: DocumentModel): ProductionJob {
  const hit = cache.get(doc)
  if (hit) return hit
  const job = buildProductionJob(doc)
  cache.set(doc, job)
  return job
}

export function buildProductionJob(doc: DocumentModel): ProductionJob {
  const prod = doc.production
  const warnings: string[] = []
  const errors: string[] = []
  const raw: Omit<Toolpath, 'order' | 'leadIn' | 'leadOut' | 'time'>[] = []
  const modeOrder: Record<ProductionMode, number> = { dot: 0, pen: 1, engrave: 2, score: 3, cut: 4, ignore: 5 }
  let objectCount = 0
  let hatchBudget = 2000
  let hatchLimited = false
  let skippedText = 0
  const leadMode = prod.leadMode ?? 'contour-only'
  if (!['contour-only', 'outer-only', 'all'].includes(leadMode)) errors.push('Invalid lead mode.')
  for (const key of ['kerf', 'leadIn', 'leadOut', 'rapidSpeed', 'startX', 'startY', 'hatchSpacing'] as const) {
    if (!Number.isFinite(prod[key]) || prod[key] < 0 || (key === 'rapidSpeed' && prod[key] === 0)) errors.push(`Invalid job setting: ${key}.`)
  }

  for (const layer of doc.layers) {
    if (!layer.visible) continue
    const layerOp = layerOperation(prod, layer.id)
    if (layerOp.mode === 'ignore') continue
    if (!['cut','score','engrave','dot','pen'].includes(layerOp.mode) || [layerOp.speed,layerOp.power,layerOp.passes].some(v => !Number.isFinite(v))) { errors.push(`${layer.name}: invalid process settings.`); continue }
    for (const shape of layer.shapes) {
      const textInfill = shape.textInfill?.enabled && (shape.kind === 'text' || typeof shape.meta?.originalText === 'string')
      const op = textInfill ? { ...layerOp, mode: 'engrave' as const, scanInterval: shape.textInfill!.spacing } : layerOp
      if (shape.hidden) continue
      if (shape.opacity === 0) { errors.push(`${shape.name}: fully transparent artwork must be hidden or removed before laser export.`); continue }
      if (shape.kind === 'text') { skippedText++; continue }
      if (shape.clip?.length) { errors.push(`${shape.name}: convert or extract its clipping path before laser export.`); continue }
      if (shape.subpaths.some(sub => sub.nodes.some(n => [n, n.in, n.out].some(p => p && (!Number.isFinite(p.x) || !Number.isFinite(p.y)))))) { errors.push(`${shape.name}: invalid geometry coordinates.`); continue }
      const fillPolygons: Pt[][] = []
      objectCount++
      for (let si = 0; si < shape.subpaths.length; si++) {
        const sub = shape.subpaths[si]
        let pts: Pt[]
        try { pts = flattenMachiningSubpath(sub) }
        catch(error) { errors.push(`${shape.name}: ${error instanceof Error ? error.message : 'Could not prepare machining curve'}`); continue }
        if (pts.length < 2) continue
        // The machining flattener already removes the duplicated closure.
        // A nearby distinct vertex can be an intentional small feature.
        if (sub.closed && prod.kerf > 0 && prod.kerfMode !== 'center' && (op.mode === 'cut' || op.mode === 'score')) {
          pts = offsetClosedPolyline(pts, (prod.kerfMode === 'outside' ? 1 : -1) * prod.kerf / 2)
        }
        // Preserve all retained curve vertices and intentional small features.
        // The old distance-only 0.03 mm filter changed geometry without a
        // deviation bound and could remove the very points needed for curves.

        // Dot mode: generate stipple points
        if (op.mode === 'dot') {
          const dotInterval = Math.max(0.5, op.dotInterval || 2.0)
          const dotPts = samplePointsAlong(pts, dotInterval, sub.closed)
          for (let di = 0; di < dotPts.length; di++) {
            const dp = dotPts[di]
            raw.push({
              id: `${shape.id}:${si}:d${di}`, shapeId: shape.id, shapeName: shape.name, layerId: layer.id, layerName: layer.name,
              subpathIndex: si, operation: 'dot', color: layer.color, points: [dp, { x: dp.x + 0.05, y: dp.y }], closed: false,
              isHatch: false, length: 0.05, cutLength: 0.05, speed: op.speed, power: op.maxPower ?? op.power, passes: op.passes, blower: op.blower, bounds: { x: dp.x, y: dp.y, w: 0.1, h: 0.1 },
            })
          }
          continue
        }

        if (sub.closed) fillPolygons.push(pts)
        const length = contourLength(pts, sub.closed)
        const b = boundsOf(pts)
        raw.push({
          id: `${shape.id}:${si}`, shapeId: shape.id, shapeName: shape.name, layerId: layer.id, layerName: layer.name,
          subpathIndex: si, operation: op.mode, color: layer.color, points: pts, closed: sub.closed,
          isHatch: shape.meta?.bitmapEngraving === true && op.mode === 'engrave' && !sub.closed, length, cutLength: length, speed: op.speed, power: op.maxPower ?? op.power, passes: op.passes, blower: op.blower, bounds: b,
        })
      }
      // Hatch the entire compound fill once, preserving holes and fill winding.
      if (op.mode === 'engrave' && (prod.hatchEngrave || textInfill) && shape.fill.type !== 'none' && fillPolygons.length) {
        const spacing = Math.max(0.02, op.scanInterval ?? prod.hatchSpacing)
        if (!Number.isFinite(spacing)) { errors.push(`${shape.name}: invalid hatch spacing.`); continue }
        const segs = hatchPolygons(fillPolygons, spacing, shape.fillRule, hatchBudget + 1)
        for (const seg of segs) {
          if (hatchBudget <= 0) { hatchLimited = true; break }
          hatchBudget--
          const segLength = polylineLength(seg)
          if (segLength < 0.001) continue
          raw.push({
            id: `${shape.id}:h${hatchBudget}`, shapeId: shape.id, shapeName: shape.name, layerId: layer.id, layerName: layer.name,
            subpathIndex: 0, operation: op.mode, color: layer.color, points: seg, closed: false,
            isHatch: true, length: segLength, cutLength: segLength, speed: op.speed, power: op.maxPower ?? op.power,
            passes: op.passes, blower: op.blower, bounds: boundsOf(seg),
          })
        }
      }
    }
  }

  if (skippedText > 0) errors.push(`${skippedText} text object${skippedText > 1 ? 's were' : ' was'} skipped. Convert text to curves before machining.`)
  if (hatchLimited) errors.push('Hatch generation reached the safety limit — increase the layer scan interval or disable engrave fills.')
  if (!raw.length) warnings.push('No machinable paths. Assign a Cut, Engrave or Score operation to a layer with vector geometry.')
  const openCuts = raw.filter(p => p.operation === 'cut' && !p.closed && !p.isHatch).length
  if (openCuts > 0) warnings.push(`${openCuts} open cut path${openCuts > 1 ? 's' : ''} — auto-close is not applied to open contours.`)
  const hasCut = raw.some(p => p.operation === 'cut')
  if (raw.length && !hasCut) warnings.push('No Cut operation is mapped. The job will mark material but not separate parts.')
  const outside = raw.filter(p => p.bounds.x < -0.01 || p.bounds.y < -0.01 || p.bounds.x + p.bounds.w > doc.page.width + 0.01 || p.bounds.y + p.bounds.h > doc.page.height + 0.01).length
  if (outside > 0) warnings.push(`${outside} path${outside > 1 ? 's extend' : ' extends'} beyond the sheet envelope.`)

  // Group by operation mode
  const ordered: typeof raw = []
  let cursor = { x: prod.startX, y: prod.startY }

  // Inside-out hierarchy resolution for cut contours (RDWorks standard)
  const cutItems = raw.filter(p => p.operation === 'cut')
  const depths = new Map<typeof raw[0], number>()
  if (prod.insideOut) {
    for (const a of cutItems) {
      let d = 0
      for (const b of cutItems) {
        if (a !== b && isContourInside(a, b)) d++
      }
      depths.set(a, d)
    }
  }

  if (prod.optimizeOrder) {
    const groups = new Map<ProductionMode, typeof raw>()
    for (const p of raw) {
      const arr = groups.get(p.operation) ?? []
      arr.push(p)
      groups.set(p.operation, arr)
    }
    for (const mode of ['dot', 'pen', 'engrave', 'score', 'cut'] as ProductionMode[]) {
      let remaining = [...(groups.get(mode) ?? [])]
      if (mode === 'cut' && prod.insideOut) {
        // Sort highest depth (inner holes) first
        remaining.sort((a, b) => (depths.get(b) ?? 0) - (depths.get(a) ?? 0))
      }
      while (remaining.length) {
        let bestIdx = 0, bestDist = Infinity, bestReverse = false, bestStart = 0
        const targetDepth = mode === 'cut' && prod.insideOut ? (depths.get(remaining[0]) ?? 0) : undefined
        for (let i = 0; i < remaining.length; i++) {
          const p = remaining[i]
          if (targetDepth !== undefined && (depths.get(p) ?? 0) !== targetDepth) break
          let startIndex = 0
          if (p.closed) for (let j = 1; j < p.points.length; j++) {
            if (dist(cursor, p.points[j]) < dist(cursor, p.points[startIndex])) startIndex = j
          }
          const dStart = dist(cursor, p.points[startIndex])
          const dEnd = p.closed ? Infinity : dist(cursor, p.points[p.points.length - 1])
          if (dStart < bestDist) { bestDist = dStart; bestIdx = i; bestReverse = false; bestStart = startIndex }
          if (dEnd < bestDist) { bestDist = dEnd; bestIdx = i; bestReverse = true; bestStart = 0 }
        }
        const p = remaining.splice(bestIdx, 1)[0]
        if (bestReverse && !p.closed) p.points = [...p.points].reverse()
        if (p.closed && bestStart) p.points = [...p.points.slice(bestStart), ...p.points.slice(0, bestStart)]
        p.bounds = boundsOf(p.points)
        ordered.push(p)
        cursor = p.closed ? p.points[0] : p.points[p.points.length - 1]
      }
    }
  } else {
    ordered.push(...[...raw].sort((a,b) => modeOrder[a.operation] - modeOrder[b.operation] ||
      (prod.insideOut && a.operation === 'cut' ? (depths.get(b) ?? 0) - (depths.get(a) ?? 0) : 0)))
  }

  const paths: Toolpath[] = []
  let rapidLength = 0
  let previousEnd: Pt = { x: prod.startX, y: prod.startY }
  for (let i = 0; i < ordered.length; i++) {
    const p = ordered[i]
    let leadIn: Pt[] = []
    let leadOut: Pt[] = []
    const start = p.points[0]
    const allowLeads = leadMode === 'all' || (leadMode === 'outer-only' &&
      !raw.some(other => other !== p && (other.operation === 'cut' || other.operation === 'score') && isContourInside(p, other)))
    if (allowLeads && p.closed && p.length > 0.4) {
      const n1 = p.points[1] ?? start
      const n0 = p.points[p.points.length - 1] ?? start
      let tx = n1.x - n0.x, ty = n1.y - n0.y
      const tl = Math.hypot(tx, ty) || 1
      tx /= tl; ty /= tl
      if (prod.leadIn > 0 && (p.operation === 'cut' || p.operation === 'score')) {
        leadIn = [{ x: start.x - tx * prod.leadIn, y: start.y - ty * prod.leadIn }, clone(start)]
      }
      if (prod.leadOut > 0 && (p.operation === 'cut' || p.operation === 'score')) {
        leadOut = [clone(start), { x: start.x + tx * prod.leadOut, y: start.y + ty * prod.leadOut }]
      }
    }
    const leadLength = leadIn.length + leadOut.length ? polylineLength(leadIn) + polylineLength(leadOut) : 0
    const length = p.length + leadLength
    const time = p.speed > 0 ? (length * Math.max(1, p.passes)) / p.speed : 0
    const motionPoints = toolpathPoints({ ...p, leadIn, leadOut })
    rapidLength += dist(previousEnd, motionPoints[0])
    rapidLength += Math.max(0, p.passes - 1) * dist(motionPoints[motionPoints.length - 1], motionPoints[0])
    previousEnd = motionPoints[motionPoints.length - 1]
    paths.push({
      ...p,
      leadIn, leadOut, length, time, order: i + 1,
      bounds: boundsOf(motionPoints),
    })
  }
  const rapidSpeed = Math.max(50, prod.rapidSpeed || 300)
  const rapidTime = rapidLength / rapidSpeed
  const totalLength = paths.reduce((n, p) => n + p.length * Math.max(1, p.passes), 0)
  const totalTime = paths.reduce((n, p) => n + p.time, 0) + rapidTime
  const bounds = paths.length ? unionBounds(paths.map(p => p.bounds)) : { x: 0, y: 0, w: 0, h: 0 }

  const byModeMap = new Map<ProductionMode, ModeStats>()
  const byLayerMap = new Map<string, LayerStats>()
  for (const p of paths) {
    const m = byModeMap.get(p.operation) ?? { mode: p.operation, paths: 0, length: 0, time: 0, color: p.color }
    m.paths++; m.length += p.length * Math.max(1, p.passes); m.time += p.time
    byModeMap.set(p.operation, m)
    const op = layerOperation(prod, p.layerId)
    const l = byLayerMap.get(p.layerId) ?? { layerId: p.layerId, layerName: p.layerName, operation: op, paths: 0, length: 0, time: 0, color: p.color, modes: [] }
    if (!l.modes.includes(p.operation)) l.modes.push(p.operation)
    l.paths++; l.length += p.length * Math.max(1, p.passes); l.time += p.time
    byLayerMap.set(p.layerId, l)
  }

  return {
    paths, totalLength, totalTime, rapidLength, bounds,
    byMode: [...byModeMap.values()],
    byLayer: [...byLayerMap.values()],
    warnings, errors, rapidSpeed,
    contourCount: paths.filter(p => !p.isHatch).length,
    hatchCount: paths.filter(p => p.isHatch).length,
    objectCount,
  }
}

export interface JobTimeEstimate {
  available: boolean
  baselineSeconds: number
  burnSeconds: number
  travelSeconds: number
  allowanceSeconds: number
  allowancePct: number
  estimatedSeconds: number
  byOperation: { mode: ProductionMode; seconds: number }[]
  byLayer: { layerId: string; name: string; operation: ProductionMode | 'mixed'; speed: number; passes: number; seconds: number }[]
}

/** Geometry-based duration. Allowance changes only the displayed estimate. */
export function estimateJobTime(job: ProductionJob, allowancePct = 0): JobTimeEstimate {
  const pct = Number.isFinite(allowancePct) ? Math.min(300, Math.max(0, allowancePct)) : 0
  const burnSeconds = job.paths.reduce((seconds, path) => seconds + path.time, 0)
  const travelSeconds = job.rapidSpeed > 0 ? job.rapidLength / job.rapidSpeed : 0
  const baselineSeconds = burnSeconds + travelSeconds
  const allowanceSeconds = baselineSeconds * pct / 100
  const available = job.paths.length > 0 && job.errors.length === 0 && Number.isFinite(baselineSeconds)
  return {
    available, baselineSeconds, burnSeconds, travelSeconds, allowanceSeconds, allowancePct: pct,
    estimatedSeconds: baselineSeconds + allowanceSeconds,
    byOperation: job.byMode.map(group => ({ mode: group.mode, seconds: group.time })),
    byLayer: job.byLayer.map(layer => ({ layerId: layer.layerId, name: layer.layerName,
      operation: layer.modes.length > 1 ? 'mixed' : layer.modes[0] ?? layer.operation.mode, speed: layer.operation.speed, passes: layer.operation.passes, seconds: layer.time })),
  }
}

/* Geometry helpers --------------------------------------------------------- */

function contourLength(points: Pt[], closed: boolean): number {
  if (points.length < 2) return 0
  let l = 0
  for (let i = 1; i < points.length; i++) l += dist(points[i - 1], points[i])
  if (closed) l += dist(points[points.length - 1], points[0])
  return l
}

function boundsOf(points: Pt[]): Bounds {
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity
  for (const p of points) { minX = Math.min(minX, p.x); minY = Math.min(minY, p.y); maxX = Math.max(maxX, p.x); maxY = Math.max(maxY, p.y) }
  if (!Number.isFinite(minX)) return { x: 0, y: 0, w: 0, h: 0 }
  return { x: minX, y: minY, w: maxX - minX, h: maxY - minY }
}

function dedupe(points: Pt[]): Pt[] {
  const out: Pt[] = []
  for (const p of points) if (!out.length || dist(out[out.length - 1], p) > 1e-5) out.push(p)
  if (out.length > 1 && dist(out[0], out[out.length - 1]) < 1e-5) out.pop()
  return out
}

export function offsetClosedPolyline(points: Pt[], distance: number): Pt[] {
  const pts = dedupe(points)
  if (pts.length < 3 || Math.abs(distance) < 1e-6) return pts
  const area = polygonArea(pts)
  if (area < 0) pts.reverse()
  const n = pts.length
  const edgeNormals: Pt[] = []
  for (let i = 0; i < n; i++) {
    const a = pts[i], b = pts[(i + 1) % n]
    const dx = b.x - a.x, dy = b.y - a.y
    const len = Math.hypot(dx, dy) || 1
    // right normal points outward for CCW polygons
    edgeNormals.push({ x: dy / len, y: -dx / len })
  }
  const out: Pt[] = []
  for (let i = 0; i < n; i++) {
    const prev = edgeNormals[(i - 1 + n) % n]
    const curr = edgeNormals[i]
    let mx = prev.x + curr.x, my = prev.y + curr.y
    const ml = Math.hypot(mx, my)
    if (ml < 1e-6) { out.push({ x: pts[i].x + curr.x * distance, y: pts[i].y + curr.y * distance }); continue }
    mx /= ml; my /= ml
    const denom = mx * curr.x + my * curr.y
    const scale = distance / Math.max(0.15, denom)
    const clampScale = Math.sign(scale) * Math.min(Math.abs(scale), Math.abs(distance) * 5)
    out.push({ x: pts[i].x + mx * clampScale, y: pts[i].y + my * clampScale })
  }
  return out
}

export function hatchPolygon(points: Pt[], spacing: number): Pt[][] {
  return hatchPolygons([points], spacing, 'evenodd')
}

export function hatchPolygons(polygons: Pt[][], spacing: number, rule: CanvasFillRule = 'evenodd', limit = 2001): Pt[][] {
  const rings = polygons.map(dedupe).filter(p => p.length >= 3)
  if (!rings.length || !Number.isFinite(spacing) || spacing <= 0) return []
  const b = boundsOf(rings.flat())
  const lines: Pt[][] = []
  const step = Math.max(0.02, spacing)
  // Bound pathological scans even for malformed imported polygons.
  const scans = Math.min(100000, Math.ceil(b.h / step))
  for (let scan = 0; scan < scans; scan++) {
    const y = b.y + (scan + 0.5) * step
    if (y >= b.y + b.h) break
    const events: { x: number; winding: number }[] = []
    for (const pts of rings) for (let i = 0; i < pts.length; i++) {
      const a = pts[i], c = pts[(i + 1) % pts.length]
      if ((a.y <= y && c.y > y) || (c.y <= y && a.y > y)) {
        events.push({ x: a.x + (c.x - a.x) * (y - a.y) / (c.y - a.y), winding: c.y > a.y ? 1 : -1 })
      }
    }
    events.sort((a,c) => a.x - c.x)
    let winding = 0, previousX = 0
    for (const event of events) {
      if ((rule === 'evenodd' ? Math.abs(winding) % 2 === 1 : winding !== 0) && event.x - previousX > 0.001) {
        const segment = [{ x: previousX, y }, { x: event.x, y }]
        lines.push(scan % 2 ? segment.reverse() : segment)
        if (lines.length >= limit) return lines
      }
      winding += event.winding
      previousX = event.x
    }
  }
  return lines
}

/** Exact ordered burn vertices shared by RD, DXF, PLT, estimates and simulation. */
export function toolpathPoints(path: Pick<Toolpath, 'points' | 'closed' | 'leadIn' | 'leadOut'>): Pt[] {
  const points = [...path.leadIn, ...path.points]
  if (path.closed && path.points.length) points.push(path.points[0])
  points.push(...path.leadOut)
  return points.filter((p,i) => i === 0 || dist(p, points[i-1]) > 1e-7)
}

export interface NestPlacement {
  shape: Shape
  x: number
  y: number
  rotated: boolean
  w: number
  h: number
}
export interface NestResult {
  placements: NestPlacement[]
  overflow: number
  usedWidth: number
  usedHeight: number
}

/** Shelf-packing nest for job objects inside the artboard with margin/spacing. */
export function nestShapes(shapes: Shape[], sheetW: number, sheetH: number, margin: number, spacing: number, allowRotate: boolean): NestResult {
  const items = shapes.map(shape => {
    const b = shapeBounds(shape)
    return { shape, w: b.w, h: b.h }
  }).sort((a, b) => (b.w * b.h) - (a.w * a.h))
  const placements: NestPlacement[] = []
  let x = margin, y = margin, shelfH = 0, usedWidth = 0, usedHeight = 0, overflow = 0
  const maxX = sheetW - margin, maxY = sheetH - margin
  for (const item of items) {
    const options = [{ w: item.w, h: item.h, rotated: false }]
    if (allowRotate && item.shape.kind !== 'text' && Math.abs(item.w - item.h) > 0.05) options.push({ w: item.h, h: item.w, rotated: true })
    let chosen = options.find(o => x + o.w <= maxX + 1e-6 && y + o.h <= maxY + 1e-6)
    if (!chosen) {
      const nextY = y + shelfH + (shelfH > 0 ? spacing : 0)
      chosen = options.find(o => margin + o.w <= maxX + 1e-6 && nextY + o.h <= maxY + 1e-6)
      if (chosen) { y = nextY; x = margin; shelfH = 0 }
    }
    if (!chosen) { overflow++; continue }
    placements.push({ shape: item.shape, x, y, rotated: chosen.rotated, w: chosen.w, h: chosen.h })
    x += chosen.w + spacing
    shelfH = Math.max(shelfH, chosen.h)
    usedWidth = Math.max(usedWidth, x - spacing)
    usedHeight = Math.max(usedHeight, y + chosen.h)
  }
  return { placements, overflow, usedWidth, usedHeight }
}

export function productionSummary(job: ProductionJob): { contours: number; hatches: number; objects: number; util: number } {
  return { contours: job.contourCount, hatches: job.hatchCount, objects: job.objectCount, util: job.paths.length ? job.totalLength : 0 }
}

export function formatDuration(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds <= 0) return '0s'
  if (seconds < 60) return `${Math.round(seconds)}s`
  const rounded = Math.round(seconds)
  const m = Math.floor(rounded / 60), s = rounded % 60
  if (m < 60) return `${m}m ${s.toString().padStart(2, '0')}s`
  const h = Math.floor(m / 60)
  return `${h}h ${(m % 60).toString().padStart(2, '0')}m`
}

/* ── RDWorks Geometry Helpers ───────────────────────────────────── */

function pointInPoly(pt: Pt, poly: Pt[]): boolean {
  let inside = false
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const xi = poly[i].x, yi = poly[i].y
    const xj = poly[j].x, yj = poly[j].y
    const intersect = ((yi > pt.y) !== (yj > pt.y)) && (pt.x < ((xj - xi) * (pt.y - yi)) / (yj - yi) + xi)
    if (intersect) inside = !inside
  }
  return inside
}

function isContourInside(a: { bounds: Bounds; points: Pt[]; closed: boolean }, b: { bounds: Bounds; points: Pt[]; closed: boolean }): boolean {
  if (!a.closed || !b.closed) return false
  if (a.bounds.x < b.bounds.x || a.bounds.y < b.bounds.y ||
      a.bounds.x + a.bounds.w > b.bounds.x + b.bounds.w ||
      a.bounds.y + a.bounds.h > b.bounds.y + b.bounds.h) {
    return false
  }
  if (!a.points.length || !b.points.length) return false
  return pointInPoly(a.points[0], b.points)
}

function samplePointsAlong(pts: Pt[], interval: number, closed: boolean): Pt[] {
  if (!pts.length) return []
  const out: Pt[] = [{ x: pts[0].x, y: pts[0].y }]
  let distAccum = 0
  const full = closed ? [...pts, pts[0]] : pts

  for (let i = 1; i < full.length; i++) {
    const p0 = full[i - 1], p1 = full[i]
    const d = dist(p0, p1)
    if (d < 1e-4) continue

    let curD = 0
    while (distAccum + (d - curD) >= interval) {
      const step = interval - distAccum
      curD += step
      const t = curD / d
      out.push({ x: p0.x + (p1.x - p0.x) * t, y: p0.y + (p1.y - p0.y) * t })
      distAccum = 0
    }
    distAccum += (d - curD)
  }
  return out
}

interface SimSegment {
  from: Pt; to: Pt; duration: number; end: number; laserOn: boolean
  speed: number; power: number; blower: boolean; pathIndex: number
}
const simulationCache = new WeakMap<ProductionJob, { key: string; segments: SimSegment[]; duration: number }>()
export function getSimulationStateAt(job: ProductionJob, progress: number, startPt: Pt = { x: 0, y: 0 }) {
  const p = Math.max(0, Math.min(1, progress))
  const key = `${startPt.x}:${startPt.y}`
  let timeline = simulationCache.get(job)
  if (!timeline || timeline.key !== key) {
    const segments: SimSegment[] = []
    let cursor = startPt, duration = 0
    const add = (to: Pt, laserOn: boolean, path: Toolpath, pathIndex: number) => {
      const speed = laserOn ? path.speed : job.rapidSpeed
      const distance = dist(cursor, to)
      if (distance > 1e-7 && speed > 0) {
        const seconds = distance / speed
        duration += seconds
        segments.push({ from: cursor, to, duration: seconds, end: duration, laserOn,
          speed, power: laserOn ? path.power : 0, blower: laserOn && path.blower !== false, pathIndex })
      }
      cursor = to
    }
    job.paths.forEach((path, index) => {
      const points = toolpathPoints(path)
      if (points.length < 2) return
      for (let pass = 0; pass < path.passes; pass++) {
        add(points[0], false, path, index)
        points.slice(1).forEach(to => add(to, true, path, index))
      }
    })
    timeline = { key, segments, duration }
    simulationCache.set(job, timeline)
  }
  const idle = { headPos: startPt, laserOn: false, activePathIndex: -1, currentSpeed: 0, currentPower: 0, blower: false, pathProgress: 0 }
  if (!timeline.segments.length) return idle
  if (p >= 1) return { ...idle, headPos: timeline.segments[timeline.segments.length - 1].to, pathProgress: 1 }
  const target = p * timeline.duration
  let lo = 0, hi = timeline.segments.length - 1
  while (lo < hi) { const mid = (lo + hi) >>> 1; if (timeline.segments[mid].end < target) lo = mid + 1; else hi = mid }
  const seg = timeline.segments[lo]
  const t = Math.max(0, Math.min(1, (target - (seg.end - seg.duration)) / seg.duration))
  return { headPos: { x: seg.from.x + (seg.to.x - seg.from.x) * t, y: seg.from.y + (seg.to.y - seg.from.y) * t },
    laserOn: seg.laserOn, activePathIndex: seg.pathIndex, currentSpeed: seg.speed, currentPower: seg.power,
    blower: seg.blower, pathProgress: t }
}
