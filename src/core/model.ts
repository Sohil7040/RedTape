import {
  Bounds, KAPPA, PathNode, Pt, Subpath, add, boundsCenter, cloneNode, cloneSubpaths, ellipseSubpaths,
  makeNode, makeSmoothNode, pathBounds, polygonSubpaths, rectSubpaths, rotatePoint, translateNode, translateSubpaths, uid, V,
} from './geometry'

export type Tool = 'select' | 'node' | 'pen' | 'knife' | 'rect' | 'ellipse' | 'polygon' | 'line' | 'text' | 'hand' | 'zoom'
export type ShapeKind = 'path' | 'rect' | 'ellipse' | 'polygon' | 'star' | 'line' | 'text'
export type FillType = 'none' | 'solid' | 'linear' | 'radial' | 'pattern' | 'mesh'
export type PatternFillKind = 'dots' | 'lines' | 'checker'

export interface GradientStop { offset: number; color: string }
export interface Fill {
  type: FillType
  color: string
  opacity: number
  stops: GradientStop[]
  angle: number
  pattern?: PatternFillKind
}
export interface Stroke {
  color: string
  width: number
  opacity: number
  cap: CanvasLineCap
  join: CanvasLineJoin
  dash: number[]
  enabled: boolean
}
export interface Shadow {
  enabled: boolean
  x: number
  y: number
  blur: number
  color: string
  opacity: number
}
export interface TextStyle {
  content: string
  fontSize: number
  fontFamily: string
  fontWeight: number
  letterSpacing: number
  align: CanvasTextAlign
  box: Bounds
  rotation?: number
}
export interface Shape {
  id: string
  name: string
  kind: ShapeKind
  subpaths: Subpath[]
  fill: Fill
  stroke: Stroke
  shadow: Shadow
  opacity: number
  fillRule: CanvasFillRule
  text?: TextStyle
  textInfill?: { enabled: boolean; spacing: number }
  clip?: Subpath[]
  scaleStroke?: boolean
  locked?: boolean
  hidden?: boolean
  cornerRadius?: number
  meta?: Record<string, string | number | boolean>
}

export interface Layer {
  id: string
  name: string
  visible: boolean
  locked: boolean
  color: string
  /** Explicitly chosen layer colour is inherited by new/transferred artwork. */
  useLayerColor?: boolean
  shapes: Shape[]
}

export function applyLayerColor(shape: Shape, layer: Layer): Shape {
  if (!layer.useLayerColor) return shape
  return { ...shape, stroke: { ...shape.stroke, color: layer.color },
    fill: { ...shape.fill, color: layer.color, stops: shape.fill.stops.map(stop => ({ ...stop, color: layer.color })) } }
}

export interface Page {
  /** Artwork belongs to a sheet; doc.layers references the active sheet. */
  layers?: Layer[]
  activeLayerId?: string
  id?: string
  width: number
  height: number
  color: string
  unit: 'mm' | 'in'
  name: string
}

export interface DocumentModel {
  id: string
  name: string
  page: Page
  pages?: Page[]
  activePageId?: string
  layers: Layer[]
  activeLayerId: string
  grid: { enabled: boolean; size: number; subdivisions: number; color: string }
  guides: Guide[]
  snap: SnapSettings
  production: ProductionSettings
}
export interface Guide { id: string; orientation: 'h' | 'v'; position: number; color: string }
export interface SnapSettings {
  enabled: boolean
  radius: number
  grid: boolean
  nodes: boolean
  midpoints: boolean
  centers: boolean
  intersections: boolean
  quadrants: boolean
  guides: boolean
  perpendicular: boolean
  tangent: boolean
  dynamicGuides: boolean
}

export type ProductionMode = 'cut' | 'engrave' | 'score' | 'dot' | 'pen' | 'ignore'
export type KerfMode = 'center' | 'outside' | 'inside'
export type OriginCorner = 'top-left' | 'top-right' | 'bottom-left' | 'bottom-right'

