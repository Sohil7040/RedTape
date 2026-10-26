import {
  Bounds, Pt, SnapCandidate, SnapKind, boundsCenter, dist, flattenSubpath, lineSegIntersect,
  nearestPointOnSegment, pathBounds, pathCentroid, pathSnapPoints, segments, ellipseQuadrants, sortByDistance,
} from './geometry'
import { DocumentModel, Shape, SnapSettings, allShapes, getShape, shapeBounds } from './model'

export interface SnapHit extends SnapCandidate { distance: number; screenDistance: number }
export interface SnapRay { axis: 'x' | 'y'; position: number; color: string; label?: string }

export function collectStaticCandidates(
  doc: DocumentModel,
  exclude: Set<string>,
  pointer: Pt,
  settings: SnapSettings,
  zoom: number,
): SnapCandidate[] {
  const out: SnapCandidate[] = []
  const shapes = allShapes(doc).filter(s => !exclude.has(s.id))
  for (const shape of shapes) {
    if (shape.locked) continue
    if (settings.nodes || settings.midpoints || settings.centers) {
      const pts = pathSnapPoints(shape.subpaths, shapeBounds(shape), shape.id, shape.name)
      for (const p of pts) {
        if (p.kind === 'node' && !settings.nodes) continue
        if (p.kind === 'midpoint' && !settings.midpoints) continue
        if (p.kind === 'center' && !settings.centers) continue
        out.push(p)
      }
    }
    if (settings.centers) {
      const b = shapeBounds(shape)
      const c = pathCentroid(shape.subpaths, b)
      if (!out.some(p => p.kind === 'centroid' && p.shapeId === shape.id)) {
        out.push({ x: c.x, y: c.y, kind: 'centroid', shapeId: shape.id, shapeName: shape.name })
      }
    }
    if (settings.quadrants && (shape.kind === 'ellipse' || shape.kind === 'polygon' || shape.kind === 'star')) {
      out.push(...ellipseQuadrants(shapeBounds(shape), shape.id, shape.name))
    }
  }

  if (settings.intersections) {
    const nearRadius = 70 / Math.max(0.05, zoom)
    const starts: { shape: Shape; poly: Pt[]; bounds: Bounds }[] = []
    for (const shape of shapes) {
      for (const sub of shape.subpaths) {
        const sb = pathBounds([sub])
        if (distToBounds(pointer, sb) > nearRadius) continue
        starts.push({ shape, poly: flattenSubpath(sub, 0.5), bounds: sb })
      }
    }
    for (let i = 0; i < starts.length; i++) {
      for (let j = i + 1; j < starts.length; j++) {
        if (starts[i].shape.id === starts[j].shape.id) continue
        if (!boundsOverlap(starts[i].bounds, starts[j].bounds, 0.1)) continue
        const a = starts[i].poly, b = starts[j].poly
        for (let ai = 0; ai < a.length; ai++) {
          const a0 = a[ai], a1 = a[(ai + 1) % a.length]
          for (let bi = 0; bi < b.length; bi++) {
            const b0 = b[bi], b1 = b[(bi + 1) % b.length]
            const p = lineSegIntersect(a0, a1, b0, b1)
            if (!p) continue
            if (!out.some(q => q.kind === 'intersection' && dist(q, p) < 0.3)) {
              out.push({ x: p.x, y: p.y, kind: 'intersection' })
            }
          }
        }
      }
    }
  }

  if (settings.perpendicular || settings.tangent) {
    const radius = (settings.radius * 10) / zoom
    for (const shape of shapes) {
      for (const sub of shape.subpaths) {
        for (const seg of segments(sub)) {
          if (settings.perpendicular) {
            const np = nearestPointOnSegment(seg, pointer, 24)
            if (np.distance <= radius && !isEndpoint(seg, np.t, 0.02)) {
              out.push({ x: np.point.x, y: np.point.y, kind: 'perpendicular', shapeId: shape.id, shapeName: shape.name })
            }
          }
          if (settings.tangent) {
            const np = nearestTangent(seg, pointer)
            if (np && dist(np, pointer) <= radius) {
              out.push({ x: np.x, y: np.y, kind: 'tangent', shapeId: shape.id, shapeName: shape.name })
            }
          }
        }
      }
    }
  }

  if (settings.grid) {
    const g = Math.max(0.25, doc.grid.size / Math.max(1, doc.grid.subdivisions))
    const gx = Math.round(pointer.x / g) * g
    const gy = Math.round(pointer.y / g) * g
    out.push({ x: gx, y: gy, kind: 'grid' })
    // grid line candidates projected from the pointer
    out.push({ x: gx, y: pointer.y, kind: 'grid' })
    out.push({ x: pointer.x, y: gy, kind: 'grid' })
  }

  if (settings.guides) {
    for (const guide of doc.guides) {
      if (guide.orientation === 'v') out.push({ x: guide.position, y: pointer.y, kind: 'guide' })
      else out.push({ x: pointer.x, y: guide.position, kind: 'guide' })
    }
  }

  return out
}

