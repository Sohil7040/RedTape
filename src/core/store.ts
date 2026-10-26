import { useSyncExternalStore } from 'react'
import {
  Bounds, PathNode, Pt, Subpath, add, boundsCenter, clamp, cloneNode, cloneSubpaths, cubicPoint, dist,
  makeNode, rad, rotateSubpaths, scaleSubpaths, segmentAt, splitCubic, sub, translateNode, translateSubpaths, uid,
} from './geometry'
import {
  CutSpan, DEFAULT_SNAP, DocumentModel, Fill, GridPatternSettings, Guide, KnifeMode, KnifeSettings, Layer, LayerOperation, ProductionMode, ProductionSettings,
  NodeSelection, RadialPatternSettings, Shape, SnapSettings, Stroke, Tool, activeLayer, allShapes, cloneShape,
  defaultLayerOperation, layerOperation,
  createShowcaseDocument, createBlankDocument, MATERIAL_PRESETS, Page, createTextShape, getLayerOfShape, getShape, makeFill, makeLayer, makeShadow, normalizeDocument,
  makeStroke, nextShapeName, selectionBounds, shapeBounds, applyLayerColor, RDWORKS_PALETTE,
} from './model'
import { collectStaticCandidates, snapPoint, SnapHit, SnapRay, alignmentSnap } from './snapping'
import { cutShapes } from './knife'
import { gridPattern, radialPattern } from './patterns'
import { formatDuration, nestShapes } from './production'
import { booleanMultipleShapes, BooleanOp } from './booleans'
import { loadTextFont, textShapeToCurves } from './textCurves'

export type PanelTab = 'design' | 'snap' | 'patterns' | 'production' | 'layers'
export type HoverState = {
  shapeId?: string
  node?: NodeSelection
  segment?: { shapeId: string; subpathIndex: number; segmentIndex: number; t: number; point: Pt; midpoint: Pt }
  showCenter?: boolean
  showMidpoint?: boolean
}
export type Draft =
  | { type: 'shape'; kind: 'rect' | 'ellipse' | 'line' | 'polygon'; start: Pt; current: Pt; shift: boolean }
  | { type: 'pen'; subpath: Subpath; cursor: Pt | null; closeHint: boolean }
  | { type: 'knife'; mode: KnifeMode; anchors: Pt[]; cursor: Pt | null; drawing: boolean }
  | { type: 'guide'; guide: Guide }
  | { type: 'marquee'; bounds: Bounds }
  | null

export interface ViewState {
  zoom: number
  panX: number
  panY: number
  width: number
  height: number
  ready: boolean
}
export interface Toast { id: string; message: string; tone: 'info' | 'success' | 'warn'; ttl: number }

export interface LaserSimulationState {
  playing: boolean
  progress: number // 0 to 1
  speed: number // 1x, 2x, 5x, 10x
  headPos: Pt | null
  laserOn: boolean
}

export interface EditorState {
  doc: DocumentModel
  selection: string[]
  selectedNode: NodeSelection | null
  tool: Tool
  hover: HoverState | null
  snapHit: SnapHit | null
  snapRays: SnapRay[]
  draft: Draft
  view: ViewState
  pointer: Pt | null
  rightTab: PanelTab
  leftOpen: boolean
  rightOpen: boolean
  showRulers: boolean
  showSetups: boolean
  knife: KnifeSettings
  gridPattern: GridPatternSettings
  radialPattern: RadialPatternSettings
  toasts: Toast[]
  textEditId: string | null
  status: string
  polygonSides: number
  penType: 'corner' | 'smooth'
  scaleStroke: boolean
  sim: LaserSimulationState
}

const MIN_ZOOM = 0.15
const MAX_ZOOM = 190
export const PX_PER_MM = 96 / 25.4

function loadAutosave(): DocumentModel | null {
  try {
    const raw = localStorage.getItem('corelith.autosave.v1')
    if (!raw) return null
    const parsed = JSON.parse(raw)
    const doc = parsed?.doc ?? parsed
    if (!doc || !Array.isArray(doc.layers) || !doc.page || !Array.isArray(doc.guides)) return null
    return normalizeDocument(doc as DocumentModel)
  } catch { return null }
}

function initialState(): EditorState {
  const restored = loadAutosave()
  const doc = restored ?? createShowcaseDocument()
  const hero = doc.layers[0]?.shapes.find(s => s.name === 'Radial Field') ?? doc.layers.flatMap(l => l.shapes)[0]
  return {
    doc,
    selection: hero ? [hero.id] : [],
    selectedNode: null,
    tool: 'select',
    hover: null,
    snapHit: null,
    snapRays: [],
    draft: null,
    view: { zoom: 2.1, panX: 80, panY: 60, width: 1200, height: 800, ready: false },
    pointer: null,
    rightTab: 'design',
    leftOpen: true,
    rightOpen: true,
    showRulers: true,
    showSetups: true,
    knife: { mode: 'line', autoClose: true, span: 'normal', width: 4, cutAll: true },
    gridPattern: { columns: 4, rows: 3, mode: 'spacing', dx: 6, dy: 6, directionX: 1, directionY: 1 },
    radialPattern: { copies: 12, pivotX: 210, pivotY: 148, radius: 74, startAngle: 0, span: 360, rotateWithShape: true },
    toasts: [],
    textEditId: null,
    status: restored ? 'Session restored · autosaved locally' : hero ? 'Radial Field · 60 nodes' : 'Ready',
    polygonSides: 6,
    penType: 'smooth',
    scaleStroke: true,
    sim: {
      playing: false,
      progress: 0,
      speed: 2,
      headPos: null,
      laserOn: false,
    },
  }
}

export class EditorStore {
  private state: EditorState = initialState()
  private listeners = new Set<() => void>()
  private undoStack: DocumentModel[] = []
  private redoStack: DocumentModel[] = []
  private clipboard: Shape[] = []
  private toastTimers: number[] = []

  getState = (): EditorState => this.state
  subscribe = (fn: () => void): (() => void) => {
    this.listeners.add(fn)
    return () => this.listeners.delete(fn)
  }
  private emit(): void {
    for (const l of this.listeners) l()
  }
  private patch(p: Partial<EditorState>): void {
    this.state = { ...this.state, ...p }
    this.emit()
  }
  private docChanged(): void {
    const doc = this.state.doc
    const page = doc.pages?.find(p => p.id === doc.activePageId)
    if (page) { page.layers = doc.layers; page.activeLayerId = doc.activeLayerId }
    this.state = { ...this.state, doc: { ...doc }, sim: { ...this.state.sim, playing: false, progress: 0, headPos: null, laserOn: false } }
    this.emit()
  }
  get canUndo(): boolean { return this.undoStack.length > 0 }
  get canRedo(): boolean { return this.redoStack.length > 0 }
  get undoDepth(): number { return this.undoStack.length }

  pushHistory(label = 'Edit'): void {
    this.undoStack.push(structuredClone(this.state.doc))
    if (this.undoStack.length > 80) this.undoStack.shift()
    this.redoStack = []
    this.patch({ status: `${label} · ${this.undoStack.length} undo` })
  }

  undo(): void {
    const prev = this.undoStack.pop()
    if (!prev) return
    this.redoStack.push(structuredClone(this.state.doc))
    this.state = {
      ...this.state,
      doc: prev,
      selection: this.state.selection.filter(id => !!getShape(prev, id)),
      selectedNode: null, draft: null, snapHit: null, snapRays: [],
      status: 'Undo',
    }
    this.emit()
  }
  redo(): void {
    const next = this.redoStack.pop()
    if (!next) return
    this.undoStack.push(structuredClone(this.state.doc))
    this.state = {
      ...this.state,
      doc: next,
      selection: this.state.selection.filter(id => !!getShape(next, id)),
      selectedNode: null, draft: null, snapHit: null, snapRays: [],
      status: 'Redo',
    }
    this.emit()
  }