// RDWorks V8 Standard 16-Color Layer Palette
export const RDWORKS_PALETTE: string[] = [
  '#000000', // 0: Black
  '#0000ff', // 1: Blue
  '#00ff00', // 2: Green
  '#00ffff', // 3: Cyan
  '#ff0000', // 4: Red
  '#ff00ff', // 5: Magenta
  '#ffff00', // 6: Yellow
  '#ff8000', // 7: Orange
  '#800080', // 8: Purple
  '#80ff00', // 9: Lime
  '#0080ff', // 10: Sky Blue
  '#008080', // 11: Teal
  '#8b4513', // 12: Brown
  '#006400', // 13: Dark Green
  '#ff7f50', // 14: Coral Pink
  '#505050', // 15: Dark Gray
]

export interface LayerOperation {
  mode: ProductionMode
  speed: number
  power: number
  minPower?: number
  maxPower?: number
  laser2Power?: number
  blower?: boolean
  passes: number
  repeatCount?: number
  scanMode?: 'X-swing' | 'X-unilateral' | 'Y-swing' | 'Y-unilateral'
  scanInterval?: number
  dotTime?: number
  dotInterval?: number
  microLink?: boolean
  microLinkWidth?: number
  overcut?: number
  colorIndex?: number
}

export interface ProductionSettings {
  preview: boolean
  kerf: number
  kerfMode: KerfMode
  leadIn: number
  leadOut: number
  leadMode?: 'contour-only' | 'outer-only' | 'all'
  overcut?: number
  optimizeOrder: boolean
  insideOut: boolean
  originCorner: OriginCorner
  rapidSpeed: number
  /** User-adjustable estimate allowance; never changes controller speed or power. */
  timeAllowancePct?: number
  startX: number
  startY: number
  margin: number
  spacing: number
  allowRotate: boolean
  showSequence: boolean
  hatchEngrave: boolean
  hatchSpacing: number
  layers: Record<string, LayerOperation>
}

export const OPERATION_COLORS: Record<ProductionMode, string> = {
  cut: '#e11d48',
  engrave: '#0284c7',
  score: '#059669',
  dot: '#d97706',
  pen: '#7c3aed',
  ignore: '#94a3b8',
}

export const OPERATION_LABELS: Record<ProductionMode, string> = {
  cut: 'Cut',
  engrave: 'Scan (Engrave)',
  score: 'Score',
  dot: 'Dot (Perforate)',
  pen: 'Pen (Mark)',
  ignore: 'Ignore',
}

export function defaultLayerOperation(mode: ProductionMode = 'cut', index = 0): LayerOperation {
  if (mode === 'engrave') return {
    mode, speed: 180, power: 40, minPower: 20, maxPower: 40, passes: 1, blower: true,
    scanMode: 'X-swing', scanInterval: 0.08, colorIndex: index % 16,
  }
  if (mode === 'score') return {
    mode, speed: 60, power: 30, minPower: 15, maxPower: 30, passes: 1, blower: true,
    colorIndex: index % 16,
  }
  if (mode === 'dot') return {
    mode, speed: 80, power: 70, minPower: 50, maxPower: 70, passes: 1, blower: true,
    dotTime: 15, dotInterval: 2.0, colorIndex: index % 16,
  }
  if (mode === 'pen') return {
    mode, speed: 120, power: 20, minPower: 10, maxPower: 20, passes: 1, blower: false,
    colorIndex: index % 16,
  }
  if (mode === 'ignore') return {
    mode, speed: 0, power: 0, passes: 0, blower: false, colorIndex: index % 16,
  }
  return {
    mode, speed: 25, power: 80, minPower: 45, maxPower: 80, passes: 1, blower: true,
    microLink: false, microLinkWidth: 0.8, overcut: 0, colorIndex: index % 16,
  }
}

export function layerOperation(prod: ProductionSettings | undefined, layerId: string): LayerOperation {
  return prod?.layers?.[layerId] ?? defaultLayerOperation('cut')
}

