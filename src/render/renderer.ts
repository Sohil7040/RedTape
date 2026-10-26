import { Bounds, Pt, SNAP_LABELS, boundsCenter, clamp, pathToPath2D, segments } from '../core/geometry'
import { EditorState } from '../core/store'
import { textFontFamily, textFontWeight } from '../core/textCurves'
import { OPERATION_COLORS, Shape, getShape, shapeBounds } from '../core/model'
import { SnapHit } from '../core/snapping'
import { smoothCutPath } from '../core/knife'
import { getProductionJob, toolpathPoints } from '../core/production'

export const RULER = 24
const ACCENT = '#0d9488'
const ACCENT_SOFT = 'rgba(13,148,136,0.35)'
const ORANGE = '#ea580c'
const BLUE = '#0284c7'

export type HandleId = 'nw' | 'n' | 'ne' | 'e' | 'se' | 's' | 'sw' | 'w'
export interface ScreenHandle { id: HandleId | 'rotate'; x: number; y: number }

export function selectionHandles(b: Bounds, state: EditorState): ScreenHandle[] {
  const v = state.view
  const x = (n: number) => n * v.zoom + v.panX
  const y = (n: number) => n * v.zoom + v.panY
  const left = x(b.x), right = x(b.x + b.w), top = y(b.y), bottom = y(b.y + b.h)
  const cx = (left + right) / 2, cy = (top + bottom) / 2
  return [
    { id: 'nw', x: left, y: top }, { id: 'n', x: cx, y: top }, { id: 'ne', x: right, y: top },
    { id: 'e', x: right, y: cy }, { id: 'se', x: right, y: bottom }, { id: 's', x: cx, y: bottom },
    { id: 'sw', x: left, y: bottom }, { id: 'w', x: left, y: cy },
    { id: 'rotate', x: cx, y: top - 27 },
  ]
}

export function renderScene(ctx: CanvasRenderingContext2D, state: EditorState, dpr: number): void {
  const { view, doc } = state
  const W = view.width, H = view.height
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
  ctx.clearRect(0, 0, W, H)
  // Light modern drafting workspace background
  ctx.fillStyle = state.theme === 'dark' ? '#171b20' : '#F5F6F7'
  ctx.fillRect(0, 0, W, H)
  // Keep the work surface quiet; the optional document grid supplies precision.

  // page block
  const pw = doc.page.width * view.zoom
  const ph = doc.page.height * view.zoom
  ctx.save()
  ctx.fillStyle = state.theme==='dark'?'#101419':'#dde1e5'
  ctx.fillRect(view.panX-1,view.panY-1,pw+2,ph+2)
  ctx.fillStyle = doc.page.color || '#ffffff'
  ctx.fillRect(view.panX, view.panY, pw, ph)
  ctx.restore()

  ctx.save()
  ctx.beginPath()
  ctx.rect(view.panX, view.panY, pw, ph)
  ctx.clip()
  if (doc.grid.enabled) drawGrid(ctx, state)
  ctx.restore()

  drawGuides(ctx, state)
  drawPageLabel(ctx, state)

  // world pass
  if (doc.production.preview) {
    drawProductionPreview(ctx, state)
  } else {
    ctx.save()
    ctx.translate(view.panX, view.panY)
    ctx.scale(view.zoom, view.zoom)
    for (const layer of doc.layers) {
      if (!layer.visible) continue
      for (const shape of layer.shapes) {
        if (shape.hidden || !shapeOnScreen(shape, state)) continue
        drawShape(ctx, shape, state)
      }
    }
    ctx.restore()
  }

  drawHoverAndCenters(ctx, state)
  drawSelection(ctx, state)
  drawDraft(ctx, state)
  drawSnap(ctx, state)
  if (state.showRulers) drawRulers(ctx, state)
  drawRulerCursor(ctx, state)
}