function isEndpoint(c: { p0: Pt; p3: Pt }, t: number, eps: number): boolean {
  return t < eps || t > 1 - eps
}

function nearestTangent(c: { p0: Pt; p1: Pt; p2: Pt; p3: Pt }, p: Pt): Pt | null {
  let best: { pt: Pt; dot: number } | null = null
  const n = 36
  const ptAt = (t: number): Pt => {
    const mt = 1 - t, a = mt * mt * mt, b = 3 * mt * mt * t, d = 3 * mt * t * t, e = t * t * t
    return { x: a * c.p0.x + b * c.p1.x + d * c.p2.x + e * c.p3.x, y: a * c.p0.y + b * c.p1.y + d * c.p2.y + e * c.p3.y }
  }
  const derivative = (t: number): Pt => {
    const mt = 1 - t
    return {
      x: 3 * mt * mt * (c.p1.x - c.p0.x) + 6 * mt * t * (c.p2.x - c.p1.x) + 3 * t * t * (c.p3.x - c.p2.x),
      y: 3 * mt * mt * (c.p1.y - c.p0.y) + 6 * mt * t * (c.p2.y - c.p1.y) + 3 * t * t * (c.p3.y - c.p2.y),
    }
  }
  for (let i = 1; i < n; i++) {
    const t = i / n
    const pt = ptAt(t), d = derivative(t)
    const v = { x: p.x - pt.x, y: p.y - pt.y }
    const l = Math.hypot(d.x, d.y) * Math.hypot(v.x, v.y)
    if (l < 1e-9) continue
    let dot = (d.x * v.x + d.y * v.y) / l
    dot = Math.abs(dot)
    if (!best || dot < best.dot) best = { pt, dot }
  }
  return best && best.dot < 0.04 ? best.pt : null
}

export function snapPoint(
  pointer: Pt,
  candidates: SnapCandidate[],
  radiusWorld: number,
  zoom: number,
): SnapHit | null {
  if (!candidates.length) return null
  const sorted = sortByDistance(candidates, pointer)
  const best = sorted[0]
  if (best.distance > radiusWorld) return null
  return { ...best, screenDistance: best.distance * zoom }
}

export function nearestGridPoint(p: Pt, size: number, sub: number): Pt {
  const g = Math.max(0.1, size / Math.max(1, sub))
  return { x: Math.round(p.x / g) * g, y: Math.round(p.y / g) * g }
}

export interface AlignmentResult {
  dx: number
  dy: number
  rays: SnapRay[]
  label?: string
}

interface AlignCandidate {
  delta: number
  target: number
  label: string
  color: string
  priorityScore: number
}