export function defaultProduction(layers: Layer[]): ProductionSettings {
  const mapping: Record<string, LayerOperation> = {}
  layers.forEach((layer, idx) => {
    const mode: ProductionMode = layer.name.toLowerCase().includes('guide')
      ? 'ignore'
      : layer.name.toLowerCase().includes('composition')
        ? 'engrave'
        : 'cut'
    mapping[layer.id] = defaultLayerOperation(mode, idx)
  })
  return {
    preview: false,
    kerf: 0.15,
    kerfMode: 'center',
    leadIn: 0,
    leadOut: 0,
    leadMode: 'contour-only',
    overcut: 0,
    optimizeOrder: true,
    insideOut: true,
    originCorner: 'bottom-right',
    rapidSpeed: 300,
    timeAllowancePct: 0,
    startX: 8,
    startY: 8,
    margin: 10,
    spacing: 5,
    allowRotate: true,
    showSequence: true,
    hatchEngrave: true,
    hatchSpacing: 0.75,
    layers: mapping,
  }
}

export interface NodeSelection {
  shapeId: string
  subpathIndex: number
  nodeIndex: number
}

export type KnifeMode = 'line' | 'freehand' | 'bezier'
export type CutSpan = 'normal' | 'gap' | 'overlap'

export interface KnifeSettings {
  mode: KnifeMode
  autoClose: boolean
  span: CutSpan
  width: number
  cutAll: boolean
}

export interface GridPatternSettings {
  columns: number
  rows: number
  mode: 'offset' | 'spacing'
  dx: number
  dy: number
  directionX: 1 | -1
  directionY: 1 | -1
}

export interface RadialPatternSettings {
  copies: number
  pivotX: number
  pivotY: number
  radius: number
  startAngle: number
  span: number
  rotateWithShape: boolean
}

export const DEFAULT_FILL: Fill = {
  type: 'none', color: '#000000', opacity: 1,
  stops: [{ offset: 0, color: '#000000' }, { offset: 1, color: '#333333' }],
  angle: 0,
}
export const DEFAULT_STROKE: Stroke = {
  color: '#000000', width: 1, opacity: 1, cap: 'round', join: 'round', dash: [], enabled: true,
}
export const DEFAULT_SHADOW: Shadow = {
  enabled: false, x: 2.4, y: 3.2, blur: 8, color: '#000000', opacity: 0.25,
}
export const DEFAULT_SNAP: SnapSettings = {
  enabled: true, radius: 8, grid: true, nodes: true, midpoints: true, centers: true,
  intersections: true, quadrants: true, guides: true, perpendicular: false, tangent: false, dynamicGuides: true,
}

export const PALETTE = [
  '#ff5c35', '#ffb21c', '#f5f0e6', '#1d222b', '#2b59ff', '#1f9d8b', '#d84c93', '#89a7ff',
  '#d7f75b', '#e9dfcf', '#8a8f98', '#ffffff',
]

export function makeFill(overrides: Partial<Fill> = {}): Fill {
  return { ...DEFAULT_FILL, ...overrides, stops: (overrides.stops ?? DEFAULT_FILL.stops).map(s => ({ ...s })) }
}
export function makeStroke(overrides: Partial<Stroke> = {}): Stroke {
  return { ...DEFAULT_STROKE, ...overrides, dash: [...(overrides.dash ?? DEFAULT_STROKE.dash)] }
}
export function makeShadow(overrides: Partial<Shadow> = {}): Shadow {
  return { ...DEFAULT_SHADOW, ...overrides }
}

export function makeShape(kind: ShapeKind, subpaths: Subpath[], overrides: Partial<Shape> = {}): Shape {
  return {
    id: uid('shape'),
    name: titleCase(kind),
    kind,
    opacity: 1,
    fillRule: 'nonzero',
    ...overrides,
    fill: overrides.fill ?? makeFill(),
    stroke: overrides.stroke ?? makeStroke(),
    shadow: overrides.shadow ?? makeShadow(),
    subpaths: cloneSubpaths(overrides.subpaths ?? subpaths),
  }
}

export function titleCase(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1)
}

export function shapeBounds(shape: Shape): Bounds {
  if (shape.kind === 'text' && shape.text) return { ...shape.text.box }
  return pathBounds(shape.subpaths)
}

