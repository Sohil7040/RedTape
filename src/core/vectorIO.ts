/* DXF / HPGL import and DXF / PLT / RD / RLD job export.
   Supports the common laser-shop subset: LINE, LWPOLYLINE (with bulges),
   ARC, CIRCLE for DXF; PU/PD/PA/PR pen moves for HPGL/PLT;
   Ruida DSP binary bytecode (.rd) and RDWorks document (.rld). */
import {
  PathNode, Pt, Subpath, ellipseSubpaths, makeNode, pathBounds, scaleSubpaths, translateSubpaths, uid,
} from './geometry'
import { DocumentModel, Page, Shape, makeFill, makeShape, makeStroke } from './model'
import { estimateJobTime, getProductionJob, toolpathPoints } from './production'
import { parseRD, parseRLD, buildJobRD, buildJobRLD } from './ruidaIO'
import { parseSVG } from './svgIO'

export { buildJobRD, buildJobRLD }

export interface ImportResult {
  shapes: Shape[]
  format: 'DXF' | 'PLT' | 'RLD' | 'RD' | 'SVG'
  warnings: string[]
  bed?: { width: number; height: number }
}

export function parseVectorFile(text: string, filename: string, page: Page, rawBytes?: Uint8Array): ImportResult {
  const ext = filename.split('.').pop()?.toLowerCase() ?? ''
  let result: { shapes: Shape[]; warnings: string[]; bed?: {width: number; height: number} }
  let format: ImportResult['format']
  if (ext === 'rld' || ext === 'rd') {
    if (!rawBytes) return { shapes: [], warnings: ['Binary RD/RLD input is required'], format: ext === 'rd' ? 'RD' : 'RLD' }
    result = ext === 'rd' ? parseRD(rawBytes) : parseRLD(rawBytes); format = ext === 'rd' ? 'RD' : 'RLD'
  } else if (ext === 'svg') { result = parseSVG(text); format = 'SVG' }
  else if (ext === 'plt' || ext === 'hpgl') { result = parsePLT(text); format = 'PLT' }
  else if (ext === 'dxf') { result = parseDXF(text); format = 'DXF' }
  else return { shapes: [], warnings: ['Unsupported vector file type'], format: 'DXF' }
  const targetPage = result.bed ? { ...page, ...result.bed } : page
  const fitted = fitImport(result.shapes, targetPage)
  return { format, ...fitted, warnings: [...result.warnings, ...fitted.warnings], bed: result.bed }
}

/* ── DXF parser ────────────────────────────────────────────────── */

interface Tag { code: number; value: string }