  /* ── View ─────────────────────────────────────────────────── */
  setViewport(width: number, height: number): void {
    const v = this.state.view
    if (!v.ready) {
      const page = this.state.doc.page
      const availW = Math.max(200, width - 120)
      const availH = Math.max(180, height - 130)
      const zoom = clamp(Math.min(availW / page.width, availH / page.height), MIN_ZOOM, 4.4)
      this.patch({
        view: {
          width, height, zoom, ready: true,
          panX: (width - page.width * zoom) / 2,
          panY: (height - page.height * zoom) / 2 + 10,
        },
      })
      return
    }
    const cx = (width / 2 - v.panX) / v.zoom
    const cy = (height / 2 - v.panY) / v.zoom
    this.patch({
      view: { ...v, width, height, panX: width / 2 - cx * v.zoom, panY: height / 2 - cy * v.zoom },
    })
  }
  screenToWorld(x: number, y: number): Pt {
    const v = this.state.view
    return { x: (x - v.panX) / v.zoom, y: (y - v.panY) / v.zoom }
  }
  worldToScreen(p: Pt): Pt {
    const v = this.state.view
    return { x: p.x * v.zoom + v.panX, y: p.y * v.zoom + v.panY }
  }
  setZoomAt(zoom: number, screen: Pt): void {
    const v = this.state.view
    const z = clamp(zoom, MIN_ZOOM, MAX_ZOOM)
    const world = { x: (screen.x - v.panX) / v.zoom, y: (screen.y - v.panY) / v.zoom }
    this.patch({ view: { ...v, zoom: z, panX: screen.x - world.x * z, panY: screen.y - world.y * z } })
  }
  zoomBy(factor: number, center?: Pt): void {
    const v = this.state.view
    this.setZoomAt(v.zoom * factor, center ?? { x: v.width / 2, y: v.height / 2 })
  }
  fitPage(): void {
    const v = this.state.view, page = this.state.doc.page
    const availW = Math.max(200, v.width - 120), availH = Math.max(180, v.height - 130)
    const zoom = clamp(Math.min(availW / page.width, availH / page.height), MIN_ZOOM, MAX_ZOOM)
    this.patch({ view: { ...v, zoom, panX: (v.width - page.width * zoom) / 2, panY: (v.height - page.height * zoom) / 2 + 8 } })
  }
  zoomActual(): void {
    const v = this.state.view
    this.setZoomAt(PX_PER_MM, { x: v.width / 2, y: v.height / 2 })
  }
  panBy(dx: number, dy: number): void {
    const v = this.state.view
    this.patch({ view: { ...v, panX: v.panX + dx, panY: v.panY + dy } })
  }

  /* ── Selection & tooling ──────────────────────────────────── */
  setTool(tool: Tool): void {
    const enteringNode = tool === 'node'
    this.patch({
      tool,
      draft: null,
      selectedNode: enteringNode ? this.state.selectedNode : null,
      snapHit: null,
      snapRays: [],
      status: tool === 'node' ? 'Shape tool — select a curve to edit nodes' : `Tool · ${tool}`,
    })
  }
  setSelection(ids: string[], additive = false, toggle = false): void {
    let next: string[]
    if (!additive) next = Array.from(new Set(ids))
    else {
      const set = new Set(this.state.selection)
      for (const id of ids) {
        if (toggle && set.has(id)) set.delete(id)
        else set.add(id)
      }
      next = [...set]
    }
    this.patch({ selection: next, selectedNode: null, snapRays: [], status: next.length ? `${next.length} object${next.length === 1 ? '' : 's'} selected` : 'Ready' })
  }
  clearSelection(): void {
    this.patch({ selection: [], selectedNode: null, snapRays: [], snapHit: null })
  }
  selectAll(): void {
    this.setSelection(allShapes(this.state.doc).map(s => s.id))
  }
  getSelectedShapes(): Shape[] {
    const editable = new Set(allShapes(this.state.doc).map(s => s.id))
    return this.state.selection.filter(id => editable.has(id)).map(id => getShape(this.state.doc, id)).filter((s): s is Shape => !!s)
  }
  setSelectedNode(sel: NodeSelection | null): void {
    this.patch({ selectedNode: sel })
  }
  setHover(hover: HoverState | null): void { this.patch({ hover }) }
  setSnap(snapHit: SnapHit | null, snapRays: SnapRay[] = []): void { this.patch({ snapHit, snapRays }) }
  setPointer(pointer: Pt | null): void { this.patch({ pointer }) }
  setDraft(draft: Draft): void { this.patch({ draft }) }
  setRightTab(tab: PanelTab): void { this.patch({ rightTab: tab }) }
  toggleLeft(): void { this.patch({ leftOpen: !this.state.leftOpen }) }
  toggleRight(): void { this.patch({ rightOpen: !this.state.rightOpen }) }
  setLeftOpen(open: boolean): void { this.patch({ leftOpen: open }) }
  setRightOpen(open: boolean): void { this.patch({ rightOpen: open }) }
  setShowRulers(v: boolean): void { this.patch({ showRulers: v }) }
  setStatus(status: string): void { this.patch({ status }) }
  setPenType(t: 'corner' | 'smooth'): void { this.patch({ penType: t }) }
  setPolygonSides(n: number): void { this.patch({ polygonSides: clamp(Math.round(n), 3, 24) }) }

  /* ── Style ────────────────────────────────────────────────── */
  pushStyleHistory(): void { this.pushHistory('Style') }
  updateSelectedShapes(fn: (s: Shape) => Shape, history = false): void {
    if (history) this.pushHistory('Shape')
    const byId = new Map(this.getSelectedShapes().map(s => [s.id, fn(s)]))
    if (!byId.size) return
    for (const layer of this.state.doc.layers) {
      for (let i = 0; i < layer.shapes.length; i++) {
        const updated = byId.get(layer.shapes[i].id)
        if (updated) layer.shapes[i] = updated
      }
    }
    this.docChanged()
  }
  updateShape(id: string, fn: (s: Shape) => Shape, history = false): void {
    if (history) this.pushHistory('Shape')
    for (const layer of this.state.doc.layers) {
      const i = layer.shapes.findIndex(s => s.id === id)
      if (i >= 0) { layer.shapes[i] = fn(layer.shapes[i]); this.docChanged(); return }
    }
  }
  replaceShapes(shapes: Shape[]): void {
    const map = new Map(shapes.map(s => [s.id, s]))
    if (!map.size) return
    for (const layer of this.state.doc.layers) {
      for (let i = 0; i < layer.shapes.length; i++) {
        const next = map.get(layer.shapes[i].id)
        if (next) layer.shapes[i] = next
      }
    }
    this.docChanged()
  }
  setFill(patch: Partial<Fill>, history = false): void {
    if (history) this.pushHistory('Fill')
    this.updateSelectedShapes(s => ({ ...s, fill: { ...s.fill, ...patch, stops: (patch.stops ?? s.fill.stops).map(st => ({ ...st })) } }))
  }
  setStroke(patch: Partial<Stroke>, history = false): void {
    if (history) this.pushHistory('Outline')
    this.updateSelectedShapes(s => ({ ...s, stroke: { ...s.stroke, ...patch, dash: [...(patch.dash ?? s.stroke.dash)] } }))
  }
  setShadow(patch: Partial<Shape['shadow']>, history = false): void {
    if (history) this.pushHistory('Effect')
    this.updateSelectedShapes(s => ({ ...s, shadow: { ...s.shadow, ...patch } }))
  }
  setOpacity(value: number, history = false): void {
    if (history) this.pushHistory('Opacity')
    this.updateSelectedShapes(s => ({ ...s, opacity: clamp(value, 0, 1) }))
  }
  setFillRule(rule: CanvasFillRule): void {
    this.pushHistory('Fill rule')
    this.updateSelectedShapes(s => ({ ...s, fillRule: rule }))
  }
  setSelectedText(content: string): void {
    this.pushHistory('Text')
    this.updateSelectedShapes(s => {
      if (s.kind !== 'text' || !s.text) return s
      const size = s.text.fontSize
      const lines = content.split('\n')
      const w = Math.max(4, ...lines.map(l => l.length * size * 0.58))
      return { ...s, text: { ...s.text, content, box: { ...s.text.box, w, h: lines.length * size * 1.12 } } }
    })
  }
  async convertTextToCurves(scope: 'selection' | 'job' = 'selection'): Promise<void> {
    const doc = this.state.doc
    const shapes = scope === 'selection' ? this.getSelectedShapes() : doc.layers
      .filter(l => l.visible && layerOperation(doc.production, l.id).mode !== 'ignore')
      .flatMap(l => l.shapes.filter(s => !s.hidden))
    const targets = shapes.filter(s => s.kind === 'text' && s.text)
    if (!targets.length) { this.toast('No text objects to convert', 'info'); return }
    const signatures = targets.map(s => JSON.stringify(s))
    try {
      if (targets.some(s => s.locked || getLayerOfShape(doc, s.id)?.locked)) throw new Error('Unlock the text object and its layer before converting.')
      const converted = await Promise.all(targets.map(async s => textShapeToCurves(s, await loadTextFont(s))))
      if (this.state.doc.id !== doc.id || this.state.doc.activePageId !== doc.activePageId ||
        targets.some((s, i) => JSON.stringify(getShape(this.state.doc, s.id)) !== signatures[i])) {
        throw new Error('Artwork changed while fonts loaded. Retry conversion on the current sheet.')
      }
      this.pushHistory('Convert text to curves')
      this.replaceShapes(converted)
      this.patch({ textEditId: null })
      this.toast(`${converted.length} text object${converted.length === 1 ? '' : 's'} converted to curves. Undo restores editable text.`, 'success')
    } catch (err) { this.toast(`Text conversion: ${(err as Error).message}`, 'warn', 8000) }
  }
  setTextProps(patch: Partial<NonNullable<Shape['text']>>): void {
    this.pushHistory('Typography')
    this.updateSelectedShapes(s => {
      if (s.kind !== 'text' || !s.text) return s
      const t = { ...s.text, ...patch }
      const lines = t.content.split('\n')
      const w = Math.max(4, ...lines.map(l => l.length * t.fontSize * 0.58))
      return { ...s, text: { ...t, box: { x: t.box.x, y: t.box.y, w, h: lines.length * t.fontSize * 1.12 } } }
    })
  }