export function selectionBounds(shapes: Shape[]): Bounds {
  if (!shapes.length) return { x: 0, y: 0, w: 0, h: 0 }
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity
  for (const s of shapes) {
    const b = shapeBounds(s)
    minX = Math.min(minX, b.x); minY = Math.min(minY, b.y)
    maxX = Math.max(maxX, b.x + b.w); maxY = Math.max(maxY, b.y + b.h)
  }
  return { x: minX, y: minY, w: maxX - minX, h: maxY - minY }
}

export function getShape(doc: DocumentModel, id: string): Shape | undefined {
  for (const l of doc.layers) {
    const s = l.shapes.find(s => s.id === id)
    if (s) return s
  }
  return undefined
}

export function getLayerOfShape(doc: DocumentModel, id: string): Layer | undefined {
  return doc.layers.find(l => l.shapes.some(s => s.id === id))
}

export function allShapes(doc: DocumentModel): Shape[] {
  return doc.layers.filter(l => l.visible && !l.locked).flatMap(l => l.shapes.filter(s => !s.hidden && !s.locked))
}

export function activeLayer(doc: DocumentModel): Layer {
  return doc.layers.find(l => l.id === doc.activeLayerId) ?? doc.layers[doc.layers.length - 1]
}

export function nextShapeName(doc: DocumentModel, base: string): string {
  let max = 0
  for (const l of doc.layers) for (const s of l.shapes) {
    if (s.name.startsWith(base)) {
      const m = s.name.match(/(\d+)$/)
      if (m) max = Math.max(max, Number(m[1]))
    }
  }
  return `${base} ${max + 1}`
}

export function cloneShape(shape: Shape, offsetX = 0, offsetY = 0, name?: string): Shape {
  const subpaths = cloneSubpaths(shape.subpaths)
  for (const sub of subpaths) for (const n of sub.nodes) {
    n.x += offsetX; n.y += offsetY; n.in = add(n.in, { x: offsetX, y: offsetY }); n.out = add(n.out, { x: offsetX, y: offsetY })
  }
  return {
    ...shape,
    id: uid('shape'),
    name: name ?? `${shape.name} copy`,
    subpaths,
    fill: makeFill(shape.fill),
    stroke: makeStroke(shape.stroke),
    shadow: makeShadow(shape.shadow),
    text: shape.text ? { ...shape.text, box: { ...shape.text.box, x: shape.text.box.x + offsetX, y: shape.text.box.y + offsetY } } : undefined,
    clip: shape.clip ? translateSubpaths(shape.clip, offsetX, offsetY) : undefined,
    meta: shape.meta ? { ...shape.meta } : undefined,
  }
}

export function createRectShape(x: number, y: number, w: number, h: number, name = 'Rectangle'): Shape {
  return makeShape('rect', rectSubpaths(x, y, w, h), { name, fill: makeFill({ type: 'none' }), stroke: makeStroke({ enabled: true, color: '#000000', width: 1 }) })
}
export function createEllipseShape(cx: number, cy: number, rx: number, ry: number, name = 'Ellipse'): Shape {
  return makeShape('ellipse', ellipseSubpaths(cx, cy, rx, ry), { name, fill: makeFill({ type: 'none' }), stroke: makeStroke({ enabled: true, color: '#000000', width: 1 }) })
}
export function createPolygonShape(cx: number, cy: number, rx: number, ry: number, sides: number, star = false): Shape {
  return makeShape(star ? 'star' : 'polygon', polygonSubpaths(cx, cy, rx, ry, sides, -Math.PI / 2, star), {
    name: star ? 'Star' : 'Polygon',
    fill: makeFill({ type: 'none' }),
    stroke: makeStroke({ enabled: true, color: '#000000', width: 1 }),
  })
}
export function createLineShape(a: Pt, b: Pt, width = 1): Shape {
  const sub: Subpath = { id: uid('sp'), closed: false, nodes: [
    makeNode(a.x, a.y), makeNode(b.x, b.y),
  ] }
  return makeShape('line', [sub], {
    name: 'Line', fill: makeFill({ type: 'none' }),
    stroke: makeStroke({ enabled: true, color: '#000000', width }),
  })
}
export function createTextShape(x: number, y: number, content: string, fontSize = 12): Shape {
  const box = textBoxFor(x, y, content, fontSize)
  return makeShape('text', [], {
    name: 'Text', fill: makeFill({ type: 'none' }),
    stroke: makeStroke({ enabled: true, color: '#000000', width: 0.8 }),
    text: { content, fontSize, fontFamily: 'Arial', fontWeight: 700, letterSpacing: 0, align: 'left', box },
  })
}
export function textBoxFor(x: number, y: number, content: string, fontSize: number): Bounds {
  const lines = content.split('\n')
  const w = Math.max(4, ...lines.map(l => l.length * fontSize * 0.58))
  const h = lines.length * fontSize * 1.12
  return { x, y: y - fontSize * 0.82, w, h }
}

