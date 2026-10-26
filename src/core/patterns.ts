import { Pt, boundsCenter, deg, dist, rotateSubpaths, translateSubpaths, uid } from './geometry'
import {
  GridPatternSettings, RadialPatternSettings, Shape, cloneShape, makeFill, makeShadow, makeStroke, shapeBounds,
} from './model'

export function gridPattern(shape: Shape, s: GridPatternSettings): Shape[] {
  const b = shapeBounds(shape)
  const cols = Math.max(1, Math.round(s.columns))
  const rows = Math.max(1, Math.round(s.rows))
  const stepX = s.mode === 'spacing' ? b.w + s.dx : s.dx
  const stepY = s.mode === 'spacing' ? b.h + s.dy : s.dy
  const out: Shape[] = []
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      if (r === 0 && c === 0) continue
      const copy = cloneShape(shape, s.directionX * c * stepX, s.directionY * r * stepY, `${shape.name} · ${c + 1},${r + 1}`)
      copy.meta = { ...(copy.meta ?? {}), pattern: 'grid', row: r, col: c }
      out.push(copy)
    }
  }
  return out
}

export function gridPatternCount(s: GridPatternSettings): number {
  return Math.max(1, Math.round(s.columns)) * Math.max(1, Math.round(s.rows)) - 1
}

export function radialPattern(shape: Shape, s: RadialPatternSettings): Shape[] {
  const b = shapeBounds(shape)
  const center = boundsCenter(b)
  const pivot = { x: s.pivotX, y: s.pivotY }
  const copies = Math.max(1, Math.round(s.copies))
  const span = s.span
  const step = radialStep(span, copies)
  const baseVector = { x: center.x - pivot.x, y: center.y - pivot.y }
  const baseAngle = Math.atan2(baseVector.y, baseVector.x)
  const radius = s.radius > 0 ? s.radius : dist(center, pivot)
  const start = baseAngle + (s.startAngle * Math.PI) / 180
  const out: Shape[] = []
  for (let k = 1; k <= copies; k++) {
    const theta = start + (k * step * Math.PI) / 180
    const target = { x: pivot.x + Math.cos(theta) * radius, y: pivot.y + Math.sin(theta) * radius }
    const orientation = s.rotateWithShape ? ((s.startAngle + k * step) * Math.PI) / 180 : 0
    let subpaths = shape.subpaths
    if (orientation) subpaths = rotateSubpaths(subpaths, center, orientation)
    subpaths = translateSubpaths(subpaths, target.x - center.x, target.y - center.y)
    const copy = cloneShape(shape, 0, 0, `${shape.name} · ${String(k + 1).padStart(2, '0')}`)
    copy.id = uid('shape')
    copy.subpaths = subpaths
    if (shape.clip) {
      let clip = shape.clip
      if (orientation) clip = rotateSubpaths(clip, center, orientation)
      copy.clip = translateSubpaths(clip, target.x - center.x, target.y - center.y)
    }
    copy.fill = makeFill(shape.fill)
    copy.stroke = makeStroke(shape.stroke)
    copy.shadow = makeShadow(shape.shadow)
    if (copy.text) {
      copy.text = {
        ...copy.text,
        box: { ...copy.text.box, x: copy.text.box.x + target.x - center.x, y: copy.text.box.y + target.y - center.y },
        rotation: (shape.text?.rotation ?? 0) + orientation,
      }
    }
    copy.meta = { ...(shape.meta ?? {}), pattern: 'radial', copy: k, angle: start + (k * step * Math.PI) / 180 }
    // keep text untouched if present: rotate only path geometry; text copies stay upright
    out.push(copy)
  }
  return out
}

export function radialPreviewCenters(self: Shape, s: RadialPatternSettings): { center: Pt; angle: number }[] {
  const b = shapeBounds(self)
  const center = boundsCenter(b)
  const pivot = { x: s.pivotX, y: s.pivotY }
  const copies = Math.max(1, Math.round(s.copies))
  const step = radialStep(s.span, copies)
  const baseAngle = Math.atan2(center.y - pivot.y, center.x - pivot.x)
  const radius = s.radius > 0 ? s.radius : dist(center, pivot)
  const start = baseAngle + (s.startAngle * Math.PI) / 180
  const out: { center: Pt; angle: number }[] = []
  for (let k = 1; k <= copies; k++) {
    const theta = start + (k * step * Math.PI) / 180
    out.push({ center: { x: pivot.x + Math.cos(theta) * radius, y: pivot.y + Math.sin(theta) * radius }, angle: deg(theta) })
  }
  return out
}

export function radialStep(span: number, copies: number): number {
  const n = Math.max(1, Math.round(copies))
  if (Math.abs(span) >= 359.999) return span / (n + 1)
  return span / n
}