  /* ── Object lifecycle ─────────────────────────────────────── */
  addShape(shape: Shape, select = true, history = true): void {
    if (history) this.pushHistory('Add shape')
    const layer = activeLayer(this.state.doc)
    shape.name = shape.name || nextShapeName(this.state.doc, 'Object')
    layer.shapes.push(applyLayerColor(shape, layer))
    this.state = {
      ...this.state,
      selection: select ? [shape.id] : this.state.selection,
      doc: { ...this.state.doc },
      status: `Added ${shape.name}`,
    }
    this.emit()
  }
  addShapes(shapes: Shape[], select = false): void {
    if (!shapes.length) return
    const layer = activeLayer(this.state.doc)
    layer.shapes.push(...shapes.map(s => applyLayerColor(s, layer)))
    if (select) this.state.selection = shapes.map(s => s.id)
    this.docChanged()
  }
  deleteSelection(): void {
    if (!this.state.selection.length) return
    this.pushHistory('Delete')
    const ids = new Set(this.getSelectedShapes().map(s => s.id))
    for (const layer of this.state.doc.layers) layer.shapes = layer.shapes.filter(s => !ids.has(s.id))
    this.state = {
      ...this.state,
      selection: [], selectedNode: null, doc: { ...this.state.doc }, status: `${ids.size} object${ids.size > 1 ? 's' : ''} deleted`,
    }
    this.emit()
  }
  duplicateSelection(offset = 6): void {
    const shapes = this.getSelectedShapes()
    if (!shapes.length) return
    this.pushHistory('Duplicate')
    const copies: Shape[] = []
    for (const shape of shapes) {
      const layer = getLayerOfShape(this.state.doc, shape.id)
      if (!layer) continue
      const copy = cloneShape(shape, offset, offset, `${shape.name} copy`)
      layer.shapes.push(applyLayerColor(copy, layer))
      copies.push(copy)
    }
    this.state = {
      ...this.state,
      selection: copies.map(c => c.id),
      doc: { ...this.state.doc }, status: `${copies.length} duplicate${copies.length > 1 ? 's' : ''}`,
    }
    this.emit()
  }
  copySelection(): void {
    this.clipboard = this.getSelectedShapes().map(s => cloneShape(s))
    if (this.clipboard.length) this.toast(`${this.clipboard.length} object${this.clipboard.length > 1 ? 's' : ''} copied`)
  }
  pasteSelection(): void {
    if (!this.clipboard.length) return
    this.pushHistory('Paste')
    const copies = this.clipboard.map(s => cloneShape(s, 8, 8))
    const layer = activeLayer(this.state.doc)
    layer.shapes.push(...copies.map(s => applyLayerColor(s, layer)))
    this.state = { ...this.state, selection: copies.map(c => c.id), doc: { ...this.state.doc } }
    this.emit()
  }
  nudgeSelection(dx: number, dy: number): void {
    const shapes = this.getSelectedShapes()
    if (!shapes.length) return
    this.pushHistory('Nudge')
    this.replaceShapes(shapes.map(s => ({ ...s, subpaths: translateSubpaths(s.subpaths, dx, dy), text: s.text ? { ...s.text, box: { ...s.text.box, x: s.text.box.x + dx, y: s.text.box.y + dy } } : undefined })))
  }
  alignSelection(mode: 'left' | 'hcenter' | 'right' | 'top' | 'vcenter' | 'bottom', toPage = false): void {
    const shapes = this.getSelectedShapes()
    if (!shapes.length) return
    this.pushHistory(`Align ${mode}`)
    const page = this.state.doc.page
    const selB = selectionBounds(shapes)
    const target = (shapes.length > 1 && !toPage) ? selB : { x: 0, y: 0, w: page.width, h: page.height }
    const updated = shapes.map(s => {
      const sb = shapeBounds(s)
      let dx = 0, dy = 0
      if (mode === 'left') dx = target.x - sb.x
      if (mode === 'hcenter') dx = target.x + target.w / 2 - (sb.x + sb.w / 2)
      if (mode === 'right') dx = target.x + target.w - (sb.x + sb.w)
      if (mode === 'top') dy = target.y - sb.y
      if (mode === 'vcenter') dy = target.y + target.h / 2 - (sb.y + sb.h / 2)
      if (mode === 'bottom') dy = target.y + target.h - (sb.y + sb.h)
      return { ...s, subpaths: translateSubpaths(s.subpaths, dx, dy), text: s.text ? { ...s.text, box: { ...s.text.box, x: s.text.box.x + dx, y: s.text.box.y + dy } } : undefined }
    })
    this.replaceShapes(updated)
  }

  distributeSelection(axis: 'horizontal' | 'vertical'): void {
    const shapes = this.getSelectedShapes()
    if (shapes.length < 3) {
      this.toast('Select at least 3 shapes to distribute spacing', 'info')
      return
    }
    this.pushHistory(`Distribute ${axis}`)

    if (axis === 'horizontal') {
      const sorted = [...shapes].sort((a, b) => shapeBounds(a).x - shapeBounds(b).x)
      const firstB = shapeBounds(sorted[0])
      const lastB = shapeBounds(sorted[sorted.length - 1])
      const totalSpan = (lastB.x + lastB.w) - firstB.x
      const sumWidths = sorted.reduce((sum, s) => sum + shapeBounds(s).w, 0)
      const gap = Math.max(0, (totalSpan - sumWidths) / (sorted.length - 1))

      let curX = firstB.x
      const updated: Shape[] = []
      for (const s of sorted) {
        const sb = shapeBounds(s)
        const dx = curX - sb.x
        updated.push({
          ...s,
          subpaths: translateSubpaths(s.subpaths, dx, 0),
          text: s.text ? { ...s.text, box: { ...s.text.box, x: s.text.box.x + dx } } : undefined,
        })
        curX += sb.w + gap
      }
      this.replaceShapes(updated)
    } else {
      const sorted = [...shapes].sort((a, b) => shapeBounds(a).y - shapeBounds(b).y)
      const firstB = shapeBounds(sorted[0])
      const lastB = shapeBounds(sorted[sorted.length - 1])
      const totalSpan = (lastB.y + lastB.h) - firstB.y
      const sumHeights = sorted.reduce((sum, s) => sum + shapeBounds(s).h, 0)
      const gap = Math.max(0, (totalSpan - sumHeights) / (sorted.length - 1))

      let curY = firstB.y
      const updated: Shape[] = []
      for (const s of sorted) {
        const sb = shapeBounds(s)
        const dy = curY - sb.y
        updated.push({
          ...s,
          subpaths: translateSubpaths(s.subpaths, 0, dy),
          text: s.text ? { ...s.text, box: { ...s.text.box, y: s.text.box.y + dy } } : undefined,
        })
        curY += sb.h + gap
      }
      this.replaceShapes(updated)
    }
  }