export function updateTextShape(shape: Shape, content: string, fontSize: number, fontWeight: number, letterSpacing: number): Shape {
  const box = textBoxFor(shape.text?.box.x ?? 0, (shape.text?.box.y ?? 0) + fontSize * 0.82, content, fontSize)
  return { ...shape, text: { ...(shape.text ?? { fontFamily: 'Arial', align: 'left' }), content, fontSize, fontWeight, letterSpacing, box } }
}

export function makeLayer(name: string, color = '#8ea0ff'): Layer {
  return { id: uid('layer'), name, visible: true, locked: false, color, shapes: [] }
}

/* ── Showcase document ─────────────────────────────────────────── */

function petalPath(cx: number, cy: number, angle: number, len: number, width: number): Subpath {
  const c = Math.cos(angle), s = Math.sin(angle)
  const p = (u: number, v: number): Pt => ({ x: cx + u * c - v * s, y: cy + u * s + v * c })
  const tip = p(len, 0)
  const tail = p(len * 0.06, 0)
  const nodes: PathNode[] = [
    { id: uid('n'), x: tail.x, y: tail.y, in: p(0, -width * 0.4), out: p(len * 0.36, -width), type: 'smooth' },
    { id: uid('n'), x: tip.x, y: tip.y, in: p(len * 0.78, -width * 0.56), out: p(len * 0.78, width * 0.56), type: 'smooth' },
    { id: uid('n'), x: tail.x, y: tail.y, in: p(len * 0.36, width), out: p(0, width * 0.4), type: 'smooth' },
  ]
  return { id: uid('sp'), closed: true, nodes }
}

function ring(): Shape {
  const petals: Subpath[] = []
  const count = 20
  for (let i = 0; i < count; i++) petals.push(petalPath(0, 0, (i / count) * Math.PI * 2, i % 2 === 0 ? 63 : 49, i % 2 === 0 ? 8.5 : 6))
  return makeShape('path', petals, {
    name: 'Radial Field',
    fill: makeFill({ type: 'linear', stops: [{ offset: 0, color: '#ff6a2b' }, { offset: 0.55, color: '#ff8a2f' }, { offset: 1, color: '#f5c542' }], angle: -28 }),
    stroke: makeStroke({ enabled: false }),
    meta: { centerX: 212, centerY: 152 },
  })
}

function gridTiles(): Shape {
  const subs: Subpath[] = []
  const x0 = 45, y0 = 202, size = 8.4, gap = 4.2
  for (let r = 0; r < 4; r++) for (let c = 0; c < 6; c++) {
    subs.push(...rectSubpaths(x0 + c * (size + gap), y0 + r * (size + gap), size, size))
  }
  return makeShape('path', subs, {
    name: 'Grid Matrix', fill: makeFill({ type: 'solid', color: '#1d222b' }), stroke: makeStroke({ enabled: false }),
  })
}

