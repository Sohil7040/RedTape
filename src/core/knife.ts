/* Knife / cut engine: curve-polyline intersections, topology rebuilding,
   auto-close, and gap / overlap closure geometry. */
import {
  Cubic, PathNode, Pt, Subpath, clone, cloneNode, cloneSubpaths, cubicPoint, dist, flattenSubpath,
  lineSegIntersect, nearestPointOnSegment, offsetPolyline, pathToSvgD, segmentAt, segmentCount,
  segments, splitCubic, uid,
} from './geometry'
import { KnifeSettings, Shape, makeFill, makeShadow, makeStroke } from './model'

interface Hit {
  pos: number          // position along target subpath (segment index + t)
  cutPos: number       // position along cut polyline (segment index + t)
  point: Pt
}

interface PieceHit { i: number; t: number }

function cubicBetween(c: Cubic, t0: number, t1: number): Cubic | null {
  if (t1 - t0 < 1e-9) return null
  let piece = c
  if (t0 > 1e-9) {
    const [, right] = splitCubic(piece, t0)
    piece = right
  }
  const span = (t1 - t0) / Math.max(1e-9, 1 - t0)
  if (span < 1 - 1e-9) {
    const [left] = splitCubic(piece, Math.min(1, Math.max(0, span)))
    piece = left
  }
  return piece
}

function edgeSamples(c: Cubic, n: number): Pt[] {
  const out: Pt[] = []
  for (let i = 0; i <= n; i++) out.push(cubicPoint(c, i / n))
  return out
}

function intersectionHits(sub: Subpath, cut: Pt[]): Hit[] {
  const hits: Hit[] = []
  const cuts = cut
  const segs = segments(sub)
  for (const seg of segs) {
    const n = 28
    const pts = edgeSamples(seg, n)
    for (let k = 0; k < n; k++) {
      const a0 = pts[k], a1 = pts[k + 1]
      for (let j = 0; j < cuts.length - 1; j++) {
        const h = lineSegIntersect(a0, a1, cuts[j], cuts[j + 1])
        if (!h) continue
        // Refine the sampled crossing against the actual cubic and knife line.
        let lo=k/n,hi=(k+1)/n
        const side=(t:number)=>{const p=cubicPoint(seg,t),a=cuts[j],b=cuts[j+1];return (b.x-a.x)*(p.y-a.y)-(b.y-a.y)*(p.x-a.x)}
        const f0=side(lo),f1=side(hi)
        let root:number
        if(Math.abs(f0)<1e-12)root=lo
        else if(Math.abs(f1)<1e-12)root=hi
        else { for(let step=0;step<42;step++){const mid=(lo+hi)/2;if(side(mid)*f0>0)lo=mid;else hi=mid}root=(lo+hi)/2 }
        const near={t:root,point:cubicPoint(seg,root)}
        // Adjacent segments both report a corner hit. Canonicalise shared
        // anchors (including a closed contour's seam) before deduplicating.
        const t = near.t < 1e-5 ? 0 : near.t > 1 - 1e-5 ? 1 : near.t
        const rawPos = seg.index + t
        const pos = sub.closed ? rawPos % segs.length : rawPos
        if (!sub.closed && (pos < 1e-5 || pos > segs.length - 1e-5)) continue
        if (hits.some(x => Math.abs(x.pos - pos) < 1e-5)) continue
        // position along cut polyline
        const d0 = dist(cuts[j], near.point), d1 = dist(near.point, cuts[j + 1])
        const u = d0 / Math.max(1e-9, d0 + d1)
        hits.push({ pos, cutPos: j + u, point: near.point })
      }
    }
  }
  return hits
}

function chainFromPieces(pieces: Cubic[], closed: boolean, closure?: Pt[]): Subpath {
  if (!pieces.length) {
    const nodes: PathNode[] = []
    if (closure && closure.length) {
      for (const p of closure) nodes.push({ id: uid('n'), x: p.x, y: p.y, in: clone(p), out: clone(p), type: 'cusp' })
    }
    return { id: uid('sp'), closed, nodes }
  }
  const anchors: Pt[] = [clone(pieces[0].p0), ...pieces.map(p => clone(p.p3))]
  const nodes: PathNode[] = anchors.map((a, i) => ({
    id: uid('n'), x: a.x, y: a.y,
    in: i > 0 ? clone(pieces[i - 1].p2) : clone(a),
    out: i < pieces.length ? clone(pieces[i].p1) : clone(a),
    type: 'cusp',
  }))
  nodes[0].in = clone(nodes[0])
  nodes[nodes.length - 1].out = clone(nodes[nodes.length - 1])

  if (closure && closure.length > 1) {
    // first closure point is the current end, last is the start
    const rest = closure.slice(1)
    const finalIsStart = rest.length > 0 && dist(rest[rest.length - 1], nodes[0]) < 1e-5
    const end = finalIsStart ? rest.length - 1 : rest.length
    for (let i = 0; i < end; i++) {
      const p = rest[i]
      nodes.push({ id: uid('n'), x: p.x, y: p.y, in: clone(p), out: clone(p), type: 'cusp' })
    }
    nodes[0].in = clone(nodes[0])
    const last = nodes[nodes.length - 1]
    last.out = clone(last)
  }
  return { id: uid('sp'), closed, nodes }
}