  /* ── Boolean Operations ────────────────────────────────────────── */
  applyBoolean(op: BooleanOp): void {
    const shapes = this.getSelectedShapes()
    if (shapes.length < 2) {
      this.toast('Select at least 2 shapes to perform Boolean operation', 'warn')
      return
    }
    let result: Shape | null
    try { result = booleanMultipleShapes(shapes, op) } catch (err) { this.toast(err instanceof Error ? err.message : 'Boolean operation failed', 'warn'); return }
    this.pushHistory(`Boolean ${op}`)
    if (!result) return

    const targetLayer = getLayerOfShape(this.state.doc, shapes[0].id) ?? activeLayer(this.state.doc)
    const removeIds = new Set(shapes.map(s => s.id))
    for (const l of this.state.doc.layers) {
      l.shapes = l.shapes.filter(s => !removeIds.has(s.id))
    }
    if (result.subpaths.length) targetLayer.shapes.push(applyLayerColor(result, targetLayer))
    this.state.selection = result.subpaths.length ? [result.id] : []
    this.docChanged()
    this.toast(`Boolean ${op.toUpperCase()} completed`, 'success')
  }

  booleanUnion(): void { this.applyBoolean('union') }
  booleanSubtract(): void { this.applyBoolean('subtract') }
  booleanIntersect(): void { this.applyBoolean('intersect') }
  booleanExclude(): void { this.applyBoolean('exclude') }

  /* ── Layer Transfer & Editing ─────────────────────────────────── */
  moveShapesToLayer(shapeIds: string[], targetLayerId: string): void {
    if (!shapeIds.length) return
    const targetLayer = this.state.doc.layers.find(l => l.id === targetLayerId)
    if (!targetLayer) return
    this.pushHistory('Transfer to layer')

    const toMove: Shape[] = []
    const idSet = new Set(shapeIds)
    for (const l of this.state.doc.layers) {
      if (l.id === targetLayerId) continue
      const rem: Shape[] = []
      for (const s of l.shapes) {
        if (idSet.has(s.id)) toMove.push(s)
        else rem.push(s)
      }
      l.shapes = rem
    }
    targetLayer.shapes.push(...toMove.map(s => applyLayerColor(s, targetLayer)))
    this.docChanged()
    this.toast(`Transferred ${toMove.length} object${toMove.length > 1 ? 's' : ''} to ${targetLayer.name}`, 'success')
  }

  setLayerName(layerId: string, name: string): void {
    const l = this.state.doc.layers.find(ly => ly.id === layerId)
    if (l && name.trim()) {
      this.pushHistory('Rename layer')
      l.name = name.trim()
      this.docChanged()
    }
  }

  setLayerSpeed(layerId: string, speed: number): void {
    this.setLayerOperation(layerId, { speed: Math.max(1, Math.min(1000, speed)) })
  }

  setLayerPower(layerId: string, power: number): void {
    const safePower = Math.max(0, Math.min(99, power))
    this.setLayerOperation(layerId, { power: safePower, maxPower: safePower })
  }
  selectShape(shapeId: string): void { this.setSelection([shapeId]) }
  moveShapeZ(id: string, dir: 1 | -1): void {
    const layer = getLayerOfShape(this.state.doc, id)
    if (!layer) return
    const i = layer.shapes.findIndex(s => s.id === id)
    const j = clamp(i + dir, 0, layer.shapes.length - 1)
    if (i === j) return
    this.pushHistory('Reorder')
    const [s] = layer.shapes.splice(i, 1)
    layer.shapes.splice(j, 0, s)
    this.docChanged()
  }
  setShapeName(id: string, name: string): void {
    this.pushHistory('Rename')
    this.updateShape(id, s => ({ ...s, name }))
  }
  setShapeLocked(id: string, locked: boolean): void {
    this.updateShape(id, s => ({ ...s, locked }), true)
  }
  setShapeHidden(id: string, hidden: boolean): void {
    this.updateShape(id, s => ({ ...s, hidden }), true)
  }

  powerClipSelection(): void {
    const shapes = this.getSelectedShapes()
    if (shapes.length < 2) { this.toast('Select content plus a container object', 'warn'); return }
    const ordered = this.state.doc.layers.flatMap(l => l.shapes).filter(s => this.state.selection.includes(s.id))
    const container = ordered[ordered.length - 1]
    if (!container.subpaths.length) { this.toast('The topmost object cannot be used as a clip frame', 'warn'); return }
    this.pushHistory('PowerClip')
    const content = ordered.filter(s => s.id !== container.id)
    const clip = cloneSubpaths(container.subpaths)
    container.meta = { ...(container.meta ?? {}), clipFrameFill: JSON.stringify(container.fill) }
    for (const s of content) {
      s.clip = cloneSubpaths(clip)
      s.meta = { ...(s.meta ?? {}), clipFrameId: container.id }
    }
    container.fill = makeFill({ type: 'none' })
    container.name = container.name.includes('Frame') ? container.name : `${container.name} Frame`
    this.state = {
      ...this.state,
      selection: [container.id],
      doc: { ...this.state.doc },
      status: `PowerClip · ${content.length} object${content.length > 1 ? 's' : ''} clipped to ${container.name}`,
    }
    this.emit()
    this.toast(`PowerClip applied — ${content.length} object${content.length > 1 ? 's' : ''} clipped`, 'success')
  }
  extractClip(): void {
    const selected = new Set(this.state.selection)
    if (!selected.size) return
    const all = this.state.doc.layers.flatMap(l => l.shapes)
    const contents = all.filter(s => s.clip?.length && (selected.has(s.id) || selected.has(String(s.meta?.clipFrameId))))
    const frames = all.filter(s => selected.has(s.id) && typeof s.meta?.clipFrameFill === 'string')
    if (!contents.length && !frames.length) { this.toast('No selected PowerClip contents found', 'warn'); return }
    this.pushHistory('Extract PowerClip')
    for (const frame of frames) {
      try { frame.fill = JSON.parse(String(frame.meta!.clipFrameFill)) } catch { /* preserve current fill if metadata is invalid */ }
      delete frame.meta!.clipFrameFill
    }
    for (const shape of contents) { delete shape.clip; if (shape.meta) delete shape.meta.clipFrameId }
    this.docChanged()
    this.toast(`PowerClip extracted — ${contents.length} objects released`, 'success')
  }

