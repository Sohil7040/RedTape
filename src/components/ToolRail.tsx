import { useEffect, useRef, useState } from 'react'
import {
  Circle, Hand, Hexagon, Magnet, MousePointer2, PenTool, Scissors, Slash, Spline, Square, Type, ZoomIn,
  Grid3X3, PanelLeft,
} from 'lucide-react'
import { EditorState, EditorStore } from '../core/store'
import { PALETTE } from '../core/model'
import { Tool } from '../core/model'
import { Kbd } from './ui'

interface Props { state: EditorState; store: EditorStore }

const tools: { id: Tool; label: string; shortcut: string; icon: typeof MousePointer2; group: number }[] = [
  { id: 'select', label: 'Select', shortcut: 'V', icon: MousePointer2, group: 0 },
  { id: 'node', label: 'Shape / Nodes', shortcut: 'F10', icon: Spline, group: 0 },
  { id: 'pen', label: 'Pen', shortcut: 'P', icon: PenTool, group: 1 },
  { id: 'knife', label: 'Knife', shortcut: 'K', icon: Scissors, group: 1 },
  { id: 'rect', label: 'Rectangle', shortcut: 'R', icon: Square, group: 1 },
  { id: 'ellipse', label: 'Ellipse', shortcut: 'E', icon: Circle, group: 1 },
  { id: 'polygon', label: 'Polygon', shortcut: 'Y', icon: Hexagon, group: 1 },
  { id: 'line', label: 'Line', shortcut: 'L', icon: Slash, group: 1 },
  { id: 'text', label: 'Text', shortcut: 'T', icon: Type, group: 1 },
  { id: 'hand', label: 'Pan', shortcut: 'H', icon: Hand, group: 2 },
  { id: 'zoom', label: 'Zoom', shortcut: 'Z', icon: ZoomIn, group: 2 },
]

export default function ToolRail({ state, store }: Props) {
  const [paintOpen, setPaintOpen] = useState(false)
  const [target, setTarget] = useState<'fill' | 'stroke'>('fill')
  const ref = useRef<HTMLDivElement>(null)
  const selected = store.getSelectedShapes()
  const fill = selected[0]?.fill.color ?? '#ff5c35'
  const stroke = selected[0]?.stroke.color ?? '#1d222b'
  const snap = state.doc.snap.enabled

  useEffect(() => {
    if (!paintOpen) return
    const close = (e: MouseEvent) => { if (ref.current && !ref.current.contains(e.target as Node)) setPaintOpen(false) }
    window.addEventListener('mousedown', close)
    return () => window.removeEventListener('mousedown', close)
  }, [paintOpen])

  const applyColor = (color: string) => {
    if (target === 'fill') store.setFill({ type: 'solid', color }, true)
    else store.setStroke({ color, enabled: true }, true)
  }

  let lastGroup = -1
  return (
    <aside className="tool-rail">
      <div className="tool-brand-line" />
      <div className="tool-list">
        {tools.map(t => {
          const Icon = t.icon
          const divider = lastGroup !== -1 && lastGroup !== t.group
          lastGroup = t.group
          return (
            <div key={t.id} className={divider ? 'tool-divider-wrap' : ''}>
              {divider && <span className="tool-divider" />}
              <button
                type="button"
                className={`tool-btn ${state.tool === t.id ? 'active' : ''}`}
                onClick={() => store.setTool(t.id)}
                data-tooltip={t.label}
              >
                <Icon size={19} strokeWidth={1.7} />
                <span className="tool-key">{t.shortcut}</span>
              </button>
            </div>
          )
        })}
      </div>

      <div className="rail-spacer" />

      <div className="paint-well" ref={ref}>
        <button
          className={`paint-square fill ${target === 'fill' ? 'selected' : ''}`}
          style={{ background: fill }}
          onClick={() => { setTarget('fill'); setPaintOpen(o => !o) }}
          title="Fill color"
        />
        <button
          className={`paint-square stroke ${target === 'stroke' ? 'selected' : ''}`}
          style={{ borderColor: stroke }}
          onClick={() => { setTarget('stroke'); setPaintOpen(o => !o) }}
          title="Outline color"
        />
        {paintOpen && (
          <div className="paint-pop">
            <div className="paint-pop-head">
              <span>PAINT</span>
              <div className="paint-target-switch">
                <button className={target === 'fill' ? 'on' : ''} onClick={() => setTarget('fill')}>Fill</button>
                <button className={target === 'stroke' ? 'on' : ''} onClick={() => setTarget('stroke')}>Line</button>
              </div>
            </div>
            <div className="paint-swatch-grid">
              {PALETTE.map(c => (
                <button key={c} style={{ background: c }} className="paint-swatch" onClick={() => applyColor(c)} title={c} />
              ))}
            </div>
            <label className="paint-custom">
              <span>Custom</span>
              <input type="color" value={target === 'fill' ? fill : stroke} onChange={e => applyColor(e.target.value)} />
            </label>
          </div>
        )}
      </div>

      <div className="rail-bottom">
        <button className={`rail-action ${state.leftOpen ? 'on' : ''}`} onClick={() => store.toggleLeft()} title={state.leftOpen ? 'Hide Layers & Objects ([)' : 'Show Layers & Objects ([)'}>
          <PanelLeft size={17} />
        </button>
        <button className={`rail-action ${snap ? 'on' : ''}`} onClick={() => store.toggleSnap()} title="Snapping">
          <Magnet size={17} />
        </button>
        <button className={`rail-action ${state.doc.grid.enabled ? 'on' : ''}`} onClick={() => store.setGrid({ enabled: !state.doc.grid.enabled })} title="Grid">
          <Grid3X3 size={17} />
        </button>
        <span className="rail-version">v1.0</span>
        <span className="rail-shortcut"><Kbd>F10</Kbd></span>
      </div>
    </aside>
  )
}