function parseDXF(text: string): { shapes: Shape[]; warnings: string[] } {
  const lines = text.split(/\r?\n/)
  const tags: Tag[] = []
  for (let i = 0; i + 1 < lines.length; i += 2) {
    const code = Number(lines[i].trim())
    if (!Number.isFinite(code)) continue
    tags.push({ code, value: lines[i + 1].trim() })
  }
  const warnings: string[] = []
  let units = 4 // mm
  let entitiesStart = -1, entitiesEnd = -1
  for (let i = 0; i < tags.length; i++) {
    if (tags[i].code === 9 && tags[i].value === '$INSUNITS') units = Number(tags[i + 1]?.value ?? 4)
    if (tags[i].code === 0 && tags[i].value === 'SECTION' && tags[i + 1]?.value === 'ENTITIES') entitiesStart = i
    if (entitiesStart >= 0 && tags[i].code === 0 && tags[i].value === 'ENDSEC') { entitiesEnd = i; break }
  }
  if (entitiesStart < 0) return { shapes: [], warnings: ['No ENTITIES section found in DXF.'] }
  const scale = unitScale(units)
  const shapes: Shape[] = []
  let i = entitiesStart + 2
  let index = 0
  while (i < (entitiesEnd > 0 ? entitiesEnd : tags.length)) {
    if (tags[i].code !== 0) { i++; continue }
    const type = tags[i].value
    const start = i + 1
    let end = start
    while (end < tags.length && tags[end].code !== 0) end++
    const body = tags.slice(start, end)
    const shapesBefore = shapes.length
    const dxfLayer = find(body, 8) ?? '0'
    index++
    if (type === 'LINE') {
      const p1 = vec(body, 10, 20, scale), p2 = vec(body, 11, 21, scale)
      if (p1 && p2) {
        shapes.push(makeImportedShape(`DXF LINE ${index}`, [{
          id: uid('sp'), closed: false, nodes: [makeNode(p1.x, p1.y), makeNode(p2.x, p2.y)],
        }]))
      }
    } else if (type === 'POLYLINE') {
      const flags = Number(find(body, 70) ?? 0)
      const pts: DxfPolylineVertex[] = []
      let j = end
      while (j < tags.length) {
        if (tags[j].code === 0 && tags[j].value === 'VERTEX') {
          let k = j + 1
          while (k < tags.length && tags[k].code !== 0) k++
          const vb = tags.slice(j + 1, k)
          const p = vec(vb, 10, 20, scale)
          if (p) pts.push({ ...p, bulge: Number(find(vb, 42) ?? 0) })
          j = k
          continue
        }
        if (tags[j].code === 0 && tags[j].value === 'SEQEND') {
          let k = j + 1
          while (k < tags.length && tags[k].code !== 0) k++
          j = k
        }
        break
      }
      if (pts.length > 1) {
        let closed = !!(flags & 1)
        if (!closed && pts.length > 3 && Math.hypot(pts[0].x - pts[pts.length - 1].x, pts[0].y - pts[pts.length - 1].y) < 0.01) {
          closed = true
          pts.pop()
        }
        shapes.push(makeImportedShape(`DXF POLYLINE ${index}`, [{ id: uid('sp'), closed, nodes: polylineNodes(pts, closed) }]))
      }
      tagImported(shapes, shapesBefore, dxfLayer)
      i = j
      continue
    } else if (type === 'LWPOLYLINE') {
      const flags = Number(find(body, 70) ?? 0)
      const nodes = lwPolylineNodes(body, scale, !!(flags & 1))
      if (nodes.length > 1) {
        shapes.push(makeImportedShape(`DXF POLYLINE ${index}`, [{ id: uid('sp'), closed: !!(flags & 1), nodes }]))
      }
    } else if (type === 'CIRCLE') {
      const c = vec(body, 10, 20, scale)
      const r = Number(find(body, 40) ?? 0) * scale
      if (c && r > 0) shapes.push(makeImportedShape(`DXF CIRCLE ${index}`, ellipseSubpaths(c.x, c.y, r, r)))
    } else if (type === 'ARC') {
      const c = vec(body, 10, 20, scale)
      const r = Number(find(body, 40) ?? 0) * scale
      const a0 = Number(find(body, 50) ?? 0), a1 = Number(find(body, 51) ?? 0)
      if (c && r > 0) {
        const sweep = ((a1 - a0 + 360) % 360) || 360
        const nodes = arcNodes(c, r, a0 * Math.PI / 180, sweep * Math.PI / 180)
        shapes.push(makeImportedShape(`DXF ARC ${index}`, [{ id: uid('sp'), closed: false, nodes }]))
      }
    } else if (['SPLINE', 'ELLIPSE', 'INSERT', 'TEXT', 'MTEXT', 'HATCH', 'DIMENSION'].includes(type)) {
      warnings.push(`${type} entities are not imported yet.`)
    }
    tagImported(shapes, shapesBefore, dxfLayer)
    i = end
  }
  if (!shapes.length) warnings.push('No supported DXF entities were found.')
  flipShapesY(shapes)
  return { shapes, warnings }
}

function tagImported(shapes: Shape[], from: number, layer: string): void {
  for (let i = from; i < shapes.length; i++) {
    shapes[i].meta = { ...(shapes[i].meta ?? {}), importLayer: layer }
  }
}

// Keep imported arcs editable as tangent cubic spans. The conservative sixth-order
// span bound keeps source approximation below 0.001 mm, independently of radius;
// production flattening controls the final machining chord error separately.
function arcNodes(center: Pt, radius: number, start: number, sweep: number): PathNode[] {
  const maxAngle = Math.min(Math.PI / 4, Math.pow(0.001 * 1000 / radius, 1 / 6))
  const count = Math.max(1, Math.ceil(Math.abs(sweep) / maxAngle))
  if (!Number.isFinite(count) || count > 10000) throw new Error('DXF arc exceeds the supported curve complexity.')
  const step = sweep / count
  const nodes: PathNode[] = []
  for (let i = 0; i <= count; i++) {
    const a = start + step * i
    nodes.push(makeNode(center.x + radius * Math.cos(a), center.y + radius * Math.sin(a), 'smooth'))
  }
  const h = 4 / 3 * Math.tan(step / 4) * radius
  for (let i = 0; i < count; i++) {
    const a = start + step * i, b = a + step
    nodes[i].out = { x: nodes[i].x - Math.sin(a) * h, y: nodes[i].y + Math.cos(a) * h }
    nodes[i + 1].in = { x: nodes[i + 1].x + Math.sin(b) * h, y: nodes[i + 1].y - Math.cos(b) * h }
  }
  return nodes
}