  /* ── Geometry transforms from canvas drags ───────────────── */
  applyTranslation(base: Shape[], dx: number, dy: number): Shape[] {
    const updated = base.map(s => ({
      ...s,
      subpaths: translateSubpaths(s.subpaths, dx, dy),
      text: s.text ? { ...s.text, box: { ...s.text.box, x: s.text.box.x + dx, y: s.text.box.y + dy } } : undefined,
    }))
    this.replaceShapes(updated)
    return updated
  }
  applyScale(base: Shape[], pivot: Pt, sx: number, sy: number): Shape[] {
    const updated = base.map(s => {
      const subpaths = scaleSubpaths(s.subpaths, pivot, sx, sy)
      let text = s.text
      if (text) {
        const x = pivot.x + (text.box.x - pivot.x) * sx
        const y = pivot.y + (text.box.y - pivot.y) * sy
        text = { ...text, box: { x, y, w: text.box.w * sx, h: text.box.h * sy }, fontSize: text.fontSize * Math.max(0.05, (Math.abs(sx) + Math.abs(sy)) / 2) }
      }
      return { ...s, subpaths, text }
    })
    this.replaceShapes(updated)
    return updated
  }
  applyRotation(base: Shape[], center: Pt, radians: number): Shape[] {
    const updated = base.map(s => ({
      ...s,
      subpaths: rotateSubpaths(s.subpaths, center, radians),
      text: s.text ? (() => {
        const c = boundsCenter(shapeBounds(s))
        const nc = { x: center.x + (c.x - center.x) * Math.cos(radians) - (c.y - center.y) * Math.sin(radians), y: center.y + (c.x - center.x) * Math.sin(radians) + (c.y - center.y) * Math.cos(radians) }
        return { ...s.text, box: { ...s.text.box, x: s.text.box.x + nc.x - c.x, y: s.text.box.y + nc.y - c.y }, rotation: (s.text.rotation ?? 0) + radians }
      })() : undefined,
    }))
    this.replaceShapes(updated)
    return updated
  }
  setSelectionPosition(x: number, y: number, commit = true): void {
    const shapes = this.getSelectedShapes()
    if (!shapes.length) return
    const b = selectionBounds(shapes)
    const dx = x - b.x, dy = y - b.y
    if (commit) this.pushHistory('Transform')
    this.replaceShapes(shapes.map(s => ({
      ...s, subpaths: translateSubpaths(s.subpaths, dx, dy),
      text: s.text ? { ...s.text, box: { ...s.text.box, x: s.text.box.x + dx, y: s.text.box.y + dy } } : undefined,
    })))
  }
  setSelectionSize(w: number, h: number): void {
    const shapes = this.getSelectedShapes()
    if (!shapes.length) return
    const b = selectionBounds(shapes)
    if (b.w < 1e-6 || b.h < 1e-6) return
    this.pushHistory('Resize')
    this.replaceShapes(shapes.map(s => ({
      ...s,
      subpaths: scaleSubpaths(s.subpaths, { x: b.x, y: b.y }, Math.max(0.01, w) / b.w, Math.max(0.01, h) / b.h),
      text: s.text ? { ...s.text, box: { x: b.x + (s.text.box.x - b.x) * (w / b.w), y: b.y + (s.text.box.y - b.y) * (h / b.h), w: s.text.box.w * (w / b.w), h: s.text.box.h * (h / b.h) } } : undefined,
    })))
  }

  /* ── Node editing ─────────────────────────────────────────── */
  private nodeContext(sel: NodeSelection): { shape: Shape; sub: Subpath; node: PathNode } | null {
    const shape = getShape(this.state.doc, sel.shapeId)
    if (!shape) return null
    const sub = shape.subpaths[sel.subpathIndex]
    if (!sub) return null
    const node = sub.nodes[sel.nodeIndex]
    if (!node) return null
    return { shape, sub, node }
  }
  moveNodeTo(sel: NodeSelection, p: Pt, history = false): void {
    if (history) this.pushHistory('Move node')
    const ctx = this.nodeContext(sel)
    if (!ctx) return
    const dx = p.x - ctx.node.x, dy = p.y - ctx.node.y
    translateNode(ctx.node, dx, dy)
    ctx.shape.kind = ctx.shape.kind === 'line' ? 'line' : 'path'
    this.docChanged()
  }
  setNodeHandle(sel: NodeSelection, which: 'in' | 'out', p: Pt, history = false): void {
    if (history) this.pushHistory('Curve handle')
    const ctx = this.nodeContext(sel)
    if (!ctx) return
    const { node } = ctx
    node[which] = { x: p.x, y: p.y }
    const v = sub(p, { x: node.x, y: node.y })
    const l = Math.hypot(v.x, v.y) || 1
    if (node.type === 'symmetric') {
      const opp = which === 'in' ? 'out' : 'in'
      node[opp] = { x: node.x - v.x, y: node.y - v.y }
    } else if (node.type === 'smooth') {
      const opp = which === 'in' ? 'out' : 'in'
      const ov = sub(node[opp], { x: node.x, y: node.y })
      const ol = Math.hypot(ov.x, ov.y) || 1
      node[opp] = { x: node.x - (v.x / l) * ol, y: node.y - (v.y / l) * ol }
    }
    ctx.shape.kind = 'path'
    this.docChanged()
  }
  setNodeType(type: 'cusp' | 'smooth' | 'symmetric'): void {
    const sel = this.state.selectedNode
    if (!sel) return
    const ctx = this.nodeContext(sel)
    if (!ctx) return
    this.pushHistory('Node type')
    const { node, sub: path } = ctx
    node.type = type
    if (type !== 'cusp') {
      const iv = sub(node.in, { x: node.x, y: node.y })
      const ov = sub(node.out, { x: node.x, y: node.y })
      let il = Math.hypot(iv.x, iv.y), ol = Math.hypot(ov.x, ov.y)
      let dir
      if (il + ol < 1e-6) {
        const count = path.nodes.length
        const idx = sel.nodeIndex
        const prev = path.nodes[(idx - 1 + count) % count]
        const next = path.nodes[(idx + 1) % count]
        const tangent = { x: next.x - prev.x, y: next.y - prev.y }
        const tl = Math.hypot(tangent.x, tangent.y)
        dir = tl < 1e-6 ? { x: 1, y: 0 } : { x: tangent.x / tl, y: tangent.y / tl }
        const defaultLen = Math.max(3, Math.min(12, (dist({ x: prev.x, y: prev.y }, { x: next.x, y: next.y }) / 8) || 6))
        il = defaultLen
        ol = defaultLen
      } else if (il < 1e-6) {
        dir = { x: ov.x / ol, y: ov.y / ol }
      } else if (ol < 1e-6) {
        dir = { x: -iv.x / il, y: -iv.y / il }
      } else {
        const d1 = { x: ov.x / ol, y: ov.y / ol }
        const d2 = { x: -iv.x / il, y: -iv.y / il }
        const d = { x: d1.x + d2.x, y: d1.y + d2.y }
        const dl = Math.hypot(d.x, d.y)
        dir = dl < 1e-6 ? d1 : { x: d.x / dl, y: d.y / dl }
      }
      if (type === 'symmetric') {
        const avg = Math.max(3, (il + ol) / 2)
        il = avg; ol = avg
      }
      node.in = { x: node.x - dir.x * il, y: node.y - dir.y * il }
      node.out = { x: node.x + dir.x * ol, y: node.y + dir.y * ol }
    }
    ctx.shape.kind = 'path'
    this.docChanged()
  }
  deleteNode(): void {
    const sel = this.state.selectedNode
    if (!sel) return
    const ctx = this.nodeContext(sel)
    if (!ctx) return
    const min = ctx.sub.closed ? 3 : 2
    if (ctx.sub.nodes.length <= min) { this.toast('Cannot remove the last editable node', 'warn'); return }
    this.pushHistory('Delete node')
    ctx.sub.nodes.splice(sel.nodeIndex, 1)
    this.state = { ...this.state, selectedNode: null, doc: { ...this.state.doc } }
    this.emit()
  }
  insertNodeAt(shapeId: string, subpathIndex: number, segmentIndex: number, t: number): NodeSelection | null {
    const shape = getShape(this.state.doc, shapeId)
    if (!shape) return null
    const sub = shape.subpaths[subpathIndex]
    if (!sub) return null
    this.pushHistory('Split curve')
    const seg = segmentAt(sub, segmentIndex)
    const [l, r] = splitCubic(seg, clamp(t, 0.001, 0.999))
    const a = sub.nodes[segmentIndex]
    const b = sub.nodes[(segmentIndex + 1) % sub.nodes.length]
    a.out = { ...l.p1 }
    b.in = { ...r.p2 }
    const n: PathNode = { id: uid('n'), x: l.p3.x, y: l.p3.y, in: { ...l.p2 }, out: { ...r.p1 }, type: 'smooth' }
    const insertAt = segmentIndex + 1
    sub.nodes.splice(insertAt, 0, n)
    shape.kind = 'path'
    const sel = { shapeId, subpathIndex, nodeIndex: insertAt }
    this.state = { ...this.state, selectedNode: sel, doc: { ...this.state.doc }, status: 'Node inserted at midpoint' }
    this.emit()
    return sel
  }
  dragSegment(shapeId: string, subpathIndex: number, segmentIndex: number, delta: Pt): void {
    const shape = getShape(this.state.doc, shapeId)
    if (!shape) return
    const sub = shape.subpaths[subpathIndex]
    if (!sub) return
    const a = sub.nodes[segmentIndex]
    const b = sub.nodes[(segmentIndex + 1) % sub.nodes.length]
    a.out = add(a.out, { x: delta.x * 4 / 3, y: delta.y * 4 / 3 })
    b.in = add(b.in, { x: delta.x * 4 / 3, y: delta.y * 4 / 3 })
    shape.kind = 'path'
    this.docChanged()
  }

