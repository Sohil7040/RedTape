/* ─────────────────────────────────────────────────────────────
   Corelith geometry kernel
   Double-precision vector math, Bézier evaluation, topology,
   intersection and snapping primitives. Units are millimetres.
   ───────────────────────────────────────────────────────────── */

export interface Pt { x: number; y: number }
export type NodeType = 'cusp' | 'smooth' | 'symmetric'

export interface PathNode {
  id: string
  x: number
  y: number
  /** absolute incoming control point */
  in: Pt
  /** absolute outgoing control point */
  out: Pt
  type: NodeType
}

export interface Subpath {
  id: string
  nodes: PathNode[]
  closed: boolean
}

export interface Bounds { x: number; y: number; w: number; h: number }
export interface Cubic { p0: Pt; p1: Pt; p2: Pt; p3: Pt }
export interface SegmentRef extends Cubic { index: number }
export interface IntersectionHit {
  point: Pt
  t: number
  u: number
  a: SegmentRef
  b: SegmentRef
}

export const EPS = 1e-7
export const KAPPA = 0.5522847498307936

let idCounter = 0
export function uid(prefix = 'id'): string {
  idCounter += 1
  return `${prefix}_${Date.now().toString(36)}${idCounter.toString(36)}`
}

export const V = (x = 0, y = 0): Pt => ({ x, y })
export const clone = (p: Pt): Pt => ({ x: p.x, y: p.y })
export const add = (a: Pt, b: Pt): Pt => ({ x: a.x + b.x, y: a.y + b.y })
export const sub = (a: Pt, b: Pt): Pt => ({ x: a.x - b.x, y: a.y - b.y })
export const mul = (a: Pt, s: number): Pt => ({ x: a.x * s, y: a.y * s })
export const mid = (a: Pt, b: Pt): Pt => ({ x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 })
export const len = (a: Pt): number => Math.hypot(a.x, a.y)
export const dist = (a: Pt, b: Pt): number => Math.hypot(a.x - b.x, a.y - b.y)
export const near = (a: Pt, b: Pt, eps = 0.0001): boolean => dist(a, b) <= eps
export const lerp = (a: Pt, b: Pt, t: number): Pt => ({ x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t })
export const dot = (a: Pt, b: Pt): number => a.x * b.x + a.y * b.y
export const cross = (a: Pt, b: Pt): number => a.x * b.y - a.y * b.x
export const norm = (a: Pt): Pt => { const l = len(a) || 1; return { x: a.x / l, y: a.y / l } }
export const angleOf = (a: Pt): number => Math.atan2(a.y, a.x)
export const deg = (rad: number): number => (rad * 180) / Math.PI
export const rad = (degrees: number): number => (degrees * Math.PI) / 180
export const clamp = (v: number, lo: number, hi: number): number => Math.min(hi, Math.max(lo, v))

export function makeNode(x: number, y: number, type: NodeType = 'cusp', handle?: Pt): PathNode {
  const anchor = { x, y }
  return {
    id: uid('n'),
    x,
    y,
    in: handle ? clone(handle) : clone(anchor),
    out: handle ? { x: 2 * x - handle.x, y: 2 * y - handle.y } : clone(anchor),
    type,
  }
}

export function makeSmoothNode(x: number, y: number, tangent: Pt, lenIn = 0, lenOut = 0, type: NodeType = 'symmetric'): PathNode {
  const t = norm(tangent)
  return {
    id: uid('n'),
    x, y,
    in: { x: x - t.x * lenIn, y: y - t.y * lenIn },
    out: { x: x + t.x * lenOut, y: y + t.y * lenOut },
    type,
  }
}

export function cloneNode(n: PathNode): PathNode {
  return { id: n.id, x: n.x, y: n.y, in: clone(n.in), out: clone(n.out), type: n.type }
}

export function cloneSubpath(s: Subpath): Subpath {
  return { id: s.id, closed: s.closed, nodes: s.nodes.map(cloneNode) }
}

export function cloneSubpaths(s: Subpath[]): Subpath[] {
  return s.map(cloneSubpath)
}

export function translateNode(n: PathNode, dx: number, dy: number): void {
  n.x += dx; n.y += dy
  n.in = { x: n.in.x + dx, y: n.in.y + dy }
  n.out = { x: n.out.x + dx, y: n.out.y + dy }
}

