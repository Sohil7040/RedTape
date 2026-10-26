import { useCallback, useEffect, useRef } from 'react'
import {
  Bounds, Pt, add, boundsCenter, clamp, cloneNode, cloneSubpaths, cubicMidpoint, dist, nearestPointOnSegment,
  pathToPath2D, segmentAt, segments, sub, uid,
} from '../core/geometry'
import {
  DocumentModel, Shape, Tool, allShapes, getShape, makeFill, makeShape, makeStroke, selectionBounds, shapeBounds,
} from '../core/model'
import { alignmentSnap, collectStaticCandidates, snapPoint, SnapHit, SnapRay } from '../core/snapping'
import { smoothCutPath } from '../core/knife'
import { EditorStore, EditorState } from '../core/store'
import { RULER, renderScene, selectionHandles } from '../render/renderer'
import { getProductionJob, getSimulationStateAt } from '../core/production'

interface Props { state: EditorState; store: EditorStore }

type Interaction =
  | { type: 'pan'; last: Pt; pointerId: number }
  | { type: 'move'; base: Shape[]; bounds: Bounds; start: Pt; pointerId: number; started: boolean }
  | { type: 'resize'; handle: string; base: Shape[]; bounds: Bounds; start: Pt; pointerId: number; started: boolean }
  | { type: 'rotate'; base: Shape[]; center: Pt; startAngle: number; pointerId: number; started: boolean }
  | { type: 'marquee'; start: Pt; additive: boolean; pointerId: number; moved: boolean }
  | { type: 'draw'; kind: 'rect' | 'ellipse' | 'line' | 'polygon'; start: Pt; pointerId: number }
  | { type: 'node'; sel: { shapeId: string; subpathIndex: number; nodeIndex: number }; pointerId: number; started: boolean }
  | { type: 'handle'; sel: { shapeId: string; subpathIndex: number; nodeIndex: number }; which: 'in' | 'out'; pointerId: number; started: boolean }
  | { type: 'segment'; shapeId: string; subpathIndex: number; segmentIndex: number; last: Pt; pointerId: number; started: boolean }
  | { type: 'penhandle'; nodeIndex: number; pointerId: number; started: boolean }
  | { type: 'knife-line'; start: Pt; pointerId: number }
  | { type: 'knife-free'; pointerId: number }
  | { type: 'bezier'; pointerId: number }
  | { type: 'new-guide'; orientation: 'h' | 'v'; pointerId: number }
  | { type: 'move-guide'; id: string; orientation: 'h' | 'v'; pointerId: number }
  | null