  /* ── Guides / grid / snap ─────────────────────────────────── */
  addGuide(orientation: 'h' | 'v', position: number): void {
    this.pushHistory('Add guide')
    this.state.doc.guides.push({ id: uid('guide'), orientation, position, color: '#2b59ff' })
    this.docChanged()
  }
  updateGuide(id: string, position: number): void {
    const g = this.state.doc.guides.find(g => g.id === id)
    if (!g) return
    g.position = position
    this.docChanged()
  }
  removeGuide(id: string): void {
    this.pushHistory('Remove guide')
    this.state.doc.guides = this.state.doc.guides.filter(g => g.id !== id)
    this.docChanged()
  }
  clearGuides(): void {
    if (!this.state.doc.guides.length) return
    this.pushHistory('Clear guides')
    this.state.doc.guides = []
    this.docChanged()
  }
  setGrid(patch: Partial<DocumentModel['grid']>): void {
    this.pushHistory('Grid')
    this.state.doc.grid = { ...this.state.doc.grid, ...patch }
    this.docChanged()
  }
  setSnapSettings(patch: Partial<SnapSettings>): void {
    this.state.doc.snap = { ...this.state.doc.snap, ...patch }
    this.docChanged()
  }
  toggleSnap(): void {
    this.setSnapSettings({ enabled: !this.state.doc.snap.enabled })
  }
  setPage(patch: Partial<DocumentModel['page']>): void {
    if ([patch.width, patch.height].some(n => n !== undefined && (!Number.isFinite(n) || n <= 0))) { this.toast('Sheet dimensions must be positive finite numbers', 'warn'); return }
    this.pushHistory('Page setup')
    this.state.doc.page = { ...this.state.doc.page, ...patch }
    // Sync active page in pages list if present
    if (this.state.doc.pages && this.state.doc.activePageId) {
      const idx = this.state.doc.pages.findIndex(p => p.id === this.state.doc.activePageId)
      if (idx !== -1) {
        this.state.doc.pages[idx] = { ...this.state.doc.pages[idx], ...patch }
      }
    }
    this.docChanged()
  }

  newDocument(options?: { name?: string; width?: number; height?: number; unit?: 'mm' | 'in'; color?: string }): void {
    if (options && [options.width, options.height].some(v => v !== undefined && (!Number.isFinite(v) || v <= 0))) { this.toast('Use positive finite sheet dimensions', 'warn'); return }
    const doc = createBlankDocument(options)
    this.undoStack = []
    this.redoStack = []
    this.state.doc = doc
    this.state.selection = []
    this.state.selectedNode = null; this.state.draft = null; this.state.hover = null; this.state.textEditId = null
    this.state.sim = { playing: false, progress: 0, headPos: null, laserOn: false, speed: 1 }
    this.fitPage()
    this.docChanged()
    this.toast(`Created new document: ${doc.name} (${doc.page.width} × ${doc.page.height} mm)`, 'success')
  }

  private saveActiveSheet(): void {
    const doc = this.state.doc
    if (!doc.pages?.length) doc.pages = [{ ...doc.page, id: doc.page.id || uid('page') }]
    const current = doc.pages.find(p => p.id === doc.activePageId || p.id === doc.page.id) ?? doc.pages[0]
    Object.assign(current, doc.page, { layers: doc.layers, activeLayerId: doc.activeLayerId })
    doc.activePageId = current.id
  }
  addPage(name?: string, width?: number, height?: number): void {
    this.pushHistory('Add page')
    this.saveActiveSheet()
    const layer = makeLayer('Layer 1', '#000000')
    const page: Page = { id: uid('page'), name: name ?? `Sheet ${this.state.doc.pages!.length + 1}`,
      width: width ?? this.state.doc.page.width, height: height ?? this.state.doc.page.height,
      color: this.state.doc.page.color, unit: this.state.doc.page.unit, layers: [layer], activeLayerId: layer.id }
    this.state.doc.pages!.push(page)
    this.setActivePage(page.id!)
    this.toast(`Added ${page.name}`, 'success')
  }
  setActivePage(pageId: string): void {
    if (this.state.doc.activePageId === pageId) return
    this.saveActiveSheet()
    const found = this.state.doc.pages!.find(p => p.id === pageId)
    if (!found) return
    found.layers ??= [makeLayer('Layer 1', '#000000')]
    this.state.doc.activePageId = pageId
    const { layers, activeLayerId, ...metadata } = found
    this.state.doc.page = metadata
    this.state.doc.layers = found.layers
    this.state.doc.activeLayerId = found.activeLayerId ?? found.layers[0].id
    this.state.doc.production.layers[this.state.doc.activeLayerId] ??= defaultLayerOperation()
    this.state.selection = []; this.state.selectedNode = null; this.state.draft = null; this.state.textEditId = null
    this.docChanged(); this.fitPage()
  }
  deletePage(pageId: string): void {
    this.saveActiveSheet()
    const pages = this.state.doc.pages!
    if (pages.length <= 1) { this.toast('Document must have at least one page', 'warn'); return }
    if (!pages.some(p => p.id === pageId)) return
    this.pushHistory('Delete page')
    if (this.state.doc.activePageId === pageId) this.setActivePage(pages.find(p => p.id !== pageId)!.id!)
    this.state.doc.pages = pages.filter(p => p.id !== pageId)
    this.docChanged()
  }
  renamePage(pageId: string, name: string): void {
    const target = this.state.doc.pages?.find(p => p.id === pageId)
    if (!target || !name.trim()) return
    this.pushHistory('Rename sheet'); target.name = name.trim()
    if (this.state.doc.page.id === pageId) this.state.doc.page.name = name.trim()
    this.docChanged()
  }

  applyMaterialPreset(layerId: string, presetId: string): void {
    const preset = MATERIAL_PRESETS.find(p => p.id === presetId)
    if (!preset) return
    this.pushHistory('Material preset')
    this.setLayerOperation(layerId, {
      mode: preset.mode,
      speed: preset.speed,
      power: preset.power,
      minPower: preset.minPower,
      maxPower: preset.maxPower,
      blower: preset.blower,
      passes: preset.passes,
      scanInterval: preset.scanInterval,
    })
    this.toast(`Applied material preset: ${preset.name} (${preset.speed}mm/s, ${preset.power}%)`, 'success')
  }
  setDocName(name: string): void {
    this.state.doc.name = name
    this.docChanged()
  }
  setKnife(patch: Partial<KnifeSettings>): void {
    this.patch({ knife: { ...this.state.knife, ...patch } })
  }
  setGridPattern(patch: Partial<GridPatternSettings>): void {
    this.patch({ gridPattern: { ...this.state.gridPattern, ...patch } })
  }
  setRadialPattern(patch: Partial<RadialPatternSettings>): void {
    this.patch({ radialPattern: { ...this.state.radialPattern, ...patch } })
  }
  useSelectionAsRadialAnchor(): void {
    const shapes = this.getSelectedShapes()
    if (!shapes.length) return
    const b = selectionBounds(shapes)
    const c = boundsCenter(b)
    this.setRadialPattern({ pivotX: Math.round(c.x * 10) / 10, pivotY: Math.round(c.y * 10) / 10, radius: 0 })
  }