function drawProductionPreview(ctx: CanvasRenderingContext2D, state: EditorState): void {
  const { view, doc } = state
  const job = getProductionJob(doc)
  const left = view.panX, top = view.panY
  const w = doc.page.width * view.zoom, h = doc.page.height * view.zoom

  ctx.save()
  // High-contrast technical sheet plate
  ctx.fillStyle = '#0f172a'
  ctx.fillRect(left, top, w, h)

  // Material honeycomb grid
  ctx.strokeStyle = 'rgba(148,163,184,0.08)'
  ctx.lineWidth = 1
  const step = 25 * view.zoom
  if (step > 8) {
    ctx.beginPath()
    for (let x = left + step; x < left + w; x += step) { ctx.moveTo(Math.round(x) + 0.5, top); ctx.lineTo(Math.round(x) + 0.5, top + h) }
    for (let y = top + step; y < top + h; y += step) { ctx.moveTo(left, Math.round(y) + 0.5); ctx.lineTo(left + w, Math.round(y) + 0.5) }
    ctx.stroke()
  }

  // Margin machine envelope frame
  const mg = doc.production.margin * view.zoom
  ctx.strokeStyle = 'rgba(13,148,136,0.45)'
  ctx.setLineDash([6, 5])
  ctx.lineWidth = 1.2
  ctx.strokeRect(left + mg, top + mg, w - mg * 2, h - mg * 2)
  ctx.setLineDash([])
  ctx.fillStyle = '#14b8a6'
  ctx.font = '700 8px "JetBrains Mono", monospace'
  ctx.fillText('MACHINE ENVELOPE', left + mg + 8, top + mg - 5)

  // Ruida Machine Origin Corner Marker
  const originCorner = doc.production.originCorner || 'bottom-right'
  let ox = left + w - mg, oy = top + mg
  if (originCorner === 'top-left') { ox = left + mg; oy = top + mg }
  else if (originCorner === 'bottom-left') { ox = left + mg; oy = top + h - mg }
  else if (originCorner === 'bottom-right') { ox = left + w - mg; oy = top + h - mg }

  ctx.save()
  ctx.strokeStyle = '#06b6d4'
  ctx.fillStyle = 'rgba(6,182,212,0.18)'
  ctx.lineWidth = 1.5
  ctx.beginPath(); ctx.arc(ox, oy, 8, 0, Math.PI * 2); ctx.fill(); ctx.stroke()
  ctx.beginPath()
  ctx.moveTo(ox - 11, oy); ctx.lineTo(ox + 11, oy)
  ctx.moveTo(ox, oy - 11); ctx.lineTo(ox, oy + 11)
  ctx.stroke()
  ctx.fillStyle = '#38bdf8'
  ctx.font = '700 7px "JetBrains Mono", monospace'
  ctx.fillText('RUIDA ORIGIN (0,0)', ox > left + w / 2 ? ox - 80 : ox + 14, oy > top + h / 2 ? oy - 6 : oy + 12)
  ctx.restore()

  // Ghosted source geometry
  ctx.save()
  ctx.translate(view.panX, view.panY); ctx.scale(view.zoom, view.zoom)
  ctx.strokeStyle = 'rgba(255,255,255,0.08)'
  ctx.fillStyle = 'rgba(255,255,255,0.02)'
  ctx.lineWidth = 1 / view.zoom
  for (const layer of doc.layers) {
    if (!layer.visible) continue
    for (const shape of layer.shapes) {
      if (shape.hidden) continue
      if (shape.kind === 'text') {
        const b = shapeBounds(shape)
        ctx.strokeRect(b.x, b.y, b.w, b.h)
        // Show unconverted source text for inspection, while preflight still
        // blocks machining until real glyph outlines exist.
        drawTextShape(ctx, { ...shape, fill: { ...shape.fill, type: 'solid', color: '#e2e8f0', opacity: .85 }, stroke: { ...shape.stroke, enabled: false } }, state)
        continue
      }
      const path = pathToPath2D(shape.subpaths)
      if (shape.fill.type !== 'none') ctx.fill(path, shape.fillRule)
      ctx.stroke(path)
    }
  }
  ctx.restore()

  // Rapid traverse moves (G0)
  const toScreen = (p: Pt) => ({ x: p.x * view.zoom + view.panX, y: p.y * view.zoom + view.panY })
  let prevPt: Pt = { x: doc.production.startX, y: doc.production.startY }
  ctx.save()
  ctx.strokeStyle = 'rgba(239,68,68,0.35)'
  ctx.lineWidth = 1
  ctx.setLineDash([3, 4])
  ctx.beginPath()
  for (const path of job.paths) {
    const burn = toolpathPoints(path)
    if (!burn.length) continue
    for (let pass = 0; pass < path.passes; pass++) {
      const p0 = toScreen(burn[0]), pPrev = toScreen(prevPt)
      ctx.moveTo(pPrev.x, pPrev.y); ctx.lineTo(p0.x, p0.y)
      prevPt = burn[burn.length - 1]
    }
  }
  ctx.stroke()
  ctx.setLineDash([])
  ctx.restore()

  // Toolpaths
  ctx.save()
  ctx.lineCap = 'round'
  ctx.lineJoin = 'round'
  for (const path of job.paths) {
    const color = path.color || OPERATION_COLORS[path.operation] || '#38bdf8'
    const selected = state.selection.includes(path.shapeId)
    ctx.globalAlpha = state.selection.length && !selected ? .28 : 1
    const pts = path.points.map(toScreen)
    if (pts.length < 2) continue

    // Kerf band
    if (path.operation === 'cut' && doc.production.kerf > 0 && !path.isHatch) {
      ctx.strokeStyle = hexToRgba(color, 0.18)
      ctx.lineWidth = Math.max(1.8, doc.production.kerf * view.zoom)
      ctx.beginPath()
      pts.forEach((p, i) => i === 0 ? ctx.moveTo(p.x, p.y) : ctx.lineTo(p.x, p.y))
      if (path.closed) ctx.closePath()
      ctx.stroke()
    }

    ctx.strokeStyle = hexToRgba(color, path.isHatch ? 0.5 : 0.95)
    ctx.lineWidth = (path.isHatch ? 0.7 : path.operation === 'cut' ? 1.8 : 1.2) + (selected ? 1 : 0)
    if (path.operation === 'engrave' && !path.isHatch) { ctx.shadowColor = hexToRgba(color, 0.6); ctx.shadowBlur = 4 }
    ctx.beginPath()
    pts.forEach((p, i) => i === 0 ? ctx.moveTo(p.x, p.y) : ctx.lineTo(p.x, p.y))
    if (path.closed) ctx.closePath()
    ctx.stroke()
    ctx.shadowBlur = 0

    // Lead-ins
    if (path.leadIn.length > 1 && !path.isHatch) {
      const a = toScreen(path.leadIn[0]), b = toScreen(path.leadIn[1])
      ctx.strokeStyle = '#14b8a6'
      ctx.lineWidth = 1.2
      ctx.setLineDash([3, 3])
      ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y); ctx.stroke()
      ctx.setLineDash([])
      ctx.fillStyle = '#14b8a6'
      ctx.beginPath(); ctx.arc(a.x, a.y, 2.5, 0, Math.PI * 2); ctx.fill()
    }

    // Sequence numbers
    if (doc.production.showSequence && !path.isHatch && path.operation !== 'engrave' && job.contourCount <= 120) {
      const sp = toScreen(path.points[0])
      ctx.fillStyle = 'rgba(15,23,42,0.92)'
      ctx.strokeStyle = hexToRgba(color, 0.7)
      ctx.lineWidth = 1
      ctx.beginPath()
      ctx.roundRect ? ctx.roundRect(sp.x + 5, sp.y - 14, 18, 13, 3) : ctx.rect(sp.x + 5, sp.y - 14, 18, 13)
      ctx.fill(); ctx.stroke()
      ctx.fillStyle = '#f8fafc'
      ctx.font = '700 7.5px "JetBrains Mono", monospace'
      ctx.fillText(String(path.order).padStart(2, '0'), sp.x + 8, sp.y - 5)
    }

    if (!path.isHatch) {
      const sp = toScreen(path.points[0])
      ctx.fillStyle = color
      ctx.beginPath(); ctx.arc(sp.x, sp.y, 2.2, 0, Math.PI * 2); ctx.fill()
    }
  }
  ctx.restore()

  // Simulated Laser Head
  if (state.sim.headPos) {
    const hx = state.sim.headPos.x * view.zoom + view.panX
    const hy = state.sim.headPos.y * view.zoom + view.panY
    const laserOn = state.sim.laserOn

    ctx.save()
    // Laser spot glow when laser is ON
    if (laserOn) {
      const grad = ctx.createRadialGradient(hx, hy, 1, hx, hy, 14)
      grad.addColorStop(0, 'rgba(255,255,255,1)')
      grad.addColorStop(0.25, 'rgba(239,68,68,0.95)')
      grad.addColorStop(0.65, 'rgba(244,63,94,0.45)')
      grad.addColorStop(1, 'rgba(244,63,94,0)')
      ctx.fillStyle = grad
      ctx.beginPath(); ctx.arc(hx, hy, 14, 0, Math.PI * 2); ctx.fill()
    }

    // Laser head outer nozzle ring
    ctx.strokeStyle = laserOn ? '#f43f5e' : '#38bdf8'
    ctx.lineWidth = 1.6
    ctx.beginPath(); ctx.arc(hx, hy, 9, 0, Math.PI * 2); ctx.stroke()

    // Inner nozzle orifice
    ctx.fillStyle = laserOn ? '#ffffff' : '#0284c7'
    ctx.beginPath(); ctx.arc(hx, hy, 2.5, 0, Math.PI * 2); ctx.fill()

    // Crosshairs
    ctx.strokeStyle = laserOn ? 'rgba(244,63,94,0.7)' : 'rgba(56,189,248,0.7)'
    ctx.lineWidth = 1
    ctx.beginPath()
    ctx.moveTo(hx - 14, hy); ctx.lineTo(hx - 10, hy)
    ctx.moveTo(hx + 10, hy); ctx.lineTo(hx + 14, hy)
    ctx.moveTo(hx, hy - 14); ctx.lineTo(hx, hy - 10)
    ctx.moveTo(hx, hy + 10); ctx.lineTo(hx, hy + 14)
    ctx.stroke()

    // Floating laser head HUD badge
    const badgeW = 110, badgeH = 22
    const bx = hx + 14, by = hy - 26
    ctx.fillStyle = 'rgba(15,23,42,0.94)'
    ctx.strokeStyle = laserOn ? '#ef4444' : '#0284c7'
    ctx.lineWidth = 1
    ctx.beginPath()
    ctx.roundRect ? ctx.roundRect(bx, by, badgeW, badgeH, 4) : ctx.rect(bx, by, badgeW, badgeH)
    ctx.fill(); ctx.stroke()

    ctx.fillStyle = laserOn ? '#ef4444' : '#38bdf8'
    ctx.font = '700 7px "JetBrains Mono", monospace'
    ctx.fillText(laserOn ? '● LASER ON' : '○ RAPID G0', bx + 6, by + 9)

    ctx.fillStyle = '#94a3b8'
    ctx.font = '600 7px "JetBrains Mono", monospace'
    ctx.fillText(`X:${state.sim.headPos.x.toFixed(1)} Y:${state.sim.headPos.y.toFixed(1)}`, bx + 6, by + 18)
    ctx.restore()
  }


}