export function segmentCount(sub: Subpath): number {
  const n = sub.nodes.length
  if (n < 2) return 0
  return sub.closed ? n : n - 1
}

export function segmentAt(sub: Subpath, i: number): SegmentRef {
  const a = sub.nodes[i]
  const b = sub.nodes[(i + 1) % sub.nodes.length]
  return { index: i, p0: { x: a.x, y: a.y }, p1: clone(a.out), p2: clone(b.in), p3: { x: b.x, y: b.y } }
}

export function segments(sub: Subpath): SegmentRef[] {
  const out: SegmentRef[] = []
  const count = segmentCount(sub)
  for (let i = 0; i < count; i++) out.push(segmentAt(sub, i))
  return out
}

export function cubicPoint(c: Cubic, t: number): Pt {
  const mt = 1 - t
  const a = mt * mt * mt
  const b = 3 * mt * mt * t
  const d = 3 * mt * t * t
  const e = t * t * t
  return {
    x: a * c.p0.x + b * c.p1.x + d * c.p2.x + e * c.p3.x,
    y: a * c.p0.y + b * c.p1.y + d * c.p2.y + e * c.p3.y,
  }
}

export function cubicDerivative(c: Cubic, t: number): Pt {
  const mt = 1 - t
  return {
    x: 3 * mt * mt * (c.p1.x - c.p0.x) + 6 * mt * t * (c.p2.x - c.p1.x) + 3 * t * t * (c.p3.x - c.p2.x),
    y: 3 * mt * mt * (c.p1.y - c.p0.y) + 6 * mt * t * (c.p2.y - c.p1.y) + 3 * t * t * (c.p3.y - c.p2.y),
  }
}

export function cubicMidpoint(c: Cubic): Pt {
  return {
    x: 0.125 * c.p0.x + 0.375 * c.p1.x + 0.375 * c.p2.x + 0.125 * c.p3.x,
    y: 0.125 * c.p0.y + 0.375 * c.p1.y + 0.375 * c.p2.y + 0.125 * c.p3.y,
  }
}

export function splitCubic(c: Cubic, t: number): [Cubic, Cubic] {
  const p01 = lerp(c.p0, c.p1, t)
  const p12 = lerp(c.p1, c.p2, t)
  const p23 = lerp(c.p2, c.p3, t)
  const p012 = lerp(p01, p12, t)
  const p123 = lerp(p12, p23, t)
  const p = lerp(p012, p123, t)
  return [
    { p0: clone(c.p0), p1: p01, p2: p012, p3: p },
    { p0: clone(p), p1: p123, p2: p23, p3: clone(c.p3) },
  ]
}

export function cubicBounds(c: Cubic): Bounds {
  const xs = [c.p0.x, c.p3.x]
  const ys = [c.p0.y, c.p3.y]
  for (const axis of ['x', 'y'] as const) {
    const p0 = c.p0[axis], p1 = c.p1[axis], p2 = c.p2[axis], p3 = c.p3[axis]
    const A = -p0 + 3 * p1 - 3 * p2 + p3
    const B = 2 * (p0 - 2 * p1 + p2)
    const C = p1 - p0
    const roots: number[] = []
    if (Math.abs(A) < 1e-12) {
      if (Math.abs(B) > 1e-12) roots.push(-C / B)
    } else {
      const disc = B * B - 4 * A * C
      if (disc >= 0) {
        const s = Math.sqrt(disc)
        roots.push((-B + s) / (2 * A), (-B - s) / (2 * A))
      }
    }
    const arr = axis === 'x' ? xs : ys
    for (const t of roots) if (t > 0 && t < 1) arr.push(cubicPoint(c, t)[axis])
  }
  const minX = Math.min(...xs), maxX = Math.max(...xs)
  const minY = Math.min(...ys), maxY = Math.max(...ys)
  return { x: minX, y: minY, w: maxX - minX, h: maxY - minY }
}