  /* ── Production / laser job ───────────────────────────────── */
  setProduction(patch: Partial<ProductionSettings>, history = true): void {
    if (Object.values(patch).some(v => typeof v === 'number' && !Number.isFinite(v))) { this.toast('Enter a finite job setting', 'warn'); return }
    if (history) this.pushHistory('Job settings')
    this.state.doc.production = { ...this.state.doc.production, ...patch }
    if (patch.layers) this.state.doc.production.layers = patch.layers
    this.docChanged()
  }
  setProductionPreview(preview: boolean): void {
    this.state.doc.production = { ...this.state.doc.production, preview }
    if (!preview && this.state.sim.playing) {
      this.state.sim = { ...this.state.sim, playing: false }
    }
    this.docChanged()
  }
  setSimulation(patch: Partial<LaserSimulationState>): void {
    this.patch({ sim: { ...this.state.sim, ...patch } })
  }
  setLayerOperation(layerId: string, patch: Partial<LayerOperation>, history = true): void {
    if (Object.values(patch).some(v => typeof v === 'number' && !Number.isFinite(v))) { this.toast('Enter a finite process value', 'warn'); return }
    if (history) this.pushHistory('Layer process')
    const prod = this.state.doc.production
    const current = layerOperation(prod, layerId)
    const next = { ...current, ...patch }
    if (patch.maxPower !== undefined || patch.power !== undefined) {
      const max = clamp(patch.maxPower ?? patch.power!, 0, 99)
      next.power = max; next.maxPower = max
      if (patch.minPower === undefined && (next.minPower ?? max) > max) {
        next.minPower = max
        this.toast(`Minimum power reduced to ${max}% to match the new maximum.`, 'info')
      }
    }
    if (patch.minPower !== undefined) {
      next.minPower = clamp(patch.minPower, 0, next.maxPower ?? next.power)
      if (next.minPower !== patch.minPower) this.toast('Minimum power cannot exceed maximum power.', 'info')
    }
    prod.layers = { ...prod.layers, [layerId]: next }
    this.docChanged()
  }
  setTextInfill(enabled: boolean, spacing = .15): void {
    this.pushHistory('Text infill')
    this.updateSelectedShapes(s => s.kind === 'text' || typeof s.meta?.originalText === 'string' ? {
      ...s, textInfill: { enabled, spacing: clamp(spacing, .02, 5) },
      fill: { ...s.fill, type: enabled ? 'solid' : 'none', color: s.stroke.color },
    } : s)
  }
  setLayerMode(layerId: string, mode: ProductionMode): void {
    this.pushHistory('Layer operation')
    const prod = this.state.doc.production
    const current = layerOperation(prod, layerId), defaults = defaultLayerOperation(mode)
    // Operation is a toolpath choice, not permission to replace entered process settings.
    prod.layers = { ...prod.layers, [layerId]: { ...defaults, ...current, mode,
      speed: current.speed > 0 ? current.speed : defaults.speed,
      passes: current.passes >= 1 ? current.passes : defaults.passes,
    } }
    this.docChanged()
  }
  nestProduction(scope: 'selection' | 'all' = 'selection'): { placed: number; overflow: number } {
    const prod = this.state.doc.production
    let shapes = this.getSelectedShapes().filter(s => s.kind !== 'text')
    if (scope === 'all' || !shapes.length) {
      shapes = this.state.doc.layers.filter(l => l.visible).flatMap(l => layerOperation(prod, l.id).mode !== 'ignore' ? l.shapes.filter(s => !s.hidden && !s.locked && s.kind !== 'text') : [])
    }
    if (!shapes.length) { this.toast('No objects available to nest', 'warn'); return { placed: 0, overflow: 0 } }
    const result = nestShapes(shapes, this.state.doc.page.width, this.state.doc.page.height, prod.margin, prod.spacing, prod.allowRotate)
    if (!result.placements.length) { this.toast('Nothing fits on the current sheet — reduce spacing or increase the page', 'warn'); return { placed: 0, overflow: result.overflow } }
    this.pushHistory('Nest job')
    const updated = new Map<string, Shape>()
    for (const p of result.placements) {
      const shape = p.shape
      const original = shapeBounds(shape)
      let subpaths = shape.subpaths
      let text = shape.text
      if (p.rotated) {
        const center = { x: original.x + original.w / 2, y: original.y + original.h / 2 }
        subpaths = rotateSubpaths(shape.subpaths, center, Math.PI / 2)
        if (text) text = { ...text, rotation: (text.rotation ?? 0) + Math.PI / 2 }
      }
      const rotatedBounds = shapeBounds({ ...shape, subpaths, text })
      const dx = p.x - rotatedBounds.x, dy = p.y - rotatedBounds.y
      const movedSubpaths = translateSubpaths(subpaths, dx, dy)
      if (text) text = { ...text, box: { ...text.box, x: text.box.x + dx, y: text.box.y + dy } }
      updated.set(shape.id, { ...shape, subpaths: movedSubpaths, text })
    }
    this.replaceShapes([...updated.values()])
    this.state = {
      ...this.state,
      selection: result.placements.map(p => p.shape.id),
      status: `Nest complete · ${result.placements.length} placed${result.overflow ? ` · ${result.overflow} overflow` : ''}`,
    }
    this.emit()
    this.toast(`Nested ${result.placements.length} objects on the ${this.state.doc.page.width} × ${this.state.doc.page.height} mm sheet`, result.overflow ? 'warn' : 'success')
    return { placed: result.placements.length, overflow: result.overflow }
  }
  importShapes(shapes: Shape[], filename: string, operation: ProductionMode = 'cut'): void {
    if (!shapes.length) { this.toast('No vector geometry found in the imported file', 'warn'); return }
    this.pushHistory('Import')
    const base = filename.replace(/\.[^.]+$/, '') || 'Imported job'
    const groups = new Map<string, Shape[]>()
    for (const shape of shapes) {
      const key = typeof shape.meta?.importLayer === 'string' ? shape.meta.importLayer : 'Imported'
      const list = groups.get(key) ?? []
      list.push(shape)
      groups.set(key, list)
    }
    const colors = ['#ff9e64', '#5cb8ff', '#63e6c1', '#c4a2ff', '#f1c75b', '#ff6b81', '#8b9cff']
    const layers: Layer[] = []
    let gi = 0
    for (const [group, groupShapes] of groups) {
      const layer = makeLayer(groups.size > 1 ? `${base} / ${group}` : base, colors[gi++ % colors.length])
      layer.shapes = groupShapes
      layer.shapes.forEach(s => { s.name = groups.size > 1 ? `${s.name} · ${group}` : s.name })
      this.state.doc.production.layers[layer.id] = defaultLayerOperation(operation)
      layers.push(layer)
    }
    this.state.doc.layers.push(...layers)
    this.state.doc.production.preview = true
    this.state.doc.activeLayerId = layers[layers.length - 1].id
    this.state = {
      ...this.state,
      selection: shapes.map(s => s.id),
      rightTab: 'production',
      status: `Imported ${shapes.length} paths across ${layers.length} layer${layers.length > 1 ? 's' : ''} from ${filename}`,
      doc: { ...this.state.doc },
    }
    this.emit()
    this.toast(`Imported ${shapes.length} vector paths${layers.length > 1 ? ` · ${layers.length} source layers` : ''}`, 'success')
  }