function formatTime(s: number): string {
  if (s < 60) return `${Math.round(s)}S`
  return `${Math.floor(s / 60)}M ${Math.round(s % 60)}S`
}

function drawWorkspaceTexture(ctx: CanvasRenderingContext2D, W: number, H: number): void {
  ctx.save()
  ctx.fillStyle = 'rgba(15,23,42,0.06)'
  for (let x = RULER + 12; x < W; x += 24) for (let y = RULER + 12; y < H; y += 24) ctx.fillRect(x, y, 1.2, 1.2)
  ctx.restore()
}

function drawPageLabel(ctx: CanvasRenderingContext2D, state: EditorState): void {
  const { view, doc } = state
  const y = view.panY - 14
  if (y < RULER + 2) return
  ctx.save()
  ctx.font = '600 10px "Inter", "SF Pro Text", system-ui, sans-serif'
  ctx.fillStyle = '#64748b'
  ctx.textBaseline = 'bottom'
  ctx.fillText(`${doc.page.name.toUpperCase()}  ·  ${doc.page.width} × ${doc.page.height} MM`, view.panX, y)
  ctx.restore()
}

function drawGrid(ctx: CanvasRenderingContext2D, state: EditorState): void {
  const { view, doc } = state
  const g = doc.grid
  const minor = g.size / Math.max(1, g.subdivisions)
  const originX = view.panX, originY = view.panY
  const maxX = view.panX + doc.page.width * view.zoom
  const maxY = view.panY + doc.page.height * view.zoom
  ctx.save()
  if (minor * view.zoom >= 5) {
    ctx.strokeStyle = 'rgba(58,50,40,0.12)'
    ctx.lineWidth = 1
    ctx.beginPath()
    for (let x = 0; x <= doc.page.width + 0.01; x += minor) {
      const sx = Math.round(originX + x * view.zoom) + 0.5
      ctx.moveTo(sx, originY); ctx.lineTo(sx, maxY)
    }
    for (let y = 0; y <= doc.page.height + 0.01; y += minor) {
      const sy = Math.round(originY + y * view.zoom) + 0.5
      ctx.moveTo(originX, sy); ctx.lineTo(maxX, sy)
    }
    ctx.stroke()
  }
  if (g.size * view.zoom >= 6) {
    ctx.strokeStyle = 'rgba(58,50,40,0.24)'
    ctx.lineWidth = 1
    ctx.beginPath()
    for (let x = 0; x <= doc.page.width + 0.01; x += g.size) {
      const sx = Math.round(originX + x * view.zoom) + 0.5
      ctx.moveTo(sx, originY); ctx.lineTo(sx, maxY)
    }
    for (let y = 0; y <= doc.page.height + 0.01; y += g.size) {
      const sy = Math.round(originY + y * view.zoom) + 0.5
      ctx.moveTo(originX, sy); ctx.lineTo(maxX, sy)
    }
    ctx.stroke()
  }
  ctx.restore()
}

function drawGuides(ctx: CanvasRenderingContext2D, state: EditorState): void {
  const { view, doc } = state
  ctx.save()
  ctx.setLineDash([5, 5])
  ctx.strokeStyle = 'rgba(75,147,255,0.56)'
  ctx.lineWidth = 1
  for (const guide of doc.guides) {
    ctx.beginPath()
    if (guide.orientation === 'v') {
      const x = Math.round(view.panX + guide.position * view.zoom) + 0.5
      ctx.moveTo(x, 0); ctx.lineTo(x, view.height); ctx.stroke()
      drawTinyLabel(ctx, x + 5, RULER + 12, guide.position.toFixed(1), 'rgba(75,147,255,0.9)')
    } else {
      const y = Math.round(view.panY + guide.position * view.zoom) + 0.5
      ctx.moveTo(0, y); ctx.lineTo(view.width, y); ctx.stroke()
      drawTinyLabel(ctx, RULER + 5, y - 4, guide.position.toFixed(1), 'rgba(75,147,255,0.9)')
    }
  }
  ctx.restore()
}

function drawTinyLabel(ctx: CanvasRenderingContext2D, x: number, y: number, text: string, color: string): void {
  ctx.save()
  ctx.setLineDash([])
  ctx.font = '600 8px "JetBrains Mono", monospace'
  ctx.fillStyle = color
  ctx.fillText(text, x, y)
  ctx.restore()
}

function shapeOnScreen(shape: Shape, state: EditorState): boolean {
  const b = shapeBounds(shape)
  const v = state.view
  const x = b.x * v.zoom + v.panX, y = b.y * v.zoom + v.panY
  return x + b.w * v.zoom > -20 && y + b.h * v.zoom > -20 && x < v.width + 20 && y < v.height + 20
}

export function drawShape(ctx: CanvasRenderingContext2D, shape: Shape, state: EditorState): void {
  const path = pathToPath2D(shape.subpaths)
  const b = shapeBounds(shape)
  ctx.save()
  ctx.globalAlpha *= shape.opacity
  if (shape.clip?.length) ctx.clip(pathToPath2D(shape.clip), shape.fillRule)
  if (shape.shadow.enabled) {
    ctx.shadowColor = hexToRgba(shape.shadow.color, shape.shadow.opacity)
    ctx.shadowBlur = shape.shadow.blur * state.view.zoom
    ctx.shadowOffsetX = shape.shadow.x * state.view.zoom
    ctx.shadowOffsetY = shape.shadow.y * state.view.zoom
  }
  if (shape.kind === 'text' && shape.text) {
    drawTextShape(ctx, shape, state)
  } else {
    if (shape.fill.type === 'mesh') {
      ctx.save()
      ctx.clip(path, shape.fillRule)
      drawMeshFill(ctx, shape.fill, b)
      ctx.restore()
    } else if (shape.fill.type !== 'none') {
      ctx.fillStyle = makeFillStyle(ctx, shape, b)
      ctx.fill(path, shape.fillRule)
    }
    if (shape.stroke.enabled && shape.stroke.width > 0) {
      ctx.strokeStyle = hexToRgba(shape.stroke.color, shape.stroke.opacity)
      ctx.lineWidth = shape.scaleStroke === false ? 0.25 : shape.stroke.width
      ctx.lineCap = shape.stroke.cap
      ctx.lineJoin = shape.stroke.join
      ctx.setLineDash(shape.stroke.dash)
      ctx.stroke(path)
    }
  }
  ctx.restore()
}