function unitScale(units: number): number {
  switch (units) {
    case 1: return 25.4
    case 2: return 304.8
    case 4: return 1
    case 5: return 10
    case 6: return 1000
    case 0: return 1 // Unitless DXF is treated as millimeters, matching the shop default.
    case 7: return 1000000
    case 9: return .0254
    case 10: return 914.4
    case 13: return .001
    case 14: return 100
    default: throw new Error(`Unsupported DXF unit code ${units}; re-export in millimeters.`)
  }
}

function find(body: Tag[], code: number): string | undefined {
  return body.find(t => t.code === code)?.value
}
function nums(body: Tag[], code: number): number[] {
  return body.filter(t => t.code === code).map(t => Number(t.value))
}
function vec(body: Tag[], cx: number, cy: number, scale: number): Pt | null {
  const x = find(body, cx), y = find(body, cy)
  if (x === undefined || y === undefined) return null
  return { x: Number(x) * scale, y: Number(y) * scale }
}

interface DxfPolylineVertex extends Pt { bulge: number }

function lwPolylineNodes(body: Tag[], scale: number, closed: boolean): PathNode[] {
  const pts: DxfPolylineVertex[] = []
  let current: DxfPolylineVertex | null = null
  for (const t of body) {
    if (t.code === 10) {
      if (current) pts.push(current)
      current = { x: Number(t.value) * scale, y: 0, bulge: 0 }
    } else if (t.code === 20 && current) current.y = Number(t.value) * scale
    else if (t.code === 42 && current) current.bulge = Number(t.value)
  }
  if (current) pts.push(current)
  return polylineNodes(pts, closed)
}

function polylineNodes(pts: DxfPolylineVertex[], closed: boolean): PathNode[] {
  if (!pts.length) return []
  const nodes = [makeNode(pts[0].x, pts[0].y)]
  const edgeCount = closed ? pts.length : pts.length - 1
  for (let i = 0; i < edgeCount; i++) {
    const a = pts[i], b = pts[(i + 1) % pts.length]
    const arc = Math.abs(a.bulge) > 1e-10 ? bulgeNodes(a, b, a.bulge) : [makeNode(a.x, a.y), makeNode(b.x, b.y)]
    nodes[nodes.length - 1].out = arc[0].out
    nodes.push(...arc.slice(1, -1))
    if (closed && i === edgeCount - 1) nodes[0].in = arc[arc.length - 1].in
    else { arc[arc.length - 1].type = 'cusp'; nodes.push(arc[arc.length - 1]) }
  }
  return nodes
}

function bulgeNodes(a: Pt, b: Pt, bulge: number): PathNode[] {
  const theta = 4 * Math.atan(bulge)
  const dx = b.x - a.x, dy = b.y - a.y, chord = Math.hypot(dx, dy)
  if (chord < 1e-10) return [makeNode(a.x, a.y), makeNode(b.x, b.y)]
  const d = (chord / 2) / Math.tan(theta / 2)
  const center = { x: (a.x + b.x) / 2 - dy / chord * d, y: (a.y + b.y) / 2 + dx / chord * d }
  const radius = Math.hypot(a.x - center.x, a.y - center.y)
  const nodes = arcNodes(center, radius, Math.atan2(a.y - center.y, a.x - center.x), theta)
  // Preserve the supplied vertices exactly, including shallow arcs at large radii.
  const first = nodes[0], last = nodes[nodes.length - 1]
  first.out.x += a.x - first.x; first.out.y += a.y - first.y
  first.x = a.x; first.y = a.y; first.in = { x: a.x, y: a.y }
  last.in.x += b.x - last.x; last.in.y += b.y - last.y
  last.x = b.x; last.y = b.y; last.out = { x: b.x, y: b.y }
  return nodes
}