/** Precision magnetic alignment: Center-to-Center, Edge-to-Edge, and Edge-to-Center. */
export function alignmentSnap(
  moving: Bounds,
  otherShapes: Shape[],
  radiusWorld: number,
  enabled: boolean,
  page?: { width: number; height: number },
): AlignmentResult {
  if (!enabled) return { dx: 0, dy: 0, rays: [] }

  const movingX = [
    { v: moving.x, type: 'edge' as const, name: 'Left' },
    { v: moving.x + moving.w / 2, type: 'center' as const, name: 'Center' },
    { v: moving.x + moving.w, type: 'edge' as const, name: 'Right' },
  ]
  const movingY = [
    { v: moving.y, type: 'edge' as const, name: 'Top' },
    { v: moving.y + moving.h / 2, type: 'center' as const, name: 'Center' },
    { v: moving.y + moving.h, type: 'edge' as const, name: 'Bottom' },
  ]

  let bestX: AlignCandidate | null = null
  let bestY: AlignCandidate | null = null

  // 1. Evaluate against other shapes
  for (const shape of otherShapes) {
    if (shape.locked) continue
    const b = shapeBounds(shape)

    const targetsX = [
      { v: b.x, type: 'edge' as const, name: 'Left' },
      { v: b.x + b.w / 2, type: 'center' as const, name: 'Center' },
      { v: b.x + b.w, type: 'edge' as const, name: 'Right' },
    ]
    const targetsY = [
      { v: b.y, type: 'edge' as const, name: 'Top' },
      { v: b.y + b.h / 2, type: 'center' as const, name: 'Center' },
      { v: b.y + b.h, type: 'edge' as const, name: 'Bottom' },
    ]

    for (const mx of movingX) {
      for (const tx of targetsX) {
        const d = tx.v - mx.v
        const absD = Math.abs(d)
        if (absD <= radiusWorld) {
          let category: 'center' | 'edge-edge' | 'edge-center'
          let mult = 1.0
          let label = ''
          let color = '#44b8ff'

          if (mx.type === 'center' && tx.type === 'center') {
            category = 'center'
            mult = 0.55 // Highest magnetic priority for center-to-center
            label = 'Center to Center'
            color = '#06b6d4'
          } else if (mx.type === 'edge' && tx.type === 'edge') {
            category = 'edge-edge'
            mult = 0.8
            label = mx.name === tx.name ? `Edge to Edge (${mx.name})` : `Edge to Edge (${mx.name} → ${tx.name})`
            color = '#f59e0b'
          } else {
            category = 'edge-center'
            mult = 1.0
            label = `Edge to Center (${mx.name} → ${tx.name})`
            color = '#8b5cf6'
          }

          const score = absD * mult
          if (!bestX || score < bestX.priorityScore) {
            bestX = { delta: d, target: tx.v, label, color, priorityScore: score }
          }
        }
      }
    }

    for (const my of movingY) {
      for (const ty of targetsY) {
        const d = ty.v - my.v
        const absD = Math.abs(d)
        if (absD <= radiusWorld) {
          let mult = 1.0
          let label = ''
          let color = '#ff8a3c'

          if (my.type === 'center' && ty.type === 'center') {
            mult = 0.55
            label = 'Center to Center'
            color = '#06b6d4'
          } else if (my.type === 'edge' && ty.type === 'edge') {
            mult = 0.8
            label = my.name === ty.name ? `Edge to Edge (${my.name})` : `Edge to Edge (${my.name} → ${ty.name})`
            color = '#f59e0b'
          } else {
            mult = 1.0
            label = `Edge to Center (${my.name} → ${ty.name})`
            color = '#8b5cf6'
          }

          const score = absD * mult
          if (!bestY || score < bestY.priorityScore) {
            bestY = { delta: d, target: ty.v, label, color, priorityScore: score }
          }
        }
      }
    }
  }

  // 2. Evaluate against Machine Bed / Page boundaries and centers
  if (page) {
    const pageTargetsX = [
      { v: 0, type: 'edge' as const, name: 'Bed Left' },
      { v: page.width / 2, type: 'center' as const, name: 'Bed Center' },
      { v: page.width, type: 'edge' as const, name: 'Bed Right' },
    ]
    const pageTargetsY = [
      { v: 0, type: 'edge' as const, name: 'Bed Top' },
      { v: page.height / 2, type: 'center' as const, name: 'Bed Center' },
      { v: page.height, type: 'edge' as const, name: 'Bed Bottom' },
    ]

    for (const mx of movingX) {
      for (const tx of pageTargetsX) {
        const d = tx.v - mx.v
        const absD = Math.abs(d)
        if (absD <= radiusWorld) {
          const isCenter = mx.type === 'center' && tx.type === 'center'
          const mult = isCenter ? 0.6 : 0.85
          const score = absD * mult
          if (!bestX || score < bestX.priorityScore) {
            bestX = {
              delta: d,
              target: tx.v,
              label: isCenter ? 'Bed Center X' : `Bed ${tx.name}`,
              color: isCenter ? '#10b981' : '#64748b',
              priorityScore: score,
            }
          }
        }
      }
    }

    for (const my of movingY) {
      for (const ty of pageTargetsY) {
        const d = ty.v - my.v
        const absD = Math.abs(d)
        if (absD <= radiusWorld) {
          const isCenter = my.type === 'center' && ty.type === 'center'
          const mult = isCenter ? 0.6 : 0.85
          const score = absD * mult
          if (!bestY || score < bestY.priorityScore) {
            bestY = {
              delta: d,
              target: ty.v,
              label: isCenter ? 'Bed Center Y' : `Bed ${ty.name}`,
              color: isCenter ? '#10b981' : '#64748b',
              priorityScore: score,
            }
          }
        }
      }
    }
  }

  const rays: SnapRay[] = []
  if (bestX) rays.push({ axis: 'x', position: bestX.target, color: bestX.color, label: bestX.label })
  if (bestY) rays.push({ axis: 'y', position: bestY.target, color: bestY.color, label: bestY.label })

  return {
    dx: bestX?.delta ?? 0,
    dy: bestY?.delta ?? 0,
    rays,
    label: [bestX?.label, bestY?.label].filter(Boolean).join(' · '),
  }
}