export default function CanvasStage({ state, store }: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const wrapRef = useRef<HTMLDivElement>(null)
  const action = useRef<Interaction>(null)
  const spaceDown = useRef(false)
  const lastClick = useRef<{ time: number; x: number; y: number }>({ time: 0, x: 0, y: 0 })
  const hoverRaf = useRef(0)

  const ctxOf = useCallback((): CanvasRenderingContext2D | null => {
    const canvas = canvasRef.current
    return canvas ? canvas.getContext('2d') : null
  }, [])

  /* resize + device pixel ratio */
  useEffect(() => {
    const wrap = wrapRef.current
    if (!wrap) return
    const ro = new ResizeObserver(entries => {
      const r = entries[0].contentRect
      store.setViewport(Math.max(320, r.width), Math.max(320, r.height))
    })
    ro.observe(wrap)
    return () => ro.disconnect()
  }, [store])

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    let raf = 0
    raf = requestAnimationFrame(() => {
      const dpr = Math.min(2.5, window.devicePixelRatio || 1)
      const w = Math.round(state.view.width * dpr), h = Math.round(state.view.height * dpr)
      if (canvas.width !== w || canvas.height !== h) {
        canvas.width = w
        canvas.height = h
        canvas.style.width = `${state.view.width}px`
        canvas.style.height = `${state.view.height}px`
      }
      const ctx = canvas.getContext('2d')
      if (!ctx) return
      renderScene(ctx, state, dpr)
    })
    return () => cancelAnimationFrame(raf)
  }, [state])

  /* RDWorks Laser Simulation playback loop */
  useEffect(() => {
    if (!state.sim.playing) return
    let lastTime = performance.now()
    let frameId = 0
    const job = getProductionJob(state.doc)
    const duration = Math.max(0.5, job.totalTime)
    let progress = state.sim.progress

    const tick = (now: number) => {
      const dt = (now - lastTime) / 1000
      lastTime = now
      const speed = state.sim.speed || 2
      const deltaProgress = (dt * speed) / duration
      const nextProgress = progress + deltaProgress
      progress = nextProgress

      if (nextProgress >= 1) {
        const simInfo = getSimulationStateAt(job, 1, { x: state.doc.production.startX, y: state.doc.production.startY })
        store.setSimulation({ playing: false, progress: 1, headPos: simInfo.headPos, laserOn: false })
        return
      }

      const simInfo = getSimulationStateAt(job, nextProgress, { x: state.doc.production.startX, y: state.doc.production.startY })
      store.setSimulation({ progress: nextProgress, headPos: simInfo.headPos, laserOn: simInfo.laserOn })
      frameId = requestAnimationFrame(tick)
    }

    frameId = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(frameId)
  }, [state.sim.playing, state.sim.speed, state.doc, store])

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    canvas.style.cursor = cursorFor(state.tool)
  }, [state.tool])

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.code === 'Space' && !isEditable(e.target)) {
        if (!spaceDown.current) {
          spaceDown.current = true
          if (canvasRef.current) canvasRef.current.style.cursor = 'grab'
        }
        e.preventDefault()
      }
      if (e.key === 'Escape') {
        if (state.draft) { store.setDraft(null); store.setSnap(null); store.setStatus('Draft cancelled') }
      }
      if (e.key === 'Enter') {
        if (state.tool === 'pen' && state.draft?.type === 'pen') { finishPen(false); e.preventDefault() }
      }
      if (e.key === 'Enter' && state.tool === 'knife' && state.draft?.type === 'knife') {
        commitKnife(); e.preventDefault()
      }
    }
    const onKeyUp = (e: KeyboardEvent) => {
      if (e.code === 'Space') {
        spaceDown.current = false
        if (canvasRef.current) canvasRef.current.style.cursor = cursorFor(store.getState().tool)
      }
    }
    window.addEventListener('keydown', onKeyDown)
    window.addEventListener('keyup', onKeyUp)
    return () => { window.removeEventListener('keydown', onKeyDown); window.removeEventListener('keyup', onKeyUp) }
  })

  /* wheel zoom / pan */
  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    const onWheel = (e: WheelEvent) => {
      e.preventDefault()
      const rect = canvas.getBoundingClientRect()
      const p = { x: e.clientX - rect.left, y: e.clientY - rect.top }
      if (e.shiftKey && !e.ctrlKey && !e.metaKey) {
        store.panBy(-e.deltaY - e.deltaX, 0)
        return
      }
      const factor = Math.exp(-e.deltaY * (e.ctrlKey ? 0.01 : 0.0014))
      const curr = store.getState().view.zoom
      store.setZoomAt(curr * factor, p)
    }
    canvas.addEventListener('wheel', onWheel, { passive: false })
    return () => canvas.removeEventListener('wheel', onWheel)
  }, [store])

  /* helpers ------------------------------------------------------- */
  const nearestSegment = (shape: Shape, p: Pt, thresholdWorld: number) => {
    let best: { subpathIndex: number; segmentIndex: number; t: number; point: Pt; midpoint: Pt; distance: number } | null = null
    for (let si = 0; si < shape.subpaths.length; si++) {
      for (const seg of segments(shape.subpaths[si])) {
        const np = nearestPointOnSegment(seg, p, 22)
        if (np.distance < thresholdWorld && (!best || np.distance < best.distance)) {
          best = { subpathIndex: si, segmentIndex: seg.index, t: np.t, point: np.point, midpoint: cubicMidpoint(seg), distance: np.distance }
        }
      }
    }
    return best
  }

  const hitShape = useCallback((p: Pt): Shape | null => {
    const ctx = ctxOf()
    if (!ctx) return null
    ctx.save()
    ctx.setTransform(1, 0, 0, 1, 0, 0)
    const zoom = store.getState().view.zoom
    const shapes = allShapes(store.getState().doc)
    for (let i = shapes.length - 1; i >= 0; i--) {
      const s = shapes[i]
      if (s.locked) continue
      if (s.kind === 'text' && s.text) {
        const b = shapeBounds(s)
        if (p.x >= b.x && p.x <= b.x + b.w && p.y >= b.y && p.y <= b.y + b.h) { ctx.restore(); return s }
        continue
      }
      const path = pathToPath2D(s.subpaths)
      if (s.fill.type !== 'none' && ctx.isPointInPath(path, p.x, p.y, s.fillRule)) { ctx.restore(); return s }
      ctx.lineWidth = Math.max(s.stroke.width, 2.2 / zoom)
      if (ctx.isPointInStroke(path, p.x, p.y)) { ctx.restore(); return s }
    }
    ctx.restore()
    return null
  }, [ctxOf, store])

  const hitHandle = (screen: Pt): string | null => {
    const st = store.getState()
    const shapes = st.selection.map(id => getShape(st.doc, id)).filter((s): s is Shape => !!s)
    if (!shapes.length) return null
    const b = unionBounds(shapes.map(shapeBounds))
    for (const h of selectionHandles(b, st)) {
      if (Math.hypot(h.x - screen.x, h.y - screen.y) <= 7.5) return h.id
    }
    return null
  }

  // Let selected hollow shapes and groups move from their empty interior.
  const insideSelection = (p: Pt): boolean => {
    const shapes = store.getSelectedShapes().filter(s => !s.hidden && !s.locked &&
      store.getState().doc.layers.some(l => l.visible && !l.locked && l.shapes.some(item => item.id === s.id)))
    if (!shapes.length) return false
    const b = unionBounds(shapes.map(shapeBounds))
    return p.x >= b.x && p.x <= b.x + b.w && p.y >= b.y && p.y <= b.y + b.h
  }

  const hitNode = (shape: Shape, screen: Pt): { subpathIndex: number; nodeIndex: number } | null => {
    const st = store.getState()
    let best: { subpathIndex: number; nodeIndex: number; d: number } | null = null
    for (let si = 0; si < shape.subpaths.length; si++) {
      for (let i = 0; i < shape.subpaths[si].nodes.length; i++) {
        const n = shape.subpaths[si].nodes[i]
        const sx = n.x * st.view.zoom + st.view.panX
        const sy = n.y * st.view.zoom + st.view.panY
        const d = Math.hypot(sx - screen.x, sy - screen.y)
        if (d <= 7.5 && (!best || d < best.d)) best = { subpathIndex: si, nodeIndex: i, d }
      }
    }
    return best ? { subpathIndex: best.subpathIndex, nodeIndex: best.nodeIndex } : null
  }

  const hitNodeHandle = (shape: Shape, screen: Pt): { subpathIndex: number; nodeIndex: number; which: 'in' | 'out' } | null => {
    const st = store.getState()
    const sel = st.selectedNode
    if (!sel || sel.shapeId !== shape.id) return null
    const sub = shape.subpaths[sel.subpathIndex]
    const n = sub?.nodes[sel.nodeIndex]
    if (!n) return null
    for (const which of ['in', 'out'] as const) {
      const hp = n[which]
      const sx = hp.x * st.view.zoom + st.view.panX
      const sy = hp.y * st.view.zoom + st.view.panY
      if (Math.hypot(sx - screen.x, sy - screen.y) <= 7) return { subpathIndex: sel.subpathIndex, nodeIndex: sel.nodeIndex, which }
    }
    return null
  }

  const hitGuide = (screen: Pt): { id: string; orientation: 'h' | 'v' } | null => {
    const st = store.getState()
    for (const g of st.doc.guides) {
      if (g.orientation === 'v') {
        const sx = g.position * st.view.zoom + st.view.panX
        if (Math.abs(sx - screen.x) <= 4) return { id: g.id, orientation: 'v' }
      } else {
        const sy = g.position * st.view.zoom + st.view.panY
        if (Math.abs(sy - screen.y) <= 4) return { id: g.id, orientation: 'h' }
      }
    }
    return null
  }

  const snapFor = (p: Pt, exclude: Set<string>): SnapHit | null => {
    const st = store.getState()
    if (!st.doc.snap.enabled) return null
    const candidates = collectStaticCandidates(st.doc, exclude, p, st.doc.snap, st.view.zoom)
    return snapPoint(p, candidates, st.doc.snap.radius / st.view.zoom, st.view.zoom)
  }

  const updateHover = (screen: Pt, world: Pt) => {
    const st = store.getState()
    if (st.tool === 'select') {
      const shape = hitShape(world)
      if (!shape) { if (st.hover) store.setHover(null); return }
      const seg = nearestSegment(shape, world, 8 / st.view.zoom)
      store.setHover({ shapeId: shape.id, showCenter: true, segment: seg ? { shapeId: shape.id, ...seg } : undefined, showMidpoint: !!seg })
    } else if (st.tool === 'node') {
      const shape = st.selection[0] ? getShape(st.doc, st.selection[0]) : undefined
      if (!shape) { if (st.hover) store.setHover(null); return }
      const nh = hitNode(shape, screen)
      const seg = nearestSegment(shape, world, 9 / st.view.zoom)
      store.setHover({ shapeId: shape.id, node: nh ? { shapeId: shape.id, ...nh } : undefined, segment: seg ? { shapeId: shape.id, ...seg } : undefined, showMidpoint: !!seg, showCenter: false })
    } else if (st.hover) store.setHover(null)
  }


  const updateCursor = (screen: Pt, st: EditorState) => {
    const canvas = canvasRef.current
    if (!canvas) return
    let cursor = cursorFor(st.tool)
    if (screen.x < RULER && screen.y > RULER) cursor = 'ew-resize'
    else if (screen.y < RULER && screen.x > RULER) cursor = 'ns-resize'
    else if (st.tool === 'select') {
      const handle = hitHandle(screen)
      if (handle) cursor = handle === 'rotate' ? 'grab' : ({ nw: 'nwse-resize', se: 'nwse-resize', ne: 'nesw-resize', sw: 'nesw-resize', n: 'ns-resize', s: 'ns-resize', e: 'ew-resize', w: 'ew-resize' } as Record<string, string>)[handle] ?? cursor
      else if (hitGuide(screen) && !hitShape(store.screenToWorld(screen.x, screen.y))) cursor = 'grab'
      else if (hitShape(store.screenToWorld(screen.x, screen.y)) || insideSelection(store.screenToWorld(screen.x, screen.y))) cursor = 'move'
    } else if (st.tool === 'node') {
      const shape = st.selection[0] ? getShape(st.doc, st.selection[0]) : undefined
      if (shape) {
        if (hitNodeHandle(shape, screen)) cursor = 'crosshair'
        else if (hitNode(shape, screen)) cursor = 'grab'
        else if (nearestSegment(shape, store.screenToWorld(screen.x, screen.y), 8 / st.view.zoom)) cursor = 'move'
      }
    }
    canvas.style.cursor = cursor
  }

  /* pointer down -------------------------------------------------- */
  const onPointerDown = (e: React.PointerEvent<HTMLCanvasElement>) => {
    if (e.button === 2) return
    const canvas = canvasRef.current!
    const rect = canvas.getBoundingClientRect()
    const screen = { x: e.clientX - rect.left, y: e.clientY - rect.top }
    const st = store.getState()
    const world = store.screenToWorld(screen.x, screen.y)

    if (e.button === 1 || spaceDown.current || st.tool === 'hand') {
      action.current = { type: 'pan', last: screen, pointerId: e.pointerId }
      canvas.setPointerCapture(e.pointerId)
      canvas.style.cursor = 'grabbing'
      return
    }

    // rulers / guides
    if (screen.x > RULER && screen.y < RULER) {
      const guide = { id: uid('guide'), orientation: 'h' as const, position: world.y, color: '#2b59ff' }
      store.setDraft({ type: 'guide', guide })
      action.current = { type: 'new-guide', orientation: 'h', pointerId: e.pointerId }
      canvas.setPointerCapture(e.pointerId)
      return
    }
    if (screen.y > RULER && screen.x < RULER) {
      const guide = { id: uid('guide'), orientation: 'v' as const, position: world.x, color: '#2b59ff' }
      store.setDraft({ type: 'guide', guide })
      action.current = { type: 'new-guide', orientation: 'v', pointerId: e.pointerId }
      canvas.setPointerCapture(e.pointerId)
      return
    }
    if (screen.x < RULER || screen.y < RULER) return

    if (st.tool === 'zoom') {
      store.zoomBy(e.altKey ? 1 / 1.5 : 1.5, screen)
      return
    }

    if (st.tool === 'text') {
      const shape = store.createTextAt(world)
      store.setTool('select')
      store.setRightTab('design')
      store.setSelection([shape.id])
      store.toast('Text created — type in the Design panel', 'info')
      return
    }

    if (st.tool === 'select') {
      const g = hitGuide(screen)
      if (g && !hitShape(world)) {
        action.current = { type: 'move-guide', id: g.id, orientation: g.orientation, pointerId: e.pointerId }
        canvas.setPointerCapture(e.pointerId)
        return
      }
      const handle = hitHandle(screen)
      const shapes = st.selection.map(id => getShape(st.doc, id)).filter((s): s is Shape => !!s)
      if (handle && shapes.length) {
        const b = unionBounds(shapes.map(shapeBounds))
        if (handle === 'rotate') {
          const c = boundsCenter(b)
          action.current = { type: 'rotate', base: shapes.map(cloneShapeDeep), center: c, startAngle: Math.atan2(world.y - c.y, world.x - c.x), pointerId: e.pointerId, started: false }
        } else {
          action.current = { type: 'resize', handle, base: shapes.map(cloneShapeDeep), bounds: b, start: world, pointerId: e.pointerId, started: false }
        }
        canvas.setPointerCapture(e.pointerId)
        return
      }
      const hit = hitShape(world)
      if (hit || (!e.shiftKey && insideSelection(world))) {
        if (e.shiftKey) {
          store.setSelection([hit!.id], true, true)
          return
        }
        if (hit && !st.selection.includes(hit.id)) store.setSelection([hit.id])
        const picked = store.getSelectedShapes()
        action.current = { type: 'move', base: picked.map(cloneShapeDeep), bounds: unionBounds(picked.map(shapeBounds)), start: world, pointerId: e.pointerId, started: false }
        canvas.setPointerCapture(e.pointerId)
        canvas.style.cursor = 'grabbing'
        return
      }
      if (!e.shiftKey) store.clearSelection()
      const b = { x: world.x, y: world.y, w: 0, h: 0 }
      store.setDraft({ type: 'marquee', bounds: b })
      action.current = { type: 'marquee', start: world, additive: e.shiftKey, pointerId: e.pointerId, moved: false }
      canvas.setPointerCapture(e.pointerId)
      return
    }

    if (st.tool === 'node') {
      const selectedShape = st.selection[0] ? getShape(st.doc, st.selection[0]) : undefined
      if (selectedShape) {
        const hh = hitNodeHandle(selectedShape, screen)
        if (hh) {
          action.current = { type: 'handle', sel: { shapeId: selectedShape.id, subpathIndex: hh.subpathIndex, nodeIndex: hh.nodeIndex }, which: hh.which, pointerId: e.pointerId, started: false }
          canvas.setPointerCapture(e.pointerId)
          return
        }
        const nh = hitNode(selectedShape, screen)
        if (nh) {
          const sel = { shapeId: selectedShape.id, ...nh }
          store.setSelectedNode(sel)
          action.current = { type: 'node', sel, pointerId: e.pointerId, started: false }
          canvas.setPointerCapture(e.pointerId)
          return
        }
        const seg = nearestSegment(selectedShape, world, 8 / st.view.zoom)
        if (seg) {
          action.current = { type: 'segment', shapeId: selectedShape.id, subpathIndex: seg.subpathIndex, segmentIndex: seg.segmentIndex, last: world, pointerId: e.pointerId, started: false }
          canvas.setPointerCapture(e.pointerId)
          return
        }
      }
      const hit = hitShape(world)
      if (hit) {
        store.setSelection([hit.id])
        const nh = hitNode(hit, screen)
        if (nh) store.setSelectedNode({ shapeId: hit.id, ...nh })
        else store.setSelectedNode(null)
      } else {
        store.setSelectedNode(null)
      }
      return
    }

    if (st.tool === 'pen') {
      const d = st.draft
      if (d?.type === 'pen' && d.subpath.nodes.length >= 2) {
        const first = d.subpath.nodes[0]
        const fs = store.worldToScreen({ x: first.x, y: first.y })
        if (Math.hypot(fs.x - screen.x, fs.y - screen.y) <= 9) {
          finishPen(true)
          return
        }
      }
      const snapped = snapFor(world, new Set())
      const p = snapped ? { x: snapped.x, y: snapped.y } : world
      store.setSnap(snapped, [])
      if (!d || d.type !== 'pen') {
        const node = { id: uid('n'), x: p.x, y: p.y, in: { ...p }, out: { ...p }, type: 'cusp' as const }
        store.setDraft({ type: 'pen', subpath: { id: uid('sp'), closed: false, nodes: [node] }, cursor: p, closeHint: false })
        action.current = { type: 'penhandle', nodeIndex: 0, pointerId: e.pointerId, started: false }
      } else {
        const sub = cloneSubpathLocal(d.subpath)
        const prev = sub.nodes[sub.nodes.length - 1]
        const node = { id: uid('n'), x: p.x, y: p.y, in: { ...p }, out: { ...p }, type: state.penType === 'smooth' ? 'smooth' as const : 'cusp' as const }
        if (state.penType === 'smooth') {
          const v = sub2(p, { x: prev.x, y: prev.y })
          const l = Math.hypot(v.x, v.y)
          if (l > 0.5) {
            prev.out = { x: prev.x + v.x / 3, y: prev.y + v.y / 3 }
            node.in = { x: node.x - v.x / 3, y: node.y - v.y / 3 }
            node.out = { x: node.x + v.x / 3, y: node.y + v.y / 3 }
          }
        }
        sub.nodes.push(node)
        store.setDraft({ type: 'pen', subpath: sub, cursor: p, closeHint: false })
        action.current = { type: 'penhandle', nodeIndex: sub.nodes.length - 1, pointerId: e.pointerId, started: false }
      }
      canvas.setPointerCapture(e.pointerId)
      return
    }

    if (st.tool === 'knife') {
      const snapped = snapFor(world, new Set())
      const p = snapped ? { x: snapped.x, y: snapped.y } : world
      store.setSnap(snapped, [])
      if (st.knife.mode === 'line') {
        store.setDraft({ type: 'knife', mode: 'line', anchors: [p], cursor: p, drawing: true })
        action.current = { type: 'knife-line', start: p, pointerId: e.pointerId }
      } else if (st.knife.mode === 'freehand') {
        store.setDraft({ type: 'knife', mode: 'freehand', anchors: [p], cursor: p, drawing: true })
        action.current = { type: 'knife-free', pointerId: e.pointerId }
      } else {
        const d = st.draft
        if (!d || d.type !== 'knife' || d.mode !== 'bezier') {
          store.setDraft({ type: 'knife', mode: 'bezier', anchors: [p], cursor: p, drawing: false })
        } else {
          const last = d.anchors[d.anchors.length - 1]
          if (dist(last, p) > 0.3) store.setDraft({ ...d, anchors: [...d.anchors, p], cursor: p })
        }
        action.current = { type: 'bezier', pointerId: e.pointerId }
      }
      canvas.setPointerCapture(e.pointerId)
      return
    }

    if (st.tool === 'rect' || st.tool === 'ellipse' || st.tool === 'line' || st.tool === 'polygon') {
      const snapped = snapFor(world, new Set())
      const p = snapped ? { x: snapped.x, y: snapped.y } : world
      store.setSnap(snapped, [])
      store.setDraft({ type: 'shape', kind: st.tool, start: p, current: p, shift: e.shiftKey })
      action.current = { type: 'draw', kind: st.tool, start: p, pointerId: e.pointerId }
      canvas.setPointerCapture(e.pointerId)
    }
  }

  /* pointer move -------------------------------------------------- */
  const onPointerMove = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const canvas = canvasRef.current!
    const rect = canvas.getBoundingClientRect()
    const screen = { x: e.clientX - rect.left, y: e.clientY - rect.top }
    const st = store.getState()
    const world = store.screenToWorld(screen.x, screen.y)
    store.setPointer(world)
    const a = action.current

    if (!a) {
      if (e.buttons === 0) updateHover(screen, world)
      updateCursor(screen, st)
      return
    }

    if (a.type === 'pan') {
      store.panBy(screen.x - a.last.x, screen.y - a.last.y)
      a.last = screen
      return
    }

    if (a.type === 'new-guide') {
      const d = st.draft
      if (d?.type === 'guide') {
        const guide = { ...d.guide, position: a.orientation === 'v' ? world.x : world.y }
        store.setDraft({ type: 'guide', guide })
      }
      return
    }

    if (a.type === 'move-guide') {
      store.updateGuide(a.id, a.orientation === 'v' ? world.x : world.y)
      return
    }

    if (a.type === 'marquee') {
      const b = normRect(a.start, world)
      a.moved = b.w * st.view.zoom > 2 || b.h * st.view.zoom > 2
      store.setDraft({ type: 'marquee', bounds: b })
      return
    }

    if (a.type === 'draw') {
      let p = world
      const hit = snapFor(world, new Set())
      if (hit) p = { x: hit.x, y: hit.y }
      store.setSnap(hit, [])
      if (e.shiftKey) {
        const dx = p.x - a.start.x, dy = p.y - a.start.y
        if (a.kind === 'line') {
          if (Math.abs(dx) > Math.abs(dy)) p = { x: p.x, y: a.start.y }
          else p = { x: a.start.x, y: p.y }
        } else {
          const s = Math.max(Math.abs(dx), Math.abs(dy))
          p = { x: a.start.x + Math.sign(dx || 1) * s, y: a.start.y + Math.sign(dy || 1) * s }
        }
      }
      store.setDraft({ type: 'shape', kind: a.kind, start: a.start, current: p, shift: e.shiftKey })
      return
    }

    if (a.type === 'move') {
      if (!a.started) {
        if (Math.hypot(screen.x - (a.start.x * st.view.zoom + st.view.panX), screen.y - (a.start.y * st.view.zoom + st.view.panY)) < 3) return
        a.started = true
        store.pushHistory('Move')
      }
      let dx = world.x - a.start.x
      let dy = world.y - a.start.y
      if (e.shiftKey) {
        if (Math.abs(dx) > Math.abs(dy)) dy = 0
        else dx = 0
      }
      const snapped = moveSnap(st, a.base, a.bounds, dx, dy, new Set(st.selection), world)
      dx += snapped.dx
      dy += snapped.dy
      store.setSnap(snapped.hit, snapped.rays)
      store.applyTranslation(a.base, dx, dy)
      store.setStatus(`Move · ${fmt(dx)}, ${fmt(dy)} mm${snapped.label ? ` · ${snapped.label}` : ''}`)
      return
    }

    if (a.type === 'resize') {
      if (!a.started) { a.started = true; store.pushHistory('Resize') }
      const b = a.bounds
      const west = a.handle.includes('w'), east = a.handle.includes('e')
      const north = a.handle.includes('n'), south = a.handle.includes('s')
      const pivot = {
        x: west ? b.x + b.w : east ? b.x : b.x + b.w / 2,
        y: north ? b.y + b.h : south ? b.y : b.y + b.h / 2,
      }
      let mx = world.x, my = world.y
      const hit = snapFor(world, new Set(st.selection))
      if (hit) { mx = hit.x; my = hit.y }
      store.setSnap(hit, [])
      let sx = west ? (pivot.x - mx) / (b.w || 1e-4) : east ? (mx - pivot.x) / (b.w || 1e-4) : 1
      let sy = north ? (pivot.y - my) / (b.h || 1e-4) : south ? (my - pivot.y) / (b.h || 1e-4) : 1
      sx = clamp(sx, 0.02, 80); sy = clamp(sy, 0.02, 80)
      if (e.shiftKey && (west || east) && (north || south)) sx = sy = Math.max(sx, sy)
      store.applyScale(a.base, pivot, sx, sy)
      store.setStatus(`Scale · ${Math.round(sx * 100)}% × ${Math.round(sy * 100)}%`)
      return
    }

    if (a.type === 'rotate') {
      if (!a.started) { a.started = true; store.pushHistory('Rotate') }
      let angle = Math.atan2(world.y - a.center.y, world.x - a.center.x) - a.startAngle
      if (e.shiftKey) angle = Math.round(angle / (Math.PI / 12)) * (Math.PI / 12)
      store.applyRotation(a.base, a.center, angle)
      store.setStatus(`Rotate · ${Math.round((angle * 180) / Math.PI)}°`)
      return
    }

    if (a.type === 'node') {
      const hit = snapFor(world, new Set([a.sel.shapeId]))
      const p = hit ? { x: hit.x, y: hit.y } : world
      if (!a.started) { a.started = true; store.pushHistory('Move node') }
      store.setSnap(hit, [])
      store.moveNodeTo(a.sel, p)
      return
    }

    if (a.type === 'handle') {
      if (!a.started) { a.started = true; store.pushHistory('Edit handle') }
      const hit = snapFor(world, new Set([a.sel.shapeId]))
      const p = hit ? { x: hit.x, y: hit.y } : world
      store.setSnap(hit, [])
      store.setNodeHandle(a.sel, a.which, p)
      return
    }

    if (a.type === 'segment') {
      if (!a.started) { a.started = true; store.pushHistory('Shape curve') }
      const delta = sub(world, a.last)
      a.last = world
      store.dragSegment(a.shapeId, a.subpathIndex, a.segmentIndex, delta)
      return
    }

    if (a.type === 'penhandle') {
      if (!a.started) a.started = true
      const d = store.getState().draft
      if (d?.type === 'pen') {
        const sub = cloneSubpathLocal(d.subpath)
        const node = sub.nodes[a.nodeIndex]
        if (!node) return
        const v = sub2({ x: node.x, y: node.y }, world)
        const l = Math.hypot(v.x, v.y)
        if (l > 0.6) {
          node.type = 'symmetric'
          node.out = { ...world }
          node.in = { x: node.x - v.x, y: node.y - v.y }
          store.setDraft({ type: 'pen', subpath: sub, cursor: world, closeHint: false })
        }
      }
      return
    }

    if (a.type === 'knife-line') {
      const hit = snapFor(world, new Set())
      const p = hit ? { x: hit.x, y: hit.y } : world
      store.setSnap(hit, [])
      store.setDraft({ type: 'knife', mode: 'line', anchors: [a.start, p], cursor: p, drawing: true })
      return
    }

    if (a.type === 'knife-free') {
      const d = st.draft
      if (d?.type === 'knife') {
        const last = d.anchors[d.anchors.length - 1]
        if (dist(last, world) * st.view.zoom > 1.8) {
          store.setDraft({ ...d, anchors: [...d.anchors, world], cursor: world })
        } else {
          store.setDraft({ ...d, cursor: world })
        }
      }
      return
    }

    if (a.type === 'bezier') {
      const d = st.draft
      if (d?.type === 'knife') store.setDraft({ ...d, cursor: world })
      return
    }
  }

  /* pointer up ---------------------------------------------------- */
  const onPointerUp = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const canvas = canvasRef.current!
    const rect = canvas.getBoundingClientRect()
    const screen = { x: e.clientX - rect.left, y: e.clientY - rect.top }
    const st = store.getState()
    const world = store.screenToWorld(screen.x, screen.y)
    const a = action.current
    try { canvas.releasePointerCapture(e.pointerId) } catch { /* noop */ }
    canvas.style.cursor = cursorFor(st.tool)
    action.current = null

    if (!a) return

    if (a.type === 'pan') { store.setStatus('Ready'); return }

    if (a.type === 'new-guide') {
      if (screen.x > RULER && screen.y > RULER) {
        const position = a.orientation === 'v' ? Math.round(world.x * 10) / 10 : Math.round(world.y * 10) / 10
        store.addGuide(a.orientation, position)
        store.toast(`${a.orientation === 'v' ? 'Vertical' : 'Horizontal'} guide at ${position} mm`, 'info')
      }
      store.setDraft(null)
      return
    }

    if (a.type === 'move-guide') {
      const onRuler = a.orientation === 'v' ? screen.x < RULER : screen.y < RULER
      if (onRuler) { store.removeGuide(a.id); store.toast('Guide removed', 'info') }
      else store.setStatus('Guide moved')
      store.setDraft(null)
      return
    }

    if (a.type === 'marquee') {
      if (!a.moved) {
        if (!a.additive) store.clearSelection()
      } else {
        const b = normRect(a.start, world)
        const hits = allShapes(st.doc).filter(s => !s.locked && !s.hidden && rectsIntersect(b, shapeBounds(s))).map(s => s.id)
        store.setSelection(hits, a.additive)
      }
      store.setDraft(null)
      return
    }

    if (a.type === 'draw') {
      const d = st.draft
      if (d?.type === 'shape') {
        const b = normRect(d.start, d.current)
        const size = Math.max(b.w, b.h)
        if (size > 0.6) {
          let shape: Shape
          if (a.kind === 'rect') {
            shape = makeShape('rect', [{ id: uid('sp'), closed: true, nodes: [
              { id: uid('n'), x: b.x, y: b.y, in: { x: b.x, y: b.y }, out: { x: b.x, y: b.y }, type: 'cusp' },
              { id: uid('n'), x: b.x + b.w, y: b.y, in: { x: b.x + b.w, y: b.y }, out: { x: b.x + b.w, y: b.y }, type: 'cusp' },
              { id: uid('n'), x: b.x + b.w, y: b.y + b.h, in: { x: b.x + b.w, y: b.y + b.h }, out: { x: b.x + b.w, y: b.y + b.h }, type: 'cusp' },
              { id: uid('n'), x: b.x, y: b.y + b.h, in: { x: b.x, y: b.y + b.h }, out: { x: b.x, y: b.y + b.h }, type: 'cusp' },
            ] }], { name: 'Rectangle', fill: makeFill({ type: 'none' }), stroke: makeStroke({ enabled: true, color: '#000000', width: 1 }) })
          } else if (a.kind === 'ellipse') {
            shape = ellipseShape(b)
          } else if (a.kind === 'line') {
            shape = makeShape('line', [{ id: uid('sp'), closed: false, nodes: [
              { id: uid('n'), x: d.start.x, y: d.start.y, in: { ...d.start }, out: { ...d.start }, type: 'cusp' },
              { id: uid('n'), x: d.current.x, y: d.current.y, in: { ...d.current }, out: { ...d.current }, type: 'cusp' },
            ] }], { name: 'Line', fill: makeFill({ type: 'none' }), stroke: makeStroke({ enabled: true, color: '#000000', width: 1 }) })
          } else {
            shape = polygonShape(b)
          }
          store.addShape(shape)
          store.toast(`${shape.name} added`, 'success')
          store.setTool('select')
          store.setStatus(`${shape.name} added · ${fmt(shapeBounds(shape).w)} × ${fmt(shapeBounds(shape).h)} mm`)
        }
      }
      store.setDraft(null)
      store.setSnap(null)
      return
    }

    if (a.type === 'move' || a.type === 'resize' || a.type === 'rotate' || a.type === 'node' || a.type === 'handle' || a.type === 'segment') {
      store.setSnap(null, [])
      const sel = store.getState().selection
      if (sel.length === 1) {
        const shape = getShape(store.getState().doc, sel[0])
        if (shape) {
          const b = shapeBounds(shape)
          store.setStatus(`${shape.name} · ${fmt(b.w)} × ${fmt(b.h)} mm · center ${fmt(b.x + b.w / 2)}, ${fmt(b.y + b.h / 2)}`)
        }
      }
      return
    }

    if (a.type === 'knife-line') {
      const d = st.draft
      if (d?.type === 'knife' && d.anchors.length >= 2 && dist(d.anchors[0], d.anchors[1]) > 1) commitKnife()
      else { store.setDraft(null); store.setSnap(null) }
      return
    }

    if (a.type === 'knife-free') {
      const d = store.getState().draft
      if (d?.type === 'knife' && d.anchors.length >= 2) commitKnife()
      else { store.setDraft(null); store.setSnap(null) }
      return
    }

    if (a.type === 'bezier') {
      return
    }
  }

  const commitKnife = () => {
    const st = store.getState()
    const d = st.draft
    if (d?.type !== 'knife') return
    const pts = d.mode === 'bezier' ? smoothCutPath(d.anchors) : d.anchors
    if (pts.length < 2) { store.setDraft(null); return }
    store.commitCut(pts)
    store.setSnap(null, [])
  }

  const finishPen = (closed: boolean) => {
    const d = store.getState().draft
    if (d?.type !== 'pen') return
    if (d.subpath.nodes.length < 2) {
      store.setDraft(null)
      store.setSnap(null)
      return
    }
    const sub = cloneSubpathLocal(d.subpath)
    sub.closed = closed
    const shape = makeShape('path', [sub], {
      name: 'Pen Path',
      fill: makeFill({ type: 'none' }),
      stroke: makeStroke({ enabled: true, color: '#000000', width: 1 }),
    })
    store.addShape(shape)
    store.setDraft(null)
    store.setSnap(null)
    store.setStatus(`Pen path · ${sub.nodes.length} nodes${closed ? ' · closed' : ''}`)
    store.toast(closed ? 'Closed path created' : 'Open path created', 'success')
  }

  /* double click -------------------------------------------------- */
  const onDoubleClick = (e: React.MouseEvent<HTMLCanvasElement>) => {
    const canvas = canvasRef.current!
    const rect = canvas.getBoundingClientRect()
    const screen = { x: e.clientX - rect.left, y: e.clientY - rect.top }
    const st = store.getState()
    const world = store.screenToWorld(screen.x, screen.y)
    if (st.tool === 'knife' && st.draft?.type === 'knife' && st.draft.mode === 'bezier') {
      commitKnife()
      return
    }
    if (st.tool === 'select') {
      const hit = hitShape(world)
      if (hit) {
        store.setTool('node')
        store.setSelection([hit.id])
        store.setRightTab('design')
        return
      }
    }
    if (st.tool === 'node') {
      const shape = st.selection[0] ? getShape(st.doc, st.selection[0]) : undefined
      if (!shape) return
      const seg = nearestSegment(shape, world, 12 / st.view.zoom)
      if (seg) {
        store.insertNodeAt(shape.id, seg.subpathIndex, seg.segmentIndex, seg.t)
        store.toast(seg.t > 0.45 && seg.t < 0.55 ? 'Node inserted at midpoint' : 'Node inserted on curve', 'success')
      }
    }
    lastClick.current = { time: Date.now(), x: screen.x, y: screen.y }
  }

  const onContextMenu = (e: React.MouseEvent) => {
    e.preventDefault()
    const st = store.getState()
    if (st.tool === 'pen' && st.draft?.type === 'pen') finishPen(false)
    else if (st.tool === 'knife' && st.draft?.type === 'knife') {
      if (st.draft.mode === 'bezier') commitKnife()
      else store.setDraft(null)
    }
  }

  const onPointerLeave = () => {
    if (action.current) return
    store.setPointer(null)
    if (store.getState().hover) store.setHover(null)
    store.setSnap(null, [])
  }

  return (
    <div className="canvas-wrap" ref={wrapRef}>
      <canvas
        ref={canvasRef}
        className="stage-canvas"
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
        onPointerLeave={onPointerLeave}
        onDoubleClick={onDoubleClick}
        onContextMenu={onContextMenu}
      />
    </div>
  )
}