function drawTextShape(ctx: CanvasRenderingContext2D, shape: Shape, state: EditorState): void {
  const t = shape.text!
  ctx.save()
  ctx.fillStyle = makeFillStyle(ctx, shape, t.box)
  let family = 'Corelith Sans'
  try { family = textFontFamily(t.fontFamily) } catch { /* legacy unknown font: visible fallback; conversion requires an explicit choice */ }
  ctx.font = `${textFontWeight(t.fontWeight)} ${t.fontSize}px "${family}", sans-serif`
  ctx.fontKerning = 'normal'
  ctx.textAlign = t.align
  ctx.textBaseline = 'alphabetic'
  if (t.rotation) {
    const cx = t.box.x + t.box.w / 2, cy = t.box.y + t.box.h / 2
    ctx.translate(cx, cy); ctx.rotate(t.rotation); ctx.translate(-cx, -cy)
  }
  try { (ctx as unknown as { letterSpacing: string }).letterSpacing = `${t.letterSpacing}px` } catch { /* unsupported */ }
  const lines = t.content.split('\n')
  const ax = t.align === 'center' ? t.box.x + t.box.w / 2 : t.align === 'right' ? t.box.x + t.box.w : t.box.x
  if (shape.stroke.enabled && shape.stroke.width > 0) {
    ctx.strokeStyle = hexToRgba(shape.stroke.color, shape.stroke.opacity)
    ctx.lineWidth = shape.scaleStroke === false ? .25 : shape.stroke.width
    ctx.lineCap = shape.stroke.cap; ctx.lineJoin = shape.stroke.join
    ctx.setLineDash(shape.stroke.dash)
  }
  for (let i = 0; i < lines.length; i++) {
    const y = t.box.y + t.fontSize * .82 + i * t.fontSize * 1.12
    if (shape.fill.type !== 'none') ctx.fillText(lines[i], ax, y)
    if (shape.stroke.enabled && shape.stroke.width > 0) ctx.strokeText(lines[i], ax, y)
  }
  ctx.restore()
  void state
}

function makeFillStyle(ctx: CanvasRenderingContext2D, shape: Shape, b: Bounds): string | CanvasGradient | CanvasPattern {
  const f = shape.fill
  if (f.type === 'solid') return hexToRgba(f.color, f.opacity)
  if (f.type === 'linear') {
    const a = (f.angle * Math.PI) / 180
    const cx = b.x + b.w / 2, cy = b.y + b.h / 2
    const r = Math.hypot(b.w, b.h) / 2
    const g = ctx.createLinearGradient(cx - Math.cos(a) * r, cy - Math.sin(a) * r, cx + Math.cos(a) * r, cy + Math.sin(a) * r)
    for (const s of f.stops) g.addColorStop(clamp(s.offset, 0, 1), hexToRgba(s.color, f.opacity))
    return g
  }
  if (f.type === 'radial') {
    const cx = b.x + b.w / 2, cy = b.y + b.h / 2
    const g = ctx.createRadialGradient(cx, cy, 0, cx, cy, Math.max(0.1, Math.hypot(b.w, b.h) / 2))
    for (const s of f.stops) g.addColorStop(clamp(s.offset, 0, 1), hexToRgba(s.color, f.opacity))
    return g
  }
  if (f.type === 'pattern') return patternFill(ctx, f.pattern ?? 'dots', f.color, f.opacity)
  if (f.type === 'mesh') {
    const cols = f.stops.map(s => s.color)
    const g = ctx.createLinearGradient(b.x, b.y, b.x + b.w, b.y + b.h)
    g.addColorStop(0, cols[0] ?? f.color); g.addColorStop(0.5, cols[1] ?? f.color); g.addColorStop(1, cols[2] ?? f.color)
    return g
  }
  return 'transparent'
}

const meshCache = new Map<string, HTMLCanvasElement>()
export function meshFillCanvas(colors: string[], size = 72): HTMLCanvasElement {
  const key = `${colors.join('|')}@${size}`
  const hit = meshCache.get(key)
  if (hit) return hit
  const c = document.createElement('canvas')
  c.width = c.height = size
  const g = c.getContext('2d')!
  const img = g.createImageData(size, size)
  const pick = (i: number) => colors[i % Math.max(1, colors.length)] ?? '#808080'
  const rgb = (hex: string): [number, number, number] => {
    let h = hex.replace('#', '')
    if (h.length === 3) h = h.split('').map(x => x + x).join('')
    if (h.length !== 6) return [128, 128, 128]
    return [parseInt(h.slice(0, 2), 16), parseInt(h.slice(2, 4), 16), parseInt(h.slice(4, 6), 16)]
  }
  const c0 = rgb(pick(0)), c1 = rgb(pick(1)), c2 = rgb(pick(2)), c3 = rgb(pick(3))
  for (let y = 0; y < size; y++) {
    const v = y / (size - 1)
    for (let x = 0; x < size; x++) {
      const u = x / (size - 1)
      const top = [c0[0] + (c1[0] - c0[0]) * u, c0[1] + (c1[1] - c0[1]) * u, c0[2] + (c1[2] - c0[2]) * u]
      const bot = [c2[0] + (c3[0] - c2[0]) * u, c2[1] + (c3[1] - c2[1]) * u, c2[2] + (c3[2] - c2[2]) * u]
      const i = (y * size + x) * 4
      img.data[i] = top[0] + (bot[0] - top[0]) * v
      img.data[i + 1] = top[1] + (bot[1] - top[1]) * v
      img.data[i + 2] = top[2] + (bot[2] - top[2]) * v
      img.data[i + 3] = 255
    }
  }
  g.putImageData(img, 0, 0)
  meshCache.set(key, c)
  return c
}
function drawMeshFill(ctx: CanvasRenderingContext2D, fill: Shape['fill'], b: Bounds): void {
  if (b.w <= 0 || b.h <= 0) return
  const canvas = meshFillCanvas(fill.stops.map(s => s.color))
  ctx.save()
  ctx.globalAlpha *= fill.opacity
  ctx.imageSmoothingEnabled = true
  ctx.drawImage(canvas, b.x, b.y, b.w, b.h)
  ctx.restore()
}

const patternCache = new Map<string, CanvasPattern | null>()
function patternFill(ctx: CanvasRenderingContext2D, kind: string, color: string, opacity: number): CanvasPattern | string {
  const key = `${kind}:${color}:${opacity}`
  if (patternCache.has(key)) return patternCache.get(key) ?? 'transparent'
  const c = document.createElement('canvas')
  c.width = c.height = 24
  const g = c.getContext('2d')!
  g.fillStyle = hexToRgba(color, opacity)
  g.strokeStyle = hexToRgba(color, opacity)
  if (kind === 'dots') {
    g.beginPath(); g.arc(6, 6, 2, 0, Math.PI * 2); g.fill()
    g.beginPath(); g.arc(18, 18, 2, 0, Math.PI * 2); g.fill()
  } else if (kind === 'lines') {
    g.lineWidth = 2
    g.beginPath(); g.moveTo(-4, 24); g.lineTo(24, -4); g.moveTo(8, 28); g.lineTo(28, 8); g.stroke()
  } else {
    g.fillRect(0, 0, 12, 12); g.fillRect(12, 12, 12, 12)
  }
  const pattern = ctx.createPattern(c, 'repeat')
  patternCache.set(key, pattern)
  return pattern ?? 'transparent'
}