  /* ── Layers ───────────────────────────────────────────────── */
  addLayer(name = 'New layer'): void {
    this.pushHistory('Add layer')
    const layer = makeLayer(name, '#a4b8ff')
    this.state.doc.layers.push(layer)
    this.state.doc.activeLayerId = layer.id
    this.state.doc.production.layers[layer.id] = defaultLayerOperation('cut')
    this.docChanged()
  }
  setActiveLayer(id: string): void {
    this.state.doc.activeLayerId = id
    this.docChanged()
  }
  setLayerColor(id: string, color: string): void {
    if (!/^#[0-9a-f]{6}$/i.test(color)) return
    const layer = this.state.doc.layers.find(l => l.id === id)
    if (!layer) return
    this.pushHistory('Layer colour')
    const updated = { ...layer, color, useLayerColor: true }
    updated.shapes = layer.shapes.map(s => applyLayerColor(s, updated))
    this.state.doc.layers = this.state.doc.layers.map(l => l.id === id ? updated : l)
    const index = RDWORKS_PALETTE.findIndex(c => c.toLowerCase() === color.toLowerCase())
    this.state.doc.production.layers[id] = { ...layerOperation(this.state.doc.production, id), colorIndex: index >= 0 ? index : undefined }
    this.docChanged()
  }
  updateLayer(id: string, patch: Partial<Layer>): void {
    this.pushHistory('Layer')
    this.state.doc.layers = this.state.doc.layers.map(l => l.id === id ? { ...l, ...patch } : l)
    if (patch.visible === false) {
      const hiddenIds = new Set(this.state.doc.layers.find(l => l.id === id)?.shapes.map(s => s.id) ?? [])
      this.state.selection = this.state.selection.filter(sid => !hiddenIds.has(sid))
    }
    if (patch.locked === true) {
      const lockedIds = new Set(this.state.doc.layers.find(l => l.id === id)?.shapes.map(s => s.id) ?? [])
      this.state.selection = this.state.selection.filter(sid => !lockedIds.has(sid))
    }
    this.docChanged()
  }
  deleteLayer(id: string): void {
    if (this.state.doc.layers.length <= 1) return
    this.pushHistory('Delete layer')
    this.state.doc.layers = this.state.doc.layers.filter(l => l.id !== id)
    delete this.state.doc.production.layers[id]
    if (this.state.doc.activeLayerId === id) this.state.doc.activeLayerId = this.state.doc.layers[this.state.doc.layers.length - 1].id
    this.docChanged()
  }

  /* ── Knife ────────────────────────────────────────────────── */
  commitCut(points: Pt[]): number {
    if (points.length < 2) return 0
    const settings = this.state.knife
    const shapes = settings.cutAll
      ? allShapes(this.state.doc).filter(s => !s.locked)
      : this.getSelectedShapes()
    if (!shapes.length) { this.toast('Nothing to cut — select an object first', 'warn'); return 0 }
    let cutResult: ReturnType<typeof cutShapes>
    try { cutResult = cutShapes(shapes, points, settings) } catch (err) { this.toast(err instanceof Error ? err.message : 'Knife operation failed', 'warn'); this.patch({ draft: null }); return 0 }
    const { result, totalCuts } = cutResult
    if (!result.length || totalCuts === 0) {
      this.toast('The cut path did not cross any objects', 'warn')
      this.patch({ draft: null, snapHit: null, snapRays: [] })
      return 0
    }
    this.pushHistory('Knife cut')
    const selection: string[] = []
    for (const r of result) {
      for (const layer of this.state.doc.layers) {
        const i = layer.shapes.findIndex(s => s.id === r.sourceId)
        if (i >= 0) {
          layer.shapes.splice(i, 1, ...r.pieces)
          selection.push(...r.pieces.map(p => p.id))
          break
        }
      }
    }
    this.state = {
      ...this.state,
      selection,
      selectedNode: null,
      draft: null,
      snapHit: null,
      snapRays: [],
      doc: { ...this.state.doc },
      status: `Knife cut · ${result.length} objects split · ${result.every(r => r.pieces.every(p => p.subpaths.every(sp => sp.closed))) ? 'closed' : 'open'}`,
    }
    this.emit()
    this.toast(`Slice complete — ${result.length} object${result.length > 1 ? 's' : ''} divided`, 'success')
    return result.length
  }
  setKnifeMode(mode: KnifeMode): void { this.setKnife({ mode }) }
  setCutSpan(span: CutSpan): void { this.setKnife({ span }) }

  /* ── Patterns ─────────────────────────────────────────────── */
  applyGridPattern(): number {
    const shapes = this.getSelectedShapes()
    if (!shapes.length) { this.toast('Select an object to array', 'warn'); return 0 }
    this.pushHistory('Step and Repeat')
    let added = 0
    const created: string[] = []
    for (const shape of shapes) {
      const layer = getLayerOfShape(this.state.doc, shape.id)
      if (!layer) continue
      const copies = gridPattern(shape, this.state.gridPattern)
      layer.shapes.push(...copies.map(s => applyLayerColor(s, layer)))
      created.push(...copies.map(c => c.id))
      added += copies.length
    }
    this.state = {
      ...this.state,
      selection: [...this.state.selection, ...created],
      doc: { ...this.state.doc },
      status: `Step and Repeat · +${added} copies`,
    }
    this.emit()
    this.toast(`Rectangular array created — ${added} new copies`, 'success')
    return added
  }
  applyRadialPattern(): number {
    const shapes = this.getSelectedShapes()
    if (!shapes.length) { this.toast('Select an object to rotate', 'warn'); return 0 }
    this.pushHistory('Radial array')
    let added = 0
    const created: string[] = []
    for (const shape of shapes) {
      const layer = getLayerOfShape(this.state.doc, shape.id)
      if (!layer) continue
      const copies = radialPattern(shape, this.state.radialPattern)
      layer.shapes.push(...copies.map(s => applyLayerColor(s, layer)))
      created.push(...copies.map(c => c.id))
      added += copies.length
    }
    this.state = {
      ...this.state,
      selection: [...this.state.selection, ...created],
      doc: { ...this.state.doc },
      status: `Radial array · +${added} copies`,
    }
    this.emit()
    this.toast(`Circular pattern created — ${added} rotated copies`, 'success')
    return added
  }

  /* ── Misc ─────────────────────────────────────────────────── */
  toast(message: string, tone: Toast['tone'] = 'info', ttl = 3200): void {
    const t: Toast = { id: uid('toast'), message, tone, ttl }
    this.patch({ toasts: [...this.state.toasts, t] })
    const timer = window.setTimeout(() => {
      this.patch({ toasts: this.state.toasts.filter(x => x.id !== t.id) })
    }, ttl)
    this.toastTimers.push(timer)
    if (this.toastTimers.length > 20) {
      const old = this.toastTimers.shift()
      if (old) clearTimeout(old)
    }
  }
  dismissToast(id: string): void {
    this.patch({ toasts: this.state.toasts.filter(t => t.id !== id) })
  }
  resetDemo(): void {
    this.pushHistory('Reset')
    const doc = createShowcaseDocument()
    this.state = {
      ...this.state, doc, selection: [], selectedNode: null, draft: null,
      toasts: [], status: 'Showcase restored',
      radialPattern: { ...this.state.radialPattern, pivotX: 210, pivotY: 148, radius: 74 },
    }
    this.emit()
    this.toast('Showcase artwork restored', 'success')
  }
  loadDocument(doc: DocumentModel): void {
    const normalized = normalizeDocument(doc)
    this.pushHistory('Open')
    this.state = { ...this.state, doc: normalized, selection: [], selectedNode: null, draft: null, textEditId: null, hover: null, sim: { ...this.state.sim, playing: false, progress: 0, headPos: null, laserOn: false }, status: 'Document loaded' }
    this.emit(); this.fitPage()
  }
  createTextAt(p: Pt): Shape {
    const shape = createTextShape(p.x, p.y, 'New text', 12)
    shape.name = 'Editorial Text'
    shape.text!.fontFamily = 'Arial'
    shape.text!.fontWeight = 700
    this.addShape(shape)
    this.patch({ textEditId: shape.id })
    return shape
  }
}

export const editor = new EditorStore()

export function useEditor(): [EditorState, EditorStore] {
  const state = useSyncExternalStore(editor.subscribe, editor.getState, editor.getState)
  return [state, editor]
}

/* helper for canvas hit snapping, re-exported for stage */
export function snapWorld(
  store: EditorStore,
  pointer: Pt,
  exclude: Set<string>,
): SnapHit | null {
  const state = store.getState()
  const settings = state.doc.snap
  if (!settings.enabled) return null
  const candidates = collectStaticCandidates(state.doc, exclude, pointer, settings, state.view.zoom)
  return snapPoint(pointer, candidates, settings.radius / state.view.zoom, state.view.zoom)
}

export { alignmentSnap, boundsCenter, shapeBounds, selectionBounds, makeFill, makeStroke, makeShadow, rad }