export function createShowcaseDocument(): DocumentModel {
  const base = makeLayer('Composition', '#ff7a45')
  const details = makeLayer('Details', '#7ca6ff')
  const guides = makeLayer('Guides & marks', '#9e9e9e')

  const field = ring()
  // radial field anchored at 212,152
  for (const sub of field.subpaths) for (const n of sub.nodes) {
    n.x += 212; n.y += 152
    n.in = { x: n.in.x + 212, y: n.in.y + 152 }
    n.out = { x: n.out.x + 212, y: n.out.y + 152 }
  }

  const orbit = makeShape('ellipse', ellipseSubpaths(320, 166, 79, 79), {
    name: 'Cobalt Orbit', fill: makeFill({ type: 'none' }),
    stroke: makeStroke({ enabled: true, color: '#2b59ff', width: 2.2 }), opacity: 1,
  })
  const orbitCore = makeShape('ellipse', ellipseSubpaths(320, 166, 17, 17), {
    name: 'Orbit Core', fill: makeFill({ type: 'solid', color: '#1d222b' }), stroke: makeStroke({ enabled: false }),
    shadow: makeShadow({ enabled: true, x: 1.6, y: 2.8, blur: 4, opacity: 0.3 }),
  })

  const sweepSub: Subpath = { id: uid('sp'), closed: false, nodes: [
    { id: uid('n'), x: 37, y: 124, in: { x: 37, y: 124 }, out: { x: 56, y: 54 }, type: 'cusp' },
    { id: uid('n'), x: 142, y: 89, in: { x: 102, y: 26 }, out: { x: 173, y: 139 }, type: 'smooth' },
    { id: uid('n'), x: 178, y: 233, in: { x: 210, y: 171 }, out: { x: 178, y: 233 }, type: 'cusp' },
  ] }
  const sweep = makeShape('path', [sweepSub], {
    name: 'Curve Study', fill: makeFill({ type: 'none' }),
    stroke: makeStroke({ enabled: true, color: '#1d222b', width: 1.1, cap: 'round' }),
  })

  const title = createTextShape(34, 69, 'ORBITAL', 39)
  title.name = 'Display Type'
  title.text!.fontFamily = 'Arial Black'
  title.text!.fontWeight = 900
  title.text!.letterSpacing = -1.6
  title.text!.box = { x: 34, y: 39, w: 168, h: 42 }
  title.fill = makeFill({ type: 'solid', color: '#1d222b' })

  const kicker = createTextShape(36, 28, 'CORELITH / VECTOR LAB — Nº 01', 4.1)
  kicker.name = 'Mono Kicker'
  kicker.text!.fontFamily = 'Courier New'
  kicker.text!.fontWeight = 700
  kicker.text!.letterSpacing = 1.4
  kicker.text!.box = { x: 36, y: 23, w: 123, h: 6 }
  kicker.fill = makeFill({ type: 'solid', color: '#1d222b' })

  const note = createTextShape(322, 260, 'RADIAL\nSTUDY', 5.6)
  note.name = 'Margin Note'
  note.text!.fontFamily = 'Arial'
  note.text!.fontWeight = 700
  note.text!.box = { x: 322, y: 251, w: 60, h: 13 }
  note.fill = makeFill({ type: 'solid', color: '#1d222b' })

  const smallSquares = gridTiles()
  const cutSource = makeShape('path', rectSubpaths(284, 40, 96, 46), {
    name: 'Cut Study', fill: makeFill({ type: 'solid', color: '#ff5c35' }), stroke: makeStroke({ enabled: false }),
  })
  // pre-split with a diagonal gap to showcase the knife
  const cutA = makeShape('path', [
    { id: uid('sp'), closed: true, nodes: [
      makeNode(284, 40), makeNode(380, 40), makeNode(380, 62, 'cusp'), makeNode(284, 52, 'cusp'),
    ] },
  ], { name: 'Cut Study A', fill: makeFill({ type: 'solid', color: '#ff5c35' }), stroke: makeStroke({ enabled: false }) })
  const cutB = makeShape('path', [
    { id: uid('sp'), closed: true, nodes: [
      makeNode(284, 57), makeNode(380, 67), makeNode(380, 86), makeNode(284, 86),
    ] },
  ], { name: 'Cut Study B', fill: makeFill({ type: 'solid', color: '#ff5c35' }), stroke: makeStroke({ enabled: false }) })
  void cutSource
  void add
  void KAPPA
  void makeSmoothNode
  void rotatePoint

  base.shapes = [title, kicker, field, orbit, orbitCore, sweep, smallSquares]
  details.shapes = [cutA, cutB, note]
  guides.shapes = []

  const initialPageId = uid('page')
  const initialPage: Page = {
    id: initialPageId,
    width: 420,
    height: 297,
    color: '#f4f0e7',
    unit: 'mm',
    name: 'A3 landscape',
  }

  return {
    id: uid('doc'), name: 'Orbital Study 01',
    page: initialPage,
    pages: [initialPage],
    activePageId: initialPageId,
    layers: [base, details, guides],
    activeLayerId: details.id,
    grid: { enabled: true, size: 10, subdivisions: 2, color: '#b8b1a3' },
    guides: [
      { id: uid('guide'), orientation: 'v', position: 287, color: '#2b59ff' },
      { id: uid('guide'), orientation: 'h', position: 152, color: '#2b59ff' },
    ],
    snap: { ...DEFAULT_SNAP },
    production: defaultProduction([base, details, guides]),
  }
}