/* helpers --------------------------------------------------------- */
function cursorFor(tool: Tool): string {
  switch (tool) {
    case 'select': return 'default'
    case 'node': return 'default'
    case 'pen': return 'crosshair'
    case 'knife': return 'crosshair'
    case 'rect': case 'ellipse': case 'polygon': case 'line': return 'crosshair'
    case 'text': return 'text'
    case 'hand': return 'grab'
    case 'zoom': return 'zoom-in'
    default: return 'default'
  }
}
function isEditable(target: EventTarget | null): boolean {
  const el = target as HTMLElement | null
  if (!el) return false
  return el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.isContentEditable || el.tagName === 'SELECT'
}
function cloneShapeDeep(s: Shape): Shape {
  return {
    ...s,
    subpaths: cloneSubpaths(s.subpaths),
    fill: { ...s.fill, stops: s.fill.stops.map(st => ({ ...st })) },
    stroke: { ...s.stroke, dash: [...s.stroke.dash] },
    shadow: { ...s.shadow },
    text: s.text ? { ...s.text, box: { ...s.text.box } } : undefined,
    clip: s.clip ? cloneSubpaths(s.clip) : undefined,
  }
}
function cloneSubpathLocal(s: SubpathLocal): SubpathLocal {
  return { id: s.id, closed: s.closed, nodes: s.nodes.map(n => ({ ...n, in: { ...n.in }, out: { ...n.out } })) }
}
type SubpathLocal = EditorState['doc']['layers'][number]['shapes'][number]['subpaths'][number]
function sub2(a: Pt, b: Pt): Pt { return { x: a.x - b.x, y: a.y - b.y } }
function fmt(n: number): string { return (Math.round(n * 10) / 10).toFixed(1) }
function normRect(a: Pt, b: Pt): Bounds { return { x: Math.min(a.x, b.x), y: Math.min(a.y, b.y), w: Math.abs(a.x - b.x), h: Math.abs(a.y - b.y) } }
function unionBounds(bs: Bounds[]): Bounds {
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity
  for (const b of bs) { minX = Math.min(minX, b.x); minY = Math.min(minY, b.y); maxX = Math.max(maxX, b.x + b.w); maxY = Math.max(maxY, b.y + b.h) }
  return { x: minX, y: minY, w: maxX - minX, h: maxY - minY }
}
function rectsIntersect(a: Bounds, b: Bounds): boolean {
  return a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y
}

