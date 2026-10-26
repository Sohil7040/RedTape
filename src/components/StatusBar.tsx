import { CornerDownLeft, Magnet, MousePointer2, MoveRight, Ruler, Spline, Zap } from 'lucide-react'
import { EditorState, EditorStore } from '../core/store'
import { SNAP_LABELS } from '../core/geometry'

interface Props { state: EditorState; store: EditorStore }

export default function StatusBar({ state, store }: Props) {
  const p = state.pointer
  const zoomPct = Math.round((state.view.zoom / (96 / 25.4)) * 100)
  const nodes = state.selection.reduce((n, id) => {
    const s = store.getSelectedShapes().find(s => s.id === id)
    return n + (s ? s.subpaths.reduce((m, sp) => m + sp.nodes.length, 0) : 0)
  }, 0)
  return (
    <footer className="statusbar">
      <div className="status-left">
        <span className={`status-live ${state.doc.snap.enabled ? 'on' : ''}`}><i />{state.doc.snap.enabled ? 'SNAP RUNNING' : 'SNAP PAUSED'}</span>
        <span className="status-div" />
        <span className="status-item"><MousePointer2 size={11} />{state.tool.toUpperCase()}</span>
        <span className="status-item"><Spline size={11} />{state.selection.length ? `${state.selection.length} OBJ · ${nodes} NODES` : 'NO SELECTION'}</span>
        {state.doc.production.preview && <span className="status-laser"><Zap size={11} />LASER PREVIEW</span>}
        {state.snapHit && <span className="status-snap"><Magnet size={11} />{SNAP_LABELS[state.snapHit.kind].toUpperCase()}</span>}
        <span className="status-msg">{state.status}</span>
      </div>
      <div className="status-right">
        <span className="status-coord"><span>X</span>{(p?.x ?? 0).toFixed(1)}<span>Y</span>{(p?.y ?? 0).toFixed(1)}<em>mm</em></span>
        <span className="status-item"><Ruler size={11} />{state.doc.page.width} × {state.doc.page.height}</span>
        <span className="status-item"><MoveRight size={11} />{state.doc.guides.length} GUIDES</span>
        <button className="status-zoom" onClick={() => store.fitPage()}>{zoomPct}%</button>
        <span className="status-hint"><CornerDownLeft size={10} />ENTER commit · ESC cancel</span>
      </div>
    </footer>
  )
}