export function unionBounds(list: Bounds[]): Bounds {
  if (!list.length) return { x: 0, y: 0, w: 0, h: 0 }
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity
  for (const b of list) {
    minX = Math.min(minX, b.x); minY = Math.min(minY, b.y)
    maxX = Math.max(maxX, b.x + b.w); maxY = Math.max(maxY, b.y + b.h)
  }
  return { x: minX, y: minY, w: maxX - minX, h: maxY - minY }
}

export function pathBounds(subpaths: Subpath[]): Bounds {
  const bs: Bounds[] = []
  for (const sub of subpaths) {
    for (const seg of segments(sub)) bs.push(cubicBounds(seg))
    if (sub.nodes.length === 1) bs.push({ x: sub.nodes[0].x, y: sub.nodes[0].y, w: 0, h: 0 })
  }
  return unionBounds(bs)
}

/** Adaptive flattening. Returns an open polyline (no duplicated closing point). */
export function flattenCubic(c: Cubic, tolerance = 0.08, depth = 0, out: Pt[] = []): Pt[] {
  if (depth === 0) out.push(clone(c.p0))
  const flatness = Math.max(
    Math.abs(c.p0.x - 2 * c.p1.x + c.p2.x),
    Math.abs(c.p1.x - 2 * c.p2.x + c.p3.x),
    Math.abs(c.p0.y - 2 * c.p1.y + c.p2.y),
    Math.abs(c.p1.y - 2 * c.p2.y + c.p3.y),
  )
  if (flatness <= tolerance || depth >= 12) {
    out.push(clone(c.p3))
    return out
  }
  const [l, r] = splitCubic(c, 0.5)
  flattenCubic(l, tolerance, depth + 1, out)
  flattenCubic(r, tolerance, depth + 1, out)
  return out
}

export function flattenSubpath(sub: Subpath, tolerance = 0.06): Pt[] {
  const out: Pt[] = []
  if (!sub.nodes.length) return out
  out.push({ x: sub.nodes[0].x, y: sub.nodes[0].y })
  for (const seg of segments(sub)) {
    flattenCubic(seg, tolerance, 0, out)
  }
  if (sub.closed && out.length > 1) {
    const a = out[0], b = out[out.length - 1]
    if (near(a, b, 1e-6)) out.pop()
  }
  return out
}

export function flattenPath(subpaths: Subpath[], tolerance = 0.06): Pt[][] {
  return subpaths.map(s => flattenSubpath(s, tolerance))
}

export function polygonArea(poly: Pt[]): number {
  let a = 0
  for (let i = 0; i < poly.length; i++) {
    const p = poly[i], q = poly[(i + 1) % poly.length]
    a += p.x * q.y - q.x * p.y
  }
  return a / 2
}

export function polygonCentroid(poly: Pt[]): Pt | null {
  if (poly.length < 3) return null
  let a = 0, cx = 0, cy = 0
  for (let i = 0; i < poly.length; i++) {
    const p = poly[i], q = poly[(i + 1) % poly.length]
    const f = p.x * q.y - q.x * p.y
    a += f
    cx += (p.x + q.x) * f
    cy += (p.y + q.y) * f
  }
  if (Math.abs(a) < 1e-6) return null
  return { x: cx / (3 * a), y: cy / (3 * a) }
}

export function pathCentroid(subpaths: Subpath[], fallback: Bounds): Pt {
  let A = 0, Cx = 0, Cy = 0
  for (const sub of subpaths) {
    if (!sub.closed) continue
    const poly = flattenSubpath(sub, 0.12)
    if (poly.length < 3) continue
    let a = 0, cx = 0, cy = 0
    for (let i = 0; i < poly.length; i++) {
      const p = poly[i], q = poly[(i + 1) % poly.length]
      const f = p.x * q.y - q.x * p.y
      a += f; cx += (p.x + q.x) * f; cy += (p.y + q.y) * f
    }
    A += a / 2
    Cx += cx / 6
    Cy += cy / 6
  }
  if (Math.abs(A) > 1e-4) return { x: Cx / A, y: Cy / A }
  return { x: fallback.x + fallback.w / 2, y: fallback.y + fallback.h / 2 }
}

export function boundsCenter(b: Bounds): Pt {
  return { x: b.x + b.w / 2, y: b.y + b.h / 2 }
}