function ellipseShape(b: Bounds): Shape {
  const cx = b.x + b.w / 2, cy = b.y + b.h / 2, rx = b.w / 2, ry = b.h / 2, k = 0.5522847498307936
  const ox = rx * k, oy = ry * k
  return makeShape('ellipse', [{ id: uid('sp'), closed: true, nodes: [
    { id: uid('n'), x: cx, y: cy - ry, in: { x: cx - ox, y: cy - ry }, out: { x: cx + ox, y: cy - ry }, type: 'smooth' },
    { id: uid('n'), x: cx + rx, y: cy, in: { x: cx + rx, y: cy - oy }, out: { x: cx + rx, y: cy + oy }, type: 'smooth' },
    { id: uid('n'), x: cx, y: cy + ry, in: { x: cx + ox, y: cy + ry }, out: { x: cx - ox, y: cy + ry }, type: 'smooth' },
    { id: uid('n'), x: cx - rx, y: cy, in: { x: cx - rx, y: cy + oy }, out: { x: cx - rx, y: cy - oy }, type: 'smooth' },
  ] }], { name: 'Ellipse', fill: makeFill({ type: 'none' }), stroke: makeStroke({ enabled: true, color: '#000000', width: 1 }) })
}

function polygonShape(b: Bounds): Shape {
  const cx = b.x + b.w / 2, cy = b.y + b.h / 2, rx = b.w / 2, ry = b.h / 2
  const count = 6
  const nodes = []
  for (let i = 0; i < count; i++) {
    const a = -Math.PI / 2 + (i / count) * Math.PI * 2
    const x = cx + Math.cos(a) * rx, y = cy + Math.sin(a) * ry
    nodes.push({ id: uid('n'), x, y, in: { x, y }, out: { x, y }, type: 'cusp' as const })
  }
  return makeShape('polygon', [{ id: uid('sp'), closed: true, nodes }], { name: 'Polygon', fill: makeFill({ type: 'none' }), stroke: makeStroke({ enabled: true, color: '#000000', width: 1 }) })
}