/* ── HPGL / PLT parser ────────────────────────────────────────── */

function parsePLT(text: string): { shapes: Shape[]; warnings: string[] } {
  const shapes: Shape[] = []
  const warnings: string[] = []
  const commands = text.replace(/\r?\n/g, '').split(';')
  let penDown = false
  let absolute = true
  let pen = 1
  let pathPen = 1
  let pos: Pt = { x: 0, y: 0 }
  let current: Pt[] = []
  let count = 0
  const flush = () => {
    if (current.length > 1) {
      const closed = current.length > 3 && Math.hypot(current[0].x - current[current.length - 1].x, current[0].y - current[current.length - 1].y) < 0.06
      if (closed) current.pop()
      count++
      const shp = makeImportedShape(`PLT PATH ${count}`, [{
        id: uid('sp'), closed,
        nodes: current.map(p => makeNode(p.x, p.y)),
      }])
      shp.meta = { ...(shp.meta ?? {}), importLayer: `Pen ${pathPen}` }
      shapes.push(shp)
    }
    current = []
  }
  for (const raw of commands) {
    const cmd = raw.trim().toUpperCase()
    if (!cmd) continue
    const name = cmd.match(/^[A-Z]{2}/)?.[0] ?? ''
    const coordText = cmd.slice(2)
    if (name === 'IN') { flush(); penDown = false; absolute = true; pos = { x: 0, y: 0 }; continue }
    if (name === 'SP') {
      flush(); const n = Number(coordText)
      if (Number.isFinite(n) && n >= 0) { pen = n; if (!n) penDown = false }
      continue
    }
    if (['PA', 'PR', 'PU', 'PD'].includes(name)) {
      if (name === 'PA') absolute = true
      if (name === 'PR') absolute = false
      if (name === 'PU') { flush(); penDown = false }
      if (name === 'PD') penDown = pen > 0
      const numbers = coordText.trim() ? coordText.trim().split(/[\s,]+/).map(Number) : []
      if (numbers.length % 2 || numbers.some(n => !Number.isFinite(n))) { warnings.push('Malformed PLT coordinates'); continue }
      for (let i = 0; i < numbers.length; i += 2) {
        const next = absolute ? { x: numbers[i], y: numbers[i+1] } : { x: pos.x + numbers[i], y: pos.y + numbers[i+1] }
        if (penDown) {
          if (!current.length) { pathPen = pen; current.push({ x: pos.x / 40, y: pos.y / 40 }) }
          current.push({ x: next.x / 40, y: next.y / 40 })
        }
        pos = next
      }
    } else if (['AA', 'CI', 'AR'].includes(name)) {
      throw new Error(`${name} arc commands are not supported; convert arcs to line segments before import.`)
    }
  }
  flush()
  // HPGL uses a Y-up plotter plane; mirror into document space.
  flipShapesY(shapes)
  if (!shapes.length) warnings.push('No pen-down geometry was found in the PLT file.')
  return { shapes, warnings }
}

function flipShapesY(shapes: Shape[]): void {
  let maxY = -Infinity
  for (const s of shapes) for (const sub of s.subpaths) for (const n of sub.nodes) maxY = Math.max(maxY, n.y)
  if (!Number.isFinite(maxY)) return
  for (const s of shapes) for (const sub of s.subpaths) for (const n of sub.nodes) {
    n.y = maxY - n.y
    n.in.y = maxY - n.in.y
    n.out.y = maxY - n.out.y
  }
}

/* ── Import fitting ───────────────────────────────────────────── */

function fitImport(shapes: Shape[], page: Page): { shapes: Shape[]; warnings: string[] } {
  if (!shapes.length) return { shapes, warnings: [] }
  const bounds = pathBounds(shapes.flatMap(s => s.subpaths))
  if (![bounds.x,bounds.y,bounds.w,bounds.h].every(Number.isFinite)) throw new Error('Imported geometry has invalid coordinates')
  const oversized = bounds.w > page.width || bounds.h > page.height
  // Preserve physical dimensions. Never shrink a laser job silently to make it fit.
  const dx = Math.max(0, (page.width - bounds.w) / 2) - bounds.x
  const dy = Math.max(0, (page.height - bounds.h) / 2) - bounds.y
  return { shapes: shapes.map(s => ({ ...s, subpaths: translateSubpaths(s.subpaths, dx, dy) })),
    warnings: oversized ? ['Artwork exceeds the sheet. Original dimensions were preserved; resize explicitly or choose a larger sheet.'] : [] }
}