export function segmentIntersection(a: Cubic, b: Cubic): { point: Pt; t: number; u: number } | null {
  const d1 = sub(a.p3, a.p0), d2 = sub(b.p3, b.p0)
  const den = cross(d1, d2)
  if (Math.abs(den) < 1e-12) return null
  const diff = sub(b.p0, a.p0)
  const t = cross(diff, d2) / den
  const u = cross(diff, d1) / den
  const tEps = 1e-6, uEps = 1e-6
  if (t < -tEps || t > 1 + tEps || u < -uEps || u > 1 + uEps) return null
  return { point: { x: a.p0.x + d1.x * t, y: a.p0.y + d1.y * t }, t: clamp(t, 0, 1), u: clamp(u, 0, 1) }
}

export function subpathIntersections(a: Subpath, b: Subpath): Pt[] {
  const pa = flattenSubpath(a, 0.4)
  const pb = flattenSubpath(b, 0.4)
  const out: Pt[] = []
  for (let i = 0; i < pa.length; i++) {
    const a0 = pa[i], a1 = pa[(i + 1) % pa.length]
    for (let j = 0; j < pb.length; j++) {
      const b0 = pb[j], b1 = pb[(j + 1) % pb.length]
      const hit = lineSegIntersect(a0, a1, b0, b1)
      if (hit) {
        if (!out.some(p => dist(p, hit) < 0.25)) out.push(hit)
      }
    }
  }
  return out
}

export function lineSegIntersect(a0: Pt, a1: Pt, b0: Pt, b1: Pt): Pt | null {
  const r = sub(a1, a0), s = sub(b1, b0)
  const den = cross(r, s)
  if (Math.abs(den) < 1e-12) return null
  const qp = sub(b0, a0)
  const t = cross(qp, s) / den
  const u = cross(qp, r) / den
  if (t < 0 || t > 1 || u < 0 || u > 1) return null
  return { x: a0.x + r.x * t, y: a0.y + r.y * t }
}

export function nearestPointOnSegment(c: Cubic, p: Pt, samples = 48): { point: Pt; t: number; distance: number } {
  let bestT = 0, bestD = Infinity
  for (let i = 0; i <= samples; i++) {
    const t = i / samples
    const pt = cubicPoint(c, t)
    const d = dist(pt, p)
    if (d < bestD) { bestD = d; bestT = t }
  }
  // local refinement
  let lo = Math.max(0, bestT - 1 / samples), hi = Math.min(1, bestT + 1 / samples)
  for (let i = 0; i < 24; i++) {
    const m1 = lo + (hi - lo) / 3, m2 = hi - (hi - lo) / 3
    if (dist(cubicPoint(c, m1), p) < dist(cubicPoint(c, m2), p)) hi = m2
    else lo = m1
  }
  const t = (lo + hi) / 2
  return { point: cubicPoint(c, t), t, distance: dist(cubicPoint(c, t), p) }
}

export function distToSegment(c: Cubic, p: Pt): number {
  return nearestPointOnSegment(c, p, 28).distance
}

export function transformPoint(p: Pt, mat: { a: number; b: number; c: number; d: number; e: number; f: number }): Pt {
  return { x: mat.a * p.x + mat.c * p.y + mat.e, y: mat.b * p.x + mat.d * p.y + mat.f }
}

export function rotatePoint(p: Pt, pivot: Pt, radians: number): Pt {
  const c = Math.cos(radians), s = Math.sin(radians)
  const dx = p.x - pivot.x, dy = p.y - pivot.y
  return { x: pivot.x + dx * c - dy * s, y: pivot.y + dx * s + dy * c }
}

export function transformSubpaths(subpaths: Subpath[], fn: (p: Pt) => Pt): Subpath[] {
  return subpaths.map(sub => ({
    ...sub,
    nodes: sub.nodes.map(n => {
      const a = fn({ x: n.x, y: n.y })
      const i = fn(n.in)
      const o = fn(n.out)
      return { ...n, x: a.x, y: a.y, in: i, out: o }
    }),
  }))
}

export function rotateSubpaths(subpaths: Subpath[], pivot: Pt, radians: number): Subpath[] {
  return transformSubpaths(subpaths, p => rotatePoint(p, pivot, radians))
}