function arcPieces(sub: Subpath, startPos: number, endPos: number, total: number): Cubic[] {
  const pieces: Cubic[] = []
  let pos = startPos
  let guard = 0
  while (pos < endPos - 1e-7 && guard++ < total * 3 + 4) {
    const floor = Math.floor(pos + 1e-9)
    const idx = ((floor % total) + total) % total
    const local = pos - floor
    const segEnd = Math.min(floor + 1, endPos)
    const endLocal = segEnd - floor
    const c = segmentAt(sub, idx)
    const piece = cubicBetween(c, local, Math.min(1, endLocal))
    if (piece) pieces.push(piece)
    if (segEnd <= pos + 1e-9) break
    pos = segEnd
  }
  return pieces
}

function closedArcPositions(sub: Subpath, a: number, b: number, total: number): { first: Cubic[]; second: Cubic[]; aPos: number; bPos: number } {
  const aPos = a
  const bPos = b <= a + 1e-9 ? b + total : b
  return {
    first: arcPieces(sub, aPos, bPos, total),
    second: arcPieces(sub, bPos, aPos + total, total),
    aPos, bPos,
  }
}


function closureSlice(cut: Pt[], fromPos: number, toPos: number): Pt[] {
  const points = sliceForward(cut, fromPos, toPos)
  if (fromPos > toPos) points.reverse()
  return points
}

function sliceForward(pts: Pt[], a: number, b: number): Pt[] {
  const lo = Math.min(a, b), hi = Math.max(a, b)
  const out: Pt[] = []
  const at = (pos: number): Pt => {
    const i = Math.min(pts.length - 2, Math.floor(pos))
    const t = pos - i
    return { x: pts[i].x + (pts[i + 1].x - pts[i].x) * t, y: pts[i].y + (pts[i + 1].y - pts[i].y) * t }
  }
  out.push(at(lo))
  const startSeg = Math.ceil(lo - 1e-9)
  for (let i = startSeg; i < hi; i++) {
    if (i > lo + 1e-7 && i < hi - 1e-7) out.push(clone(pts[i]))
  }
  out.push(at(hi))
  // de-duplicate
  const clean: Pt[] = []
  for (const p of out) if (!clean.length || dist(clean[clean.length - 1], p) > 1e-6) clean.push(p)
  return clean
}

function nodesPolylineArea(nodes: { x: number; y: number }[], closed = true): number {
  let a = 0
  for (let i = 0; i < nodes.length; i++) {
    const p = nodes[i], q = nodes[(i + 1) % nodes.length]
    a += p.x * q.y - q.x * p.y
  }
  return a / 2
}

function areaWithClosure(pieces: Cubic[], closure: Pt[]): number {
  const anchors = pieces.length ? [pieces[0].p0, ...pieces.map(p => p.p3)] : []
  const poly = [...anchors, ...closure.slice(1)]
  return Math.abs(nodesPolylineArea(poly))
}

function chooseClosure(pieces: Cubic[], centerClosure: Pt[], width: number, span: 'normal' | 'gap' | 'overlap'): Pt[] {
  if (span === 'normal' || width <= 1e-5) return centerClosure
  const min = offsetPolyline(centerClosure, -width / 2)
  const plus = offsetPolyline(centerClosure, width / 2)
  const a0 = areaWithClosure(pieces, min), a1 = areaWithClosure(pieces, plus)
  if (span === 'gap') return a0 <= a1 ? min : plus
  return a0 >= a1 ? min : plus
}

function makeHalf(original: Shape, subpath: Subpath, suffix: string): Shape {
  return {
    ...original,
    id: uid('shape'),
    name: `${original.name} · ${suffix}`,
    subpaths: [subpath],
    fill: makeFill(original.fill),
    stroke: makeStroke(original.stroke),
    shadow: makeShadow(original.shadow),
    text: undefined,
    clip: undefined,
    meta: { ...(original.meta ?? {}), cut: suffix },
  }
}

export interface CutResult {
  sourceId: string
  pieces: Shape[]
  cuts: number
}