export interface MaterialPreset {
  id: string
  name: string
  category: 'Wood' | 'Acrylic' | 'Paper/Card' | 'Leather' | 'Metal Marking' | 'Rubber'
  mode: ProductionMode
  speed: number
  power: number
  minPower: number
  maxPower: number
  blower: boolean
  passes: number
  scanInterval?: number
}

export const MATERIAL_PRESETS: MaterialPreset[] = [
  { id: 'm1', name: 'Plywood 3mm (Cut)', category: 'Wood', mode: 'cut', speed: 22, power: 75, minPower: 65, maxPower: 75, blower: true, passes: 1 },
  { id: 'm2', name: 'Plywood 6mm (Cut)', category: 'Wood', mode: 'cut', speed: 12, power: 88, minPower: 78, maxPower: 88, blower: true, passes: 1 },
  { id: 'm3', name: 'Hardwood Surface (Engrave)', category: 'Wood', mode: 'engrave', speed: 300, power: 30, minPower: 20, maxPower: 30, blower: true, passes: 1, scanInterval: 0.08 },
  { id: 'm4', name: 'Acrylic 3mm (Cast Cut)', category: 'Acrylic', mode: 'cut', speed: 16, power: 72, minPower: 62, maxPower: 72, blower: false, passes: 1 },
  { id: 'm5', name: 'Acrylic 5mm (Cast Cut)', category: 'Acrylic', mode: 'cut', speed: 9, power: 85, minPower: 75, maxPower: 85, blower: false, passes: 1 },
  { id: 'm6', name: 'Acrylic White Frosted (Engrave)', category: 'Acrylic', mode: 'engrave', speed: 350, power: 22, minPower: 15, maxPower: 22, blower: true, passes: 1, scanInterval: 0.06 },
  { id: 'm7', name: 'Cardboard 2mm (Cut)', category: 'Paper/Card', mode: 'cut', speed: 55, power: 42, minPower: 32, maxPower: 42, blower: true, passes: 1 },
  { id: 'm8', name: 'Cardstock 250gsm (Score/Line)', category: 'Paper/Card', mode: 'score', speed: 85, power: 18, minPower: 12, maxPower: 18, blower: true, passes: 1 },
  { id: 'm9', name: 'Leather 1.5mm (Engrave)', category: 'Leather', mode: 'engrave', speed: 250, power: 26, minPower: 18, maxPower: 26, blower: true, passes: 1, scanInterval: 0.08 },
  { id: 'm10', name: 'Anodized Aluminum (Mark)', category: 'Metal Marking', mode: 'engrave', speed: 400, power: 35, minPower: 25, maxPower: 35, blower: true, passes: 1, scanInterval: 0.05 },
  { id: 'm11', name: 'Stamp Rubber (Deep Engrave)', category: 'Rubber', mode: 'engrave', speed: 180, power: 70, minPower: 60, maxPower: 70, blower: true, passes: 1, scanInterval: 0.07 },
]