interface MoveSnap { dx: number; dy: number; hit: SnapHit | null; rays: SnapRay[]; label?: string }
function moveSnap(st: EditorState, base: Shape[], baseBounds: Bounds, dx: number, dy: number, exclude: Set<string>, pointer: Pt): MoveSnap {
  const settings = st.doc.snap
  if (!settings.enabled) return { dx: 0, dy: 0, hit: null, rays: [] }
  const radius = settings.radius / st.view.zoom
  const bounds: Bounds = { x: baseBounds.x + dx, y: baseBounds.y + dy, w: baseBounds.w, h: baseBounds.h }
  const others = allShapes(st.doc).filter(s => !exclude.has(s.id) && !s.locked)
  const align = alignmentSnap(bounds, others, radius, settings.dynamicGuides, st.doc.page)
  const candidates = collectStaticCandidates(st.doc, exclude, pointer, { ...settings, grid: false, perpendicular: false, tangent: false }, st.view.zoom)
  const refs = [
    { x: bounds.x, y: bounds.y }, { x: bounds.x + bounds.w / 2, y: bounds.y }, { x: bounds.x + bounds.w, y: bounds.y },
    { x: bounds.x, y: bounds.y + bounds.h / 2 }, { x: bounds.x + bounds.w, y: bounds.y + bounds.h / 2 },
    { x: bounds.x, y: bounds.y + bounds.h }, { x: bounds.x + bounds.w / 2, y: bounds.y + bounds.h }, { x: bounds.x + bounds.w, y: bounds.y + bounds.h },
    { x: bounds.x + bounds.w / 2, y: bounds.y + bounds.h / 2 },
  ]
  let pointHit: SnapHit | null = null
  let pdx = 0, pdy = 0
  for (const ref of refs) {
    const h = snapPoint(ref, candidates, radius, st.view.zoom)
    if (h) {
      const cx = h.x - ref.x, cy = h.y - ref.y
      if (!pointHit || Math.hypot(cx, cy) < Math.hypot(pdx, pdy)) { pointHit = h; pdx = cx; pdy = cy }
    }
  }
  // grid line alignment for each moving boundary/center
  let gdx = 0, gdy = 0
  if (settings.grid) {
    const gs = Math.max(0.1, st.doc.grid.size / Math.max(1, st.doc.grid.subdivisions))
    let bestX = Infinity, bestY = Infinity
    for (const ref of refs) {
      const nx = Math.round(ref.x / gs) * gs, ny = Math.round(ref.y / gs) * gs
      if (Math.abs(nx - ref.x) < Math.abs(bestX) && Math.abs(nx - ref.x) <= radius) bestX = nx - ref.x
      if (Math.abs(ny - ref.y) < Math.abs(bestY) && Math.abs(ny - ref.y) <= radius) bestY = ny - ref.y
    }
    if (Number.isFinite(bestX)) gdx = bestX
    if (Number.isFinite(bestY)) gdy = bestY
  }
  const hasAlignX = align.rays.some(r => r.axis === 'x')
  const hasAlignY = align.rays.some(r => r.axis === 'y')
  const chooseX = pickCorrection([
    { v: align.dx, source: 'align' as const, applies: hasAlignX },
    { v: pdx, source: 'point' as const, applies: !!pointHit && !hasAlignX },
    { v: gdx, source: 'grid' as const, applies: settings.grid && !hasAlignX },
  ])
  const chooseY = pickCorrection([
    { v: align.dy, source: 'align' as const, applies: hasAlignY },
    { v: pdy, source: 'point' as const, applies: !!pointHit && !hasAlignY },
    { v: gdy, source: 'grid' as const, applies: settings.grid && !hasAlignY },
  ])
  const rays: SnapRay[] = []
  if (chooseX) {
    if (chooseX.source === 'align') { const r = align.rays.find(r => r.axis === 'x'); if (r) rays.push(r) }
    else rays.push({ axis: 'x', position: bounds.x + chooseX.v, color: '#5b9fff', label: chooseX.source === 'grid' ? 'grid' : 'object' })
  }
  if (chooseY) {
    if (chooseY.source === 'align') { const r = align.rays.find(r => r.axis === 'y'); if (r) rays.push(r) }
    else rays.push({ axis: 'y', position: bounds.y + chooseY.v, color: '#ff9a52', label: chooseY.source === 'grid' ? 'grid' : 'object' })
  }
  return {
    dx: chooseX?.v ?? 0,
    dy: chooseY?.v ?? 0,
    hit: pointHit,
    rays,
    label: align.label,
  }
}
function pickCorrection(entries: { v: number; source: 'align' | 'point' | 'grid'; applies: boolean }[]): { v: number; source: 'align' | 'point' | 'grid' } | null {
  let best: { v: number; source: 'align' | 'point' | 'grid' } | null = null
  for (const e of entries) {
    if (!e.applies) continue
    if (!best || Math.abs(e.v) < Math.abs(best.v)) best = { v: e.v, source: e.source }
  }
  return best
}