function drawSelection(ctx: CanvasRenderingContext2D, state: EditorState): void {
  const shapes = state.selection.map(id => getShape(state.doc, id)).filter((s): s is Shape => !!s)
  if (!shapes.length) return
  const b = unionOf(shapes.map(shapeBounds))
  const v = state.view
  const left = b.x * v.zoom + v.panX, top = b.y * v.zoom + v.panY
  const w = b.w * v.zoom, h = b.h * v.zoom

  ctx.save()
  ctx.strokeStyle = ACCENT_SOFT
  ctx.lineWidth = 1
  for (const shape of shapes) {
    if (shape.kind === 'text') {
      const sb = shapeBounds(shape)
      ctx.strokeRect(sb.x * v.zoom + v.panX, sb.y * v.zoom + v.panY, sb.w * v.zoom, sb.h * v.zoom)
    } else {
      ctx.save()
      ctx.translate(v.panX, v.panY); ctx.scale(v.zoom, v.zoom)
      ctx.lineWidth = 1 / v.zoom
      ctx.stroke(pathToPath2D(shape.subpaths))
      ctx.restore()
    }
  }
  ctx.restore()

  ctx.save()
  ctx.strokeStyle = ACCENT
  ctx.lineWidth = 1
  ctx.strokeRect(Math.round(left) + 0.5, Math.round(top) + 0.5, Math.round(w), Math.round(h))
  const cx = left + w / 2
  ctx.strokeStyle = 'rgba(99,230,193,0.55)'
  ctx.beginPath(); ctx.moveTo(cx, top); ctx.lineTo(cx, top - 27); ctx.stroke()
  for (const hd of selectionHandles(b, state)) {
    if (hd.id === 'rotate') {
      ctx.beginPath(); ctx.arc(hd.x, hd.y, 4.5, 0, Math.PI * 2)
      ctx.fillStyle = '#101318'; ctx.fill()
      ctx.strokeStyle = ACCENT; ctx.lineWidth = 1.4; ctx.stroke()
      ctx.beginPath(); ctx.arc(hd.x, hd.y, 1.3, 0, Math.PI * 2); ctx.fillStyle = ACCENT; ctx.fill()
    } else {
      ctx.fillStyle = '#f7fbf9'
      ctx.strokeStyle = '#101318'
      ctx.lineWidth = 1
      ctx.fillRect(Math.round(hd.x) - 3.5, Math.round(hd.y) - 3.5, 7, 7)
      ctx.strokeRect(Math.round(hd.x) - 3.5, Math.round(hd.y) - 3.5, 7, 7)
    }
  }
  ctx.restore()

  if (shapes.length === 1 && state.tool === 'node') drawNodeEditor(ctx, state, shapes[0])
  else drawCenterGlyph(ctx, state, b, shapes.length === 1)
  if (v.zoom > 0.28) drawBadge(ctx, left + w / 2 + 8, top + h + 16, `${round(b.w, 1)} × ${round(b.h, 1)} mm`, ACCENT, 'left')
}

function drawCenterGlyph(ctx: CanvasRenderingContext2D, state: EditorState, b: Bounds, showLabel: boolean): void {
  const v = state.view
  const c = { x: (b.x + b.w / 2) * v.zoom + v.panX, y: (b.y + b.h / 2) * v.zoom + v.panY }
  ctx.save()
  ctx.strokeStyle = 'rgba(99,230,193,0.9)'
  ctx.fillStyle = 'rgba(99,230,193,0.9)'
  ctx.lineWidth = 1
  ctx.beginPath(); ctx.arc(c.x, c.y, 6, 0, Math.PI * 2); ctx.stroke()
  ctx.beginPath(); ctx.moveTo(c.x - 10, c.y); ctx.lineTo(c.x + 10, c.y); ctx.moveTo(c.x, c.y - 10); ctx.lineTo(c.x, c.y + 10); ctx.stroke()
  ctx.beginPath(); ctx.arc(c.x, c.y, 1.8, 0, Math.PI * 2); ctx.fill()
  if (showLabel) drawBadge(ctx, c.x + 12, c.y + 13, 'center', 'rgba(99,230,193,0.95)', 'left')
  ctx.restore()
}

function drawNodeEditor(ctx: CanvasRenderingContext2D, state: EditorState, shape: Shape): void {
  const v = state.view
  const sel = state.selectedNode
  const hover = state.hover
  ctx.save()
  ctx.save()
  ctx.translate(v.panX, v.panY); ctx.scale(v.zoom, v.zoom)
  ctx.strokeStyle = 'rgba(99,230,193,0.85)'
  ctx.lineWidth = 1 / v.zoom
  ctx.stroke(pathToPath2D(shape.subpaths))
  ctx.restore()

  if (hover?.segment && hover.segment.shapeId === shape.id) {
    const m = hover.segment.midpoint
    const ms = { x: m.x * v.zoom + v.panX, y: m.y * v.zoom + v.panY }
    ctx.save()
    ctx.fillStyle = BLUE; ctx.shadowColor = BLUE; ctx.shadowBlur = 8
    ctx.fillRect(ms.x - 3.5, ms.y - 3.5, 7, 7)
    ctx.restore()
    drawBadge(ctx, ms.x + 10, ms.y + 14, 'midpoint · double-click to split', BLUE, 'left')
  }
  for (let si = 0; si < shape.subpaths.length; si++) {
    const sub = shape.subpaths[si]
    for (let i = 0; i < sub.nodes.length; i++) {
      const n = sub.nodes[i]
      const p = { x: n.x * v.zoom + v.panX, y: n.y * v.zoom + v.panY }
      const isSelected = !!sel && sel.shapeId === shape.id && sel.subpathIndex === si && sel.nodeIndex === i
      const isHover = !!hover?.node && hover.node.shapeId === shape.id && hover.node.subpathIndex === si && hover.node.nodeIndex === i
      if (isSelected || isHover) {
        for (const which of ['in', 'out'] as const) {
          const hp = n[which]
          const hs = { x: hp.x * v.zoom + v.panX, y: hp.y * v.zoom + v.panY }
          ctx.save()
          ctx.strokeStyle = isSelected ? 'rgba(99,230,193,0.68)' : 'rgba(255,255,255,0.35)'
          ctx.setLineDash([3, 3]); ctx.lineWidth = 1
          ctx.beginPath(); ctx.moveTo(p.x, p.y); ctx.lineTo(hs.x, hs.y); ctx.stroke()
          ctx.setLineDash([])
          ctx.fillStyle = '#101318'; ctx.strokeStyle = isSelected ? ACCENT : 'rgba(255,255,255,0.6)'
          ctx.beginPath(); ctx.arc(hs.x, hs.y, 3.6, 0, Math.PI * 2); ctx.fill(); ctx.stroke()
          ctx.restore()
        }
      }
      if (isSelected) {
        ctx.save(); ctx.shadowColor = ACCENT; ctx.shadowBlur = 6; ctx.fillStyle = ACCENT
        ctx.fillRect(Math.round(p.x) - 4, Math.round(p.y) - 4, 8, 8)
        ctx.restore()
      } else {
        ctx.fillStyle = isHover ? '#fff7e9' : '#f4f0e7'
        ctx.strokeStyle = isHover ? ORANGE : '#101318'
        ctx.lineWidth = 1.2
        ctx.fillRect(Math.round(p.x) - 3.5, Math.round(p.y) - 3.5, 7, 7)
        ctx.strokeRect(Math.round(p.x) - 3.5, Math.round(p.y) - 3.5, 7, 7)
      }
      if (!sub.closed && (i === 0 || i === sub.nodes.length - 1)) {
        ctx.save()
        ctx.strokeStyle = i === 0 ? BLUE : ORANGE
        ctx.lineWidth = 1
        ctx.beginPath(); ctx.arc(p.x, p.y, 6.2, 0, Math.PI * 2); ctx.stroke()
        ctx.restore()
      }
      if (isHover && !isSelected) drawBadge(ctx, p.x + 10, p.y - 12, 'node', 'rgba(255,255,255,0.86)', 'left')
    }
  }
  ctx.restore()
  drawCenterGlyph(ctx, state, shapeBounds(shape), false)
}