export function scaleSubpaths(subpaths: Subpath[], pivot: Pt, sx: number, sy: number): Subpath[] {
  return transformSubpaths(subpaths, p => ({ x: pivot.x + (p.x - pivot.x) * sx, y: pivot.y + (p.y - pivot.y) * sy }))
}

export function translateSubpaths(subpaths: Subpath[], dx: number, dy: number): Subpath[] {
  return subpaths.map(sub => {
    const nodes = sub.nodes.map(cloneNode)
    for (const n of nodes) translateNode(n, dx, dy)
    return { ...sub, nodes }
  })
}

export function reverseSubpath(sub: Subpath): Subpath {
  const nodes = sub.nodes.map(cloneNode).reverse()
  for (const n of nodes) {
    const inn = n.in
    n.in = n.out
    n.out = inn
  }
  return { ...sub, nodes }
}

export function pathToSvgD(subpaths: Subpath[]): string {
  const f = (n: number) => Math.round(n * 1000) / 1000
  return subpaths.map(sub => {
    if (!sub.nodes.length) return ''
    let d = `M ${f(sub.nodes[0].x)} ${f(sub.nodes[0].y)}`
    for (const seg of segments(sub)) {
      d += ` C ${f(seg.p1.x)} ${f(seg.p1.y)} ${f(seg.p2.x)} ${f(seg.p2.y)} ${f(seg.p3.x)} ${f(seg.p3.y)}`
    }
    if (sub.closed) d += ' Z'
    return d
  }).join(' ')
}

export function pathToPath2D(subpaths: Subpath[]): Path2D {
  const p = new Path2D()
  for (const sub of subpaths) {
    if (!sub.nodes.length) continue
    p.moveTo(sub.nodes[0].x, sub.nodes[0].y)
    for (const seg of segments(sub)) p.bezierCurveTo(seg.p1.x, seg.p1.y, seg.p2.x, seg.p2.y, seg.p3.x, seg.p3.y)
    if (sub.closed) p.closePath()
  }
  return p
}

/* Rect / ellipse / star generators ------------------------------------------------ */

export function rectSubpaths(x: number, y: number, w: number, h: number): Subpath[] {
  return [{
    id: uid('sp'),
    closed: true,
    nodes: [
      makeNode(x, y, 'cusp'),
      makeNode(x + w, y, 'cusp'),
      makeNode(x + w, y + h, 'cusp'),
      makeNode(x, y + h, 'cusp'),
    ],
  }]
}

export function ellipseSubpaths(cx: number, cy: number, rx: number, ry: number): Subpath[] {
  const ox = rx * KAPPA, oy = ry * KAPPA
  const nodes: PathNode[] = [
    { id: uid('n'), x: cx, y: cy - ry, in: { x: cx - ox, y: cy - ry }, out: { x: cx + ox, y: cy - ry }, type: 'smooth' },
    { id: uid('n'), x: cx + rx, y: cy, in: { x: cx + rx, y: cy - oy }, out: { x: cx + rx, y: cy + oy }, type: 'smooth' },
    { id: uid('n'), x: cx, y: cy + ry, in: { x: cx + ox, y: cy + ry }, out: { x: cx - ox, y: cy + ry }, type: 'smooth' },
    { id: uid('n'), x: cx - rx, y: cy, in: { x: cx - rx, y: cy + oy }, out: { x: cx - rx, y: cy - oy }, type: 'smooth' },
  ]
  return [{ id: uid('sp'), closed: true, nodes }]
}

export function polygonSubpaths(cx: number, cy: number, rx: number, ry: number, sides: number, rotation = -Math.PI / 2, star = false): Subpath[] {
  const n = Math.max(3, Math.round(sides))
  const nodes: PathNode[] = []
  const total = star ? n * 2 : n
  for (let i = 0; i < total; i++) {
    const a = rotation + (i / total) * Math.PI * 2
    const rr = star && i % 2 === 1 ? 0.45 : 1
    nodes.push(makeNode(cx + Math.cos(a) * rx * rr, cy + Math.sin(a) * ry * rr))
  }
  return [{ id: uid('sp'), closed: true, nodes }]
}

/* Snap candidate helpers --------------------------------------------------------- */