export function guideRaysForSnap(hit: SnapHit, otherShapes: Shape[], all: boolean): SnapRay[] {
  if (!all) return [{ axis: 'y', position: hit.y, color: '#44b8ff' }, { axis: 'x', position: hit.x, color: '#ff8a3c' }]
  const rays: SnapRay[] = []
  for (const shape of otherShapes) {
    const b = shapeBounds(shape)
    if (Math.abs(b.y + b.h / 2 - hit.y) < 0.4 || Math.abs(b.y - hit.y) < 0.4 || Math.abs(b.y + b.h - hit.y) < 0.4) {
      rays.push({ axis: 'y', position: hit.y, color: '#44b8ff' })
      break
    }
    if (Math.abs(b.x + b.w / 2 - hit.x) < 0.4 || Math.abs(b.x - hit.x) < 0.4 || Math.abs(b.x + b.w - hit.x) < 0.4) {
      rays.push({ axis: 'x', position: hit.x, color: '#ff8a3c' })
      break
    }
  }
  if (!rays.length) return [{ axis: 'y', position: hit.y, color: '#44b8ff' }, { axis: 'x', position: hit.x, color: '#ff8a3c' }]
  return rays
}

export function kindPriority(kind: SnapKind): number {
  switch (kind) {
    case 'intersection': return 0
    case 'node': return 1
    case 'quadrant': return 2
    case 'midpoint': return 3
    case 'center': return 4
    case 'centroid': return 5
    case 'guide': return 6
    case 'grid': return 7
    case 'perpendicular': return 8
    case 'tangent': return 9
  }
}

export function selectedShapes(doc: DocumentModel, ids: string[]): Shape[] {
  return ids.map(id => getShape(doc, id)).filter((s): s is Shape => !!s)
}

function distToBounds(p: Pt, b: Bounds): number {
  const dx = Math.max(b.x - p.x, 0, p.x - (b.x + b.w))
  const dy = Math.max(b.y - p.y, 0, p.y - (b.y + b.h))
  return Math.hypot(dx, dy)
}
function boundsOverlap(a: Bounds, b: Bounds, pad = 0): boolean {
  return a.x - pad < b.x + b.w && a.x + a.w + pad > b.x && a.y - pad < b.y + b.h && a.y + a.h + pad > b.y
}