function drawHoverAndCenters(ctx: CanvasRenderingContext2D, state: EditorState): void {
  if (state.tool === 'node' || state.tool === 'knife') return
  const hover = state.hover
  if (!hover?.shapeId) return
  const shape = getShape(state.doc, hover.shapeId)
  if (!shape) return
  const b = shapeBounds(shape)
  const v = state.view
  const c = boundsCenter(b)
  if (hover.showCenter) {
    ctx.save()
    ctx.strokeStyle = 'rgba(99,230,193,0.55)'
    ctx.lineWidth = 1
    const sx = c.x * v.zoom + v.panX, sy = c.y * v.zoom + v.panY
    ctx.beginPath(); ctx.arc(sx, sy, 5, 0, Math.PI * 2); ctx.stroke()
    ctx.beginPath(); ctx.moveTo(sx - 8, sy); ctx.lineTo(sx + 8, sy); ctx.moveTo(sx, sy - 8); ctx.lineTo(sx, sy + 8); ctx.stroke()
    ctx.restore()
  }
  if (hover.segment && hover.showMidpoint) {
    const m = hover.segment.midpoint
    const sx = m.x * v.zoom + v.panX, sy = m.y * v.zoom + v.panY
    ctx.save(); ctx.fillStyle = BLUE; ctx.shadowColor = BLUE; ctx.shadowBlur = 7
    ctx.fillRect(sx - 3, sy - 3, 6, 6)
    ctx.restore()
    drawBadge(ctx, sx + 10, sy + 14, 'midpoint', BLUE, 'left')
  }
}

export function drawDraft(ctx: CanvasRenderingContext2D, state: EditorState): void {
  const d = state.draft
  if (!d) return
  const v = state.view
  ctx.save()
  if (d.type === 'shape') {
    ctx.save()
    ctx.translate(v.panX, v.panY)
    ctx.scale(v.zoom, v.zoom)
    ctx.strokeStyle = ACCENT
    ctx.fillStyle = 'rgba(99,230,193,0.08)'
    ctx.lineWidth = 1.25 / v.zoom
    ctx.setLineDash([5 / v.zoom, 4 / v.zoom])
    const b = normRect(d.start, d.current)
    ctx.beginPath()
    if (d.kind === 'ellipse') {
      ctx.beginPath(); ctx.ellipse(b.x + b.w / 2, b.y + b.h / 2, Math.abs(b.w / 2), Math.abs(b.h / 2), 0, 0, Math.PI * 2)
    } else if (d.kind === 'polygon') {
      const cx = b.x + b.w / 2, cy = b.y + b.h / 2, rx = b.w / 2, ry = b.h / 2
      ctx.beginPath()
      for (let i = 0; i < state.polygonSides; i++) {
        const a = -Math.PI / 2 + (i / state.polygonSides) * Math.PI * 2
        const px = cx + Math.cos(a) * rx, py = cy + Math.sin(a) * ry
        if (i === 0) ctx.moveTo(px, py); else ctx.lineTo(px, py)
      }
      ctx.closePath()
    } else if (d.kind === 'line') {
      ctx.beginPath(); ctx.moveTo(d.start.x, d.start.y); ctx.lineTo(d.current.x, d.current.y)
    } else {
      ctx.rect(b.x, b.y, b.w, b.h)
    }
    if (d.kind !== 'line') ctx.fill()
    ctx.stroke()
    ctx.restore()
    drawBadge(ctx, b.x * v.zoom + v.panX + 8, b.y * v.zoom + v.panY - 10, `${round(b.w, 1)} × ${round(b.h, 1)} mm`, ACCENT, 'left')
  } else if (d.type === 'marquee') {
    const b = d.bounds
    ctx.fillStyle = 'rgba(99,230,193,0.08)'
    ctx.strokeStyle = ACCENT
    ctx.lineWidth = 1
    ctx.setLineDash([4, 3])
    ctx.fillRect(b.x * v.zoom + v.panX, b.y * v.zoom + v.panY, b.w * v.zoom, b.h * v.zoom)
    ctx.strokeRect(b.x * v.zoom + v.panX, b.y * v.zoom + v.panY, b.w * v.zoom, b.h * v.zoom)
  } else if (d.type === 'guide') {
    ctx.strokeStyle = 'rgba(75,147,255,0.85)'
    ctx.lineWidth = 1
    ctx.setLineDash([5, 4])
    ctx.beginPath()
    if (d.guide.orientation === 'h') {
      const y = d.guide.position * v.zoom + v.panY
      ctx.moveTo(0, y); ctx.lineTo(v.width, y)
    } else {
      const x = d.guide.position * v.zoom + v.panX
      ctx.moveTo(x, 0); ctx.lineTo(x, v.height)
    }
    ctx.stroke()
  } else if (d.type === 'knife') {
    if (d.anchors.length) {
      const displayAnchors = d.mode === 'bezier' && d.anchors.length > 1 ? smoothCutPath(d.anchors) : d.anchors
      const screenPts = displayAnchors.map(p => ({ x: p.x * v.zoom + v.panX, y: p.y * v.zoom + v.panY }))
      if (state.knife.span === 'gap' && state.knife.width > 0) {
        ctx.strokeStyle = 'rgba(255,154,82,0.12)'
        ctx.lineWidth = Math.max(2, state.knife.width * v.zoom)
        ctx.beginPath(); screenPts.forEach((p, i) => i === 0 ? ctx.moveTo(p.x, p.y) : ctx.lineTo(p.x, p.y))
        if (d.cursor && d.mode !== 'line') ctx.lineTo(d.cursor.x * v.zoom + v.panX, d.cursor.y * v.zoom + v.panY)
        ctx.stroke()
      }
      ctx.strokeStyle = ORANGE
      ctx.lineWidth = 1.4
      ctx.setLineDash([6, 4])
      ctx.beginPath()
      screenPts.forEach((p, i) => i === 0 ? ctx.moveTo(p.x, p.y) : ctx.lineTo(p.x, p.y))
      if (d.cursor && !d.drawing) {
        ctx.lineTo(d.cursor.x * v.zoom + v.panX, d.cursor.y * v.zoom + v.panY)
      }
      ctx.stroke()
      ctx.setLineDash([])
      for (const p of d.anchors) {
        const sx = p.x * v.zoom + v.panX, sy = p.y * v.zoom + v.panY
        ctx.fillStyle = '#101318'; ctx.strokeStyle = ORANGE; ctx.lineWidth = 1.3
        ctx.beginPath(); ctx.arc(sx, sy, 3.4, 0, Math.PI * 2); ctx.fill(); ctx.stroke()
      }
      if (d.cursor) drawBadge(ctx, d.cursor.x * v.zoom + v.panX + 12, d.cursor.y * v.zoom + v.panY - 12, `${d.mode} cut`, ORANGE, 'left')
    }
  } else if (d.type === 'pen') {
    const sub = d.subpath
    ctx.strokeStyle = ACCENT
    ctx.lineWidth = 1.3
    ctx.beginPath()
    if (sub.nodes.length) {
      ctx.moveTo(sub.nodes[0].x * v.zoom + v.panX, sub.nodes[0].y * v.zoom + v.panY)
      for (const seg of segments(sub)) ctx.bezierCurveTo(seg.p1.x * v.zoom + v.panX, seg.p1.y * v.zoom + v.panY, seg.p2.x * v.zoom + v.panX, seg.p2.y * v.zoom + v.panY, seg.p3.x * v.zoom + v.panX, seg.p3.y * v.zoom + v.panY)
      if (d.cursor) {
        const last = sub.nodes[sub.nodes.length - 1]
        ctx.bezierCurveTo(last.out.x * v.zoom + v.panX, last.out.y * v.zoom + v.panY, d.cursor.x * v.zoom + v.panX, d.cursor.y * v.zoom + v.panY, d.cursor.x * v.zoom + v.panX, d.cursor.y * v.zoom + v.panY)
      }
    }
    ctx.stroke()
    for (let i = 0; i < sub.nodes.length; i++) {
      const n = sub.nodes[i]
      const sx = n.x * v.zoom + v.panX, sy = n.y * v.zoom + v.panY
      ctx.fillStyle = '#101318'; ctx.strokeStyle = ACCENT; ctx.lineWidth = 1.2
      ctx.fillRect(sx - 3.5, sy - 3.5, 7, 7); ctx.strokeRect(sx - 3.5, sy - 3.5, 7, 7)
      if (i === 0 && d.closeHint) { ctx.beginPath(); ctx.arc(sx, sy, 8, 0, Math.PI * 2); ctx.strokeStyle = BLUE; ctx.stroke() }
    }
    if (d.cursor) drawBadge(ctx, d.cursor.x * v.zoom + v.panX + 14, d.cursor.y * v.zoom + v.panY + 18, 'click to add · drag for curve · esc to finish', 'rgba(99,230,193,0.8)', 'left')
  }
  ctx.restore()
}