export type SnapKind = 'node' | 'midpoint' | 'center' | 'centroid' | 'quadrant' | 'intersection' | 'perpendicular' | 'tangent' | 'grid' | 'guide'
export interface SnapCandidate { x: number; y: number; kind: SnapKind; shapeId?: string; shapeName?: string; extra?: string }

export const SNAP_LABELS: Record<SnapKind, string> = {
  node: 'node',
  midpoint: 'midpoint',
  center: 'center',
  centroid: 'centroid',
  quadrant: 'quadrant',
  intersection: 'intersection',
  perpendicular: 'perpendicular',
  tangent: 'tangent',
  grid: 'grid',
  guide: 'guide',
}

export function pathSnapPoints(subpaths: Subpath[], bounds: Bounds, shapeId?: string, shapeName?: string): SnapCandidate[] {
  const out: SnapCandidate[] = []
  for (const sub of subpaths) {
    for (let i = 0; i < sub.nodes.length; i++) {
      const n = sub.nodes[i]
      out.push({ x: n.x, y: n.y, kind: 'node', shapeId, shapeName })
    }
    for (const seg of segments(sub)) {
      if (dist(seg.p0, seg.p3) < 1e-5) continue
      const m = cubicMidpoint(seg)
      out.push({ x: m.x, y: m.y, kind: 'midpoint', shapeId, shapeName, extra: `segment ${seg.index + 1}` })
    }
  }
  const c = boundsCenter(bounds)
  out.push({ x: c.x, y: c.y, kind: 'center', shapeId, shapeName })
  return out
}

export function ellipseQuadrants(bounds: Bounds, shapeId?: string, shapeName?: string): SnapCandidate[] {
  const cx = bounds.x + bounds.w / 2, cy = bounds.y + bounds.h / 2
  return [
    { x: cx, y: bounds.y, kind: 'quadrant', shapeId, shapeName },
    { x: bounds.x + bounds.w, y: cy, kind: 'quadrant', shapeId, shapeName },
    { x: cx, y: bounds.y + bounds.h, kind: 'quadrant', shapeId, shapeName },
    { x: bounds.x, y: cy, kind: 'quadrant', shapeId, shapeName },
  ]
}

export function sortByDistance(candidates: SnapCandidate[], p: Pt): (SnapCandidate & { distance: number })[] {
  return candidates.map(c => ({ ...c, distance: dist(c, p) })).sort((a, b) => a.distance - b.distance)
}

/* Approximate polyline offset used by the knife gap engine. */
export function offsetPolyline(points: Pt[], distance: number): Pt[] {
  if (points.length < 2) return points.map(clone)
  const out: Pt[] = []
  for (let i = 0; i < points.length; i++) {
    const prev = points[Math.max(0, i - 1)]
    const next = points[Math.min(points.length - 1, i + 1)]
    const t = norm(sub(next, prev))
    let n = { x: -t.y, y: t.x }
    if (i === 0) {
      const t0 = norm(sub(points[1], points[0])); n = { x: -t0.y, y: t0.x }
    } else if (i === points.length - 1) {
      const t1 = norm(sub(points[i], points[i - 1])); n = { x: -t1.y, y: t1.x }
    }
    out.push({ x: points[i].x + n.x * distance, y: points[i].y + n.y * distance })
  }
  return out
}

export function polylineLength(pts: Pt[]): number {
  let l = 0
  for (let i = 1; i < pts.length; i++) l += dist(pts[i - 1], pts[i])
  return l
}

export function pointAtPolyline(points: Pt[], fraction: number): Pt {
  const total = polylineLength(points)
  if (total <= 0) return clone(points[0] ?? V())
  let target = clamp(fraction, 0, 1) * total
  for (let i = 1; i < points.length; i++) {
    const l = dist(points[i - 1], points[i])
    if (target <= l) return lerp(points[i - 1], points[i], target / l)
    target -= l
  }
  return clone(points[points.length - 1])
}

export function simplifyPolyline(points: Pt[], tolerance = 0.6): Pt[] {
  if (points.length < 3) return points.map(clone)
  const out: Pt[] = [clone(points[0])]
  for (let i = 1; i < points.length - 1; i++) {
    const p = points[i]
    if (dist(p, out[out.length - 1]) >= tolerance) out.push(clone(p))
  }
  out.push(clone(points[points.length - 1]))
  return out
}