export function cutShape(shape: Shape, cutInput: Pt[], settings: KnifeSettings): CutResult | null {
  if (cutInput.length < 2) return null
  const cut = dedupe(cutInput)
  if (cut.length < 2) return null
  const pieces: Shape[] = []
  let totalCuts = 0
  for (let si = 0; si < shape.subpaths.length; si++) {
    const sub = shape.subpaths[si]
    if (sub.nodes.length < 2) { pieces.push(makeHalf(shape, cloneNodeSubpath(sub), 'A')); continue }
    const hits = intersectionHits(sub, cut)
    if (hits.length < 2 && sub.closed) continue
    if (hits.length < 1 && !sub.closed) continue
    if (shape.subpaths.length > 1) throw new Error('Knife cutting compound paths is not supported. Separate the contours first; original artwork was preserved.')
    if (sub.closed && hits.length !== 2) throw new Error('This knife crosses a closed contour more than twice. Make one simple cut at a time; original artwork was preserved.')
    totalCuts += hits.length
    const total = segmentCount(sub)
    if (sub.closed) {
      const sorted = [...hits].sort((a, b) => a.cutPos - b.cutPos)
      const pair = sorted.length === 2 ? sorted : [sorted[0], sorted[1]]
      const [a, b] = pair
      const arcs = closedArcPositions(sub, a.pos, b.pos, total)
      const firstClosed = settings.autoClose
      const centerAtoB = closureSlice(cut, a.cutPos, b.cutPos)
      const centerBtoA = [...centerAtoB].reverse()
      const closureA = firstClosed ? chooseClosure(arcs.first, centerBtoA, settings.width, settings.span) : undefined
      const closureB = firstClosed ? chooseClosure(arcs.second, centerAtoB, settings.width, settings.span) : undefined
      pieces.push(makeHalf(shape, chainFromPieces(arcs.first, firstClosed, closureA), 'A'))
      pieces.push(makeHalf(shape, chainFromPieces(arcs.second, firstClosed, closureB), 'B'))
    } else {
      const sorted = [...hits].sort((a, b) => a.pos - b.pos)
      const positions = [0, ...sorted.map(h => h.pos), total]
      // avoid duplicate zero-length parts
      for (let i = 0; i < positions.length - 1; i++) {
        const from = positions[i], to = positions[i + 1]
        if (to - from < 1e-5) continue
        const ps = arcPiecesLight(sub, from, to, total)
        pieces.push(makeHalf(shape, chainFromPieces(ps, false), String.fromCharCode(65 + i)))
      }
    }
  }
  if (!pieces.length || !totalCuts) return null
  return { sourceId: shape.id, pieces, cuts: totalCuts }
}

function dedupe(pts: Pt[]): Pt[] {
  const out: Pt[] = []
  for (const p of pts) if (!out.length || dist(p, out[out.length - 1]) > 1e-9) out.push(clone(p))
  return out
}

function cloneNodeSubpath(sub: Subpath): Subpath {
  return { id: sub.id, closed: sub.closed, nodes: sub.nodes.map(cloneNode) }
}

function arcPiecesLight(sub: Subpath, startPos: number, endPos: number, total: number): Cubic[] {
  const pieces: Cubic[] = []
  let pos = startPos
  let guard = 0
  while (pos < endPos - 1e-7 && guard++ < total * 3 + 4) {
    const floor = Math.floor(pos + 1e-9)
    const idx = Math.min(total - 1, Math.max(0, floor))
    const local = pos - floor
    const segEnd = Math.min(floor + 1, endPos)
    const c = segmentAt(sub, idx)
    const piece = cubicBetween(c, local, Math.min(1, segEnd - floor))
    if (piece) pieces.push(piece)
    if (segEnd <= pos + 1e-9) break
    pos = segEnd
  }
  return pieces
}

/** Cut all shapes with a polyline. Returns replacements keyed by source id. */
export function cutShapes(shapes: Shape[], cut: Pt[], settings: KnifeSettings): { result: CutResult[]; totalCuts: number } {
  const result: CutResult[] = []
  let totalCuts = 0
  for (const shape of shapes) {
    const r = cutShape(shape, cut, settings)
    if (r) { result.push(r); totalCuts += r.cuts }
  }
  return { result, totalCuts }
}

/** Smooth an anchor polyline with Catmull-Rom sampling for precision Bézier cuts. */
export function smoothCutPath(anchors: Pt[], samples = 18): Pt[] {
  if (anchors.length < 3) return anchors.map(clone)
  const pts: Pt[] = []
  const get = (i: number) => anchors[Math.max(0, Math.min(anchors.length - 1, i))]
  for (let i = 0; i < anchors.length - 1; i++) {
    const p0 = get(i - 1), p1 = get(i), p2 = get(i + 1), p3 = get(i + 2)
    for (let j = 0; j < samples; j++) {
      const t = j / samples, t2 = t * t, t3 = t2 * t
      pts.push({
        x: 0.5 * ((2 * p1.x) + (-p0.x + p2.x) * t + (2 * p0.x - 5 * p1.x + 4 * p2.x - p3.x) * t2 + (-p0.x + 3 * p1.x - 3 * p2.x + p3.x) * t3),
        y: 0.5 * ((2 * p1.y) + (-p0.y + p2.y) * t + (2 * p0.y - 5 * p1.y + 4 * p2.y - p3.y) * t2 + (-p0.y + 3 * p1.y - 3 * p2.y + p3.y) * t3),
      })
    }
  }
  pts.push(clone(anchors[anchors.length - 1]))
  return pts
}

/** Flatten a smooth anchor path for preview. */
export function cutPreviewPath(anchors: Pt[], mode: 'line' | 'freehand' | 'bezier'): Pt[] {
  if (mode === 'bezier') return smoothCutPath(anchors)
  return anchors.map(clone)
}

void flattenSubpath
void pathToSvgD
void cloneSubpaths
void segments