function drawSnap(ctx: CanvasRenderingContext2D, state: EditorState): void {
  const v = state.view
  const hit = state.snapHit
  ctx.save()
  ctx.setLineDash([4, 5])
  ctx.lineWidth = 1
  for (const ray of state.snapRays) {
    ctx.strokeStyle = withOpacity(ray.color, 0.56)
    ctx.beginPath()
    if (ray.axis === 'x') {
      const x = Math.round(ray.position * v.zoom + v.panX) + 0.5
      ctx.moveTo(x, 0); ctx.lineTo(x, v.height); ctx.stroke()
      if (ray.label) drawTinyLabel(ctx, x + 6, v.height - 12, `ALIGN ${ray.label.toUpperCase()}`, withOpacity(ray.color, 0.92))
    } else {
      const y = Math.round(ray.position * v.zoom + v.panY) + 0.5
      ctx.moveTo(0, y); ctx.lineTo(v.width, y); ctx.stroke()
      if (ray.label) drawTinyLabel(ctx, v.width - 92, y - 8, `ALIGN ${ray.label.toUpperCase()}`, withOpacity(ray.color, 0.92))
    }
  }
  ctx.restore()
  if (!hit) return
  const x = hit.x * v.zoom + v.panX, y = hit.y * v.zoom + v.panY
  ctx.save()
  ctx.shadowColor = kindColor(hit.kind); ctx.shadowBlur = 9
  ctx.strokeStyle = kindColor(hit.kind); ctx.fillStyle = '#101318'; ctx.lineWidth = 1.4
  drawSnapGlyph(ctx, hit, x, y)
  ctx.restore()
  const extra = hit.shapeName && !['grid', 'guide', 'intersection'].includes(hit.kind) ? hit.shapeName : undefined
  drawScreenTip(ctx, x + 15, y - 31, SNAP_LABELS[hit.kind], extra)
}

function drawSnapGlyph(ctx: CanvasRenderingContext2D, hit: SnapHit, x: number, y: number): void {
  const c = kindColor(hit.kind)
  switch (hit.kind) {
    case 'node': ctx.fillRect(x - 4, y - 4, 8, 8); ctx.strokeRect(x - 4, y - 4, 8, 8); break
    case 'midpoint': ctx.beginPath(); ctx.rect(x - 4.5, y - 4.5, 9, 9); ctx.fill(); ctx.stroke(); break
    case 'center':
    case 'centroid':
      ctx.beginPath(); ctx.arc(x, y, 5, 0, Math.PI * 2); ctx.fill(); ctx.stroke()
      ctx.beginPath(); ctx.moveTo(x - 9, y); ctx.lineTo(x + 9, y); ctx.moveTo(x, y - 9); ctx.lineTo(x, y + 9); ctx.stroke(); break
    case 'quadrant': ctx.beginPath(); ctx.moveTo(x, y - 5); ctx.lineTo(x + 5, y); ctx.lineTo(x, y + 5); ctx.lineTo(x - 5, y); ctx.closePath(); ctx.fill(); ctx.stroke(); break
    case 'intersection': ctx.beginPath(); ctx.moveTo(x - 5, y - 5); ctx.lineTo(x + 5, y + 5); ctx.moveTo(x + 5, y - 5); ctx.lineTo(x - 5, y + 5); ctx.stroke(); break
    case 'guide': ctx.beginPath(); ctx.arc(x, y, 5, 0, Math.PI * 2); ctx.stroke(); break
    case 'grid': ctx.beginPath(); ctx.moveTo(x - 5, y); ctx.lineTo(x + 5, y); ctx.moveTo(x, y - 5); ctx.lineTo(x, y + 5); ctx.stroke(); break
    case 'perpendicular': ctx.beginPath(); ctx.moveTo(x - 5, y + 5); ctx.lineTo(x + 5, y + 5); ctx.lineTo(x + 5, y - 5); ctx.stroke(); break
    case 'tangent':
      ctx.beginPath(); ctx.arc(x, y, 4.5, 0, Math.PI * 2); ctx.stroke()
      ctx.beginPath(); ctx.arc(x, y, 1.5, 0, Math.PI * 2); ctx.fillStyle = c; ctx.fill(); break
  }
}

function kindColor(kind: string): string {
  if (kind === 'center' || kind === 'centroid') return ACCENT
  if (kind === 'intersection') return '#ff6b81'
  if (kind === 'midpoint') return BLUE
  if (kind === 'guide') return '#7a8dff'
  if (kind === 'grid') return '#a9b1bb'
  if (kind === 'perpendicular' || kind === 'tangent') return ORANGE
  return '#f7f9fb'
}

function drawScreenTip(ctx: CanvasRenderingContext2D, x: number, y: number, label: string, extra?: string): void {
  ctx.save()
  ctx.font = '700 9px "JetBrains Mono", monospace'
  const text = extra ? `${label} · ${extra}` : label
  const w = Math.min(230, ctx.measureText(text.toUpperCase()).width + 78)
  const h = 22
  roundRect(ctx, x, y, w, h, 4)
  ctx.fillStyle = 'rgba(12,15,19,0.95)'; ctx.fill()
  ctx.strokeStyle = 'rgba(255,255,255,0.16)'; ctx.lineWidth = 1; ctx.stroke()
  ctx.fillStyle = kindColor(label); ctx.fillRect(x, y + 4, 2, h - 8)
  ctx.fillStyle = 'rgba(255,255,255,0.52)'
  ctx.font = '600 7px "JetBrains Mono", monospace'
  ctx.fillText('SNAP', x + 10, y + 9)
  ctx.fillStyle = '#ffffff'
  ctx.font = '700 9px "JetBrains Mono", monospace'
  ctx.fillText(text.toUpperCase(), x + 10, y + 17)
  ctx.restore()
}