export function createBlankDocument(options?: { name?: string; width?: number; height?: number; unit?: 'mm' | 'in'; color?: string }): DocumentModel {
  const width = options?.width ?? 1220
  const height = options?.height ?? 915
  const pageId = uid('page')
  const isRuidaBed = width === 1220 && height === 915
  const page: Page = {
    id: pageId,
    width,
    height,
    color: options?.color ?? '#ffffff',
    unit: options?.unit ?? 'mm',
    name: isRuidaBed ? 'Ruida Bed (1220×915)' : 'Page 1',
  }
  const defaultLayer = makeLayer('Layer 1', '#000000')
  return {
    id: uid('doc'),
    name: options?.name ?? (isRuidaBed ? 'Laser Production Job' : 'Untitled Document'),
    page,
    pages: [page],
    activePageId: pageId,
    layers: [defaultLayer],
    activeLayerId: defaultLayer.id,
    grid: { enabled: true, size: 10, subdivisions: 2, color: '#e2e8f0' },
    guides: [],
    snap: { ...DEFAULT_SNAP },
    production: defaultProduction([defaultLayer]),
  }
}

export function normalizeDocument(input: DocumentModel): DocumentModel {
  if (!input || !input.page || !Array.isArray(input.layers) || !input.layers.length) throw new Error('Invalid project: page and at least one layer are required')
  const doc = structuredClone(input)
  const validPage = (p: Page) => Number.isFinite(p.width) && Number.isFinite(p.height) && p.width > 0 && p.height > 0 && p.width <= 100000 && p.height <= 100000
  if (!validPage(doc.page)) throw new Error('Invalid project page dimensions')
  doc.snap = { ...DEFAULT_SNAP, ...doc.snap }
  doc.grid ??= { enabled: true, size: 10, subdivisions: 2, color: '#b8b1a3' }
  if (!Array.isArray(doc.guides)) doc.guides = []
  const defaults = defaultProduction(doc.layers)
  doc.production = { ...defaults, ...doc.production, layers: { ...defaults.layers, ...doc.production?.layers } }
  if (!Array.isArray(doc.pages) || !doc.pages.length) doc.pages = [{ ...doc.page, id: doc.page.id || uid('page') }]
  for (const page of doc.pages) {
    if (!validPage(page)) throw new Error('Invalid sheet dimensions')
    page.id ||= uid('page')
  }
  const active = doc.pages.find(p => p.id === doc.activePageId || p.id === doc.page.id) ?? doc.pages[0]
  doc.activePageId = active.id
  active.layers = doc.layers
  active.activeLayerId = doc.activeLayerId
  for (const page of doc.pages) {
    // Older project files shared the active artwork across all page tabs. Keep
    // it on the active page; migrate other tabs to independent empty sheets.
    if (!Array.isArray(page.layers) || !page.layers.length) page.layers = [makeLayer('Layer 1', '#000000')]
    for (const layer of page.layers) {
      if (!Array.isArray(layer.shapes)) throw new Error('Invalid project layer')
      for (const shape of layer.shapes) {
        if (!Array.isArray(shape.subpaths)) throw new Error('Invalid project shape')
        for (const sub of shape.subpaths) for (const node of sub.nodes) {
          if (![node.x, node.y, node.in?.x, node.in?.y, node.out?.x, node.out?.y].every(Number.isFinite)) throw new Error('Invalid project geometry')
        }
        shape.fill = makeFill(shape.fill)
        shape.stroke = makeStroke(shape.stroke)
        shape.shadow = makeShadow(shape.shadow)
        shape.opacity ??= 1; shape.fillRule ??= 'nonzero'
      }
      const fallback = defaultLayerOperation(layer.name.toLowerCase().includes('guide') ? 'ignore' : 'cut')
      const saved = input.production?.layers?.[layer.id]
      const op = { ...fallback, ...doc.production.layers[layer.id] }
      if (saved) {
        const max = saved.maxPower ?? saved.power ?? fallback.maxPower!
        op.maxPower = max; op.power = max
        op.minPower = saved.minPower ?? Math.min(fallback.minPower!, max)
      }
      doc.production.layers[layer.id] = op
    }
    page.activeLayerId = page.layers.some(l => l.id === page.activeLayerId) ? page.activeLayerId : page.layers[0].id
  }
  doc.layers = active.layers!
  doc.activeLayerId = active.activeLayerId!
  const { layers: _layers, activeLayerId: _layer, ...metadata } = active
  doc.page = metadata
  return doc
}