function makeImportedShape(name: string, subpaths: Subpath[]): Shape {
  return makeShape('path', subpaths, {
    name,
    fill: makeFill({ type: 'none', opacity: 1 }),
    stroke: makeStroke({ enabled: true, color: '#1d222b', width: 0.3 }),
    meta: { imported: true },
  })
}

/* ── DXF / PLT export ─────────────────────────────────────────── */

export function buildJobDXF(doc: DocumentModel): string {
  const job = getProductionJob(doc)
  if (job.errors.length) throw new Error(job.errors.join(' '))
  const out: string[] = []
  const e = (code: number, value: string | number) => { out.push(String(code), String(value)) }
  e(0, 'SECTION'); e(2, 'HEADER'); e(9, '$ACADVER'); e(1, 'AC1009'); e(9, '$INSUNITS'); e(70, 4); e(0, 'ENDSEC')
  e(0, 'SECTION'); e(2, 'TABLES'); e(0, 'TABLE'); e(2, 'LAYER'); e(70, 3)
  for (const [name, color] of [['CUT', 1], ['ENGRAVE', 5], ['SCORE', 3]] as [string, number][]) {
    e(0, 'LAYER'); e(2, name); e(70, 0); e(62, color); e(6, 'CONTINUOUS')
  }
  e(0, 'ENDTAB'); e(0, 'ENDSEC')
  e(0, 'SECTION'); e(2, 'ENTITIES')
  const pageH = doc.page.height
  for (const path of job.paths) {
    if (path.operation === 'ignore') continue
    const layer = path.operation.toUpperCase()
    const color = path.operation === 'cut' ? 1 : path.operation === 'engrave' ? 5 : 3
    const points = toolpathPoints(path)
    for (let pass = 0; pass < path.passes; pass++) {
      const pts = points.map(p => ({ x: p.x, y: pageH - p.y }))
      // One open polyline already contains closure and leads in their execution order.
      e(0, 'POLYLINE'); e(8, layer); e(62, color); e(66, 1); e(70, 0); e(10, 0); e(20, 0); e(30, 0)
      for (const p of pts) { e(0, 'VERTEX'); e(8, layer); e(10, fmt(p.x)); e(20, fmt(p.y)); e(30, 0) }
      e(0, 'SEQEND'); e(8, layer)
    }
  }
  e(0, 'ENDSEC'); e(0, 'EOF')
  return out.join('\n')
}

export function buildJobPLT(doc: DocumentModel): string {
  const job = getProductionJob(doc)
  const pageH = doc.page.height
  const out: string[] = ['IN']
  if (job.errors.length) throw new Error(job.errors.join(' '))
  let pen = 0
  const penFor = (op: string) => op === 'cut' ? 1 : op === 'engrave' ? 2 : op === 'score' ? 3 : 1
  const U = (v: number) => Math.round(v * 40)
  for (const path of job.paths) {
    if (path.operation === 'ignore') continue
    const p = penFor(path.operation)
    if (p !== pen) { out.push(`SP${p}`); pen = p }
    const pts = toolpathPoints(path).map(pt => ({ x: U(pt.x), y: U(pageH - pt.y) }))
    for (let pass = 0; pass < path.passes && pts.length; pass++) {
      out.push(`PU${pts[0].x},${pts[0].y}`)
      out.push(`PD${pts.slice(1).map(pt => `${pt.x},${pt.y}`).join(',')}`)
      out.push('PU')
    }
  }
  out.push('SP0', 'PG')
  return out.join(';\n') + ';'
}

export function buildJobJSON(doc: DocumentModel): string {
  const job = getProductionJob(doc)
  return JSON.stringify({
    app: 'Corelith Studio', type: 'laser-job', version: 1, createdAt: new Date().toISOString(),
    page: doc.page, settings: doc.production,
    stats: { totalLength: job.totalLength, totalTime: job.totalTime, rapidLength: job.rapidLength, paths: job.paths.length, bounds: job.bounds },
    timeEstimate: estimateJobTime(job, doc.production.timeAllowancePct ?? 0),
    warnings: job.warnings,
    paths: job.paths,
  }, null, 2)
}

function fmt(n: number): string { return (Math.round(n * 1000) / 1000).toFixed(3) }