export function drawBadge(ctx: CanvasRenderingContext2D, x: number, y: number, label: string, color: string, align: 'left' | 'right' | 'center'): void {
  ctx.save()
  ctx.font = '600 8.5px "JetBrains Mono", monospace'
  const w = ctx.measureText(label).width + 12
  let bx = x
  if (align === 'center') bx = x - w / 2
  if (align === 'right') bx = x - w
  roundRect(ctx, bx, y, w, 16, 3)
  ctx.fillStyle = 'rgba(13,16,21,0.88)'; ctx.fill()
  ctx.strokeStyle = withOpacity(color, 0.45); ctx.lineWidth = 1; ctx.stroke()
  ctx.fillStyle = color; ctx.fillText(label, bx + 6, y + 11)
  ctx.restore()
}

function drawRulers(ctx: CanvasRenderingContext2D, state: EditorState): void {
  const { view } = state
  const W = view.width, H = view.height
  ctx.save()
  // Clean light ruler background
  ctx.fillStyle = state.theme === 'dark' ? '#22282f' : '#f5f6f7'
  ctx.fillRect(0, 0, W, RULER)
  ctx.fillRect(0, 0, RULER, H)
  ctx.strokeStyle = '#e2e8f0'
  ctx.lineWidth = 1
  ctx.beginPath(); ctx.moveTo(0, RULER + 0.5); ctx.lineTo(W, RULER + 0.5); ctx.moveTo(RULER + 0.5, 0); ctx.lineTo(RULER + 0.5, H); ctx.stroke()

  const step = niceStep(58 / view.zoom)
  const minor = step / 5
  const worldLeft = (RULER - view.panX) / view.zoom
  const worldTop = (RULER - view.panY) / view.zoom
  const worldRight = (W - view.panX) / view.zoom
  const worldBottom = (H - view.panY) / view.zoom

  ctx.font = '500 8.5px "JetBrains Mono", monospace'
  ctx.textBaseline = 'top'
  for (let x = Math.floor(worldLeft / minor) * minor; x <= worldRight; x += minor) {
    const sx = Math.round(view.panX + x * view.zoom) + 0.5
    if (sx < RULER) continue
    const major = Math.abs(x / step - Math.round(x / step)) < 1e-6
    ctx.strokeStyle = major ? (state.theme==='dark'?'#aab4c0':'#69727d') : (state.theme==='dark'?'#53606e':'#b8c0c8')
    ctx.beginPath(); ctx.moveTo(sx, major ? 10 : 16); ctx.lineTo(sx, RULER); ctx.stroke()
    if (major) { ctx.fillStyle = (state.theme==='dark'?'#cbd2da':'#444e59'); ctx.fillText(formatRuler(x), sx + 3, 3) }
    if (Math.abs(x) < 1e-6) { ctx.fillStyle = '#0d9488'; ctx.fillText('0', sx + 3, 3) }
  }
  for (let y = Math.floor(worldTop / minor) * minor; y <= worldBottom; y += minor) {
    const sy = Math.round(view.panY + y * view.zoom) + 0.5
    if (sy < RULER) continue
    const major = Math.abs(y / step - Math.round(y / step)) < 1e-6
    ctx.strokeStyle = major ? (state.theme==='dark'?'#aab4c0':'#69727d') : (state.theme==='dark'?'#53606e':'#b8c0c8')
    ctx.beginPath(); ctx.moveTo(major ? 10 : 16, sy); ctx.lineTo(RULER, sy); ctx.stroke()
    if (major) {
      ctx.save(); ctx.translate(3, sy + 3); ctx.rotate(Math.PI / 2)
      ctx.fillStyle = (state.theme==='dark'?'#cbd2da':'#444e59'); ctx.fillText(formatRuler(y), 0, 0); ctx.restore()
    }
  }
  ctx.fillStyle = '#f1f5f9'
  ctx.fillRect(0, 0, RULER, RULER)
  ctx.fillStyle = (state.theme==='dark'?'#aab4c0':'#69727d')
  ctx.font = '700 7px "JetBrains Mono", monospace'
  ctx.fillText('MM', 6, 8)
  ctx.strokeStyle = '#e2e8f0'
  ctx.strokeRect(0.5, 0.5, RULER, RULER)
  if (state.pointer) {
    const sx = state.pointer.x * view.zoom + view.panX
    const sy = state.pointer.y * view.zoom + view.panY
    ctx.strokeStyle = 'rgba(13,148,136,0.85)'
    ctx.beginPath(); ctx.moveTo(sx, 0); ctx.lineTo(sx, RULER); ctx.moveTo(0, sy); ctx.lineTo(RULER, sy); ctx.stroke()
  }
  ctx.restore()
}

function drawRulerCursor(ctx: CanvasRenderingContext2D, state: EditorState): void {
  if (!state.pointer) return
  const v = state.view
  const x = state.pointer.x * v.zoom + v.panX
  const y = state.pointer.y * v.zoom + v.panY
  if (x < RULER || y < RULER) return
  ctx.save()
  ctx.strokeStyle = 'rgba(99,230,193,0.11)'
  ctx.setLineDash([2, 6])
  ctx.beginPath(); ctx.moveTo(x, RULER); ctx.lineTo(x, v.height); ctx.moveTo(RULER, y); ctx.lineTo(v.width, y); ctx.stroke()
  ctx.restore()
}

function niceStep(target: number): number {
  const pow = Math.pow(10, Math.floor(Math.log10(Math.max(target, 1e-4))))
  const n = target / pow
  const step = n <= 1 ? 1 : n <= 2 ? 2 : n <= 5 ? 5 : 10
  return step * pow
}
function formatRuler(v: number): string {
  if (Math.abs(v) < 0.001) return '0'
  return Math.abs(v) >= 100 ? v.toFixed(0) : v.toFixed(1)
}
function round(n: number, d = 1): number { const f = Math.pow(10, d); return Math.round(n * f) / f }
function normRect(a: Pt, b: Pt): Bounds { return { x: Math.min(a.x, b.x), y: Math.min(a.y, b.y), w: Math.abs(b.x - a.x), h: Math.abs(b.y - a.y) } }
function unionOf(list: Bounds[]): Bounds {
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity
  for (const b of list) { minX = Math.min(minX, b.x); minY = Math.min(minY, b.y); maxX = Math.max(maxX, b.x + b.w); maxY = Math.max(maxY, b.y + b.h) }
  return { x: minX, y: minY, w: maxX - minX, h: maxY - minY }
}
function withOpacity(color: string, alpha: number): string {
  if (color.startsWith('rgba')) return color
  if (color.startsWith('#')) return hexToRgba(color, alpha)
  return color
}
function hexToRgba(hex: string, alpha = 1): string {
  let c = hex.replace('#', '')
  if (c.length === 3) c = c.split('').map(x => x + x).join('')
  if (c.length !== 6) return hex
  const r = parseInt(c.slice(0, 2), 16), g = parseInt(c.slice(2, 4), 16), b = parseInt(c.slice(4, 6), 16)
  return `rgba(${r},${g},${b},${alpha})`
}
function roundRect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number): void {
  ctx.beginPath()
  ctx.moveTo(x + r, y)
  ctx.lineTo(x + w - r, y)
  ctx.quadraticCurveTo(x + w, y, x + w, y + r)
  ctx.lineTo(x + w, y + h - r)
  ctx.quadraticCurveTo(x + w, y + h, x + w - r, y + h)
  ctx.lineTo(x + r, y + h)
  ctx.quadraticCurveTo(x, y + h, x, y + h - r)
  ctx.lineTo(x, y + r)
  ctx.quadraticCurveTo(x, y, x + r, y)
  ctx.closePath()
}
