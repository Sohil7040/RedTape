import {
  Check, Magnet, MousePointer2, PenTool, Scissors, Spline, Square, Circle, Hexagon,
  Slash, Type, Hand, ZoomIn, Trash2, Copy, Grid2X2, Orbit,
} from 'lucide-react'
import { EditorState, EditorStore } from '../core/store'
import { Segmented, Switch } from './ui'

interface Props { state: EditorState; store: EditorStore }

export default function ToolOptions({ state, store }: Props) {
  const tool = state.tool
  const selected = store.getSelectedShapes()
  const primary = selected[0]
  const node = state.selectedNode
  const nodeShape = node ? selected.find(s => s.id === node.shapeId) : undefined
  const activeNodeType = node && nodeShape ? nodeShape.subpaths[node.subpathIndex]?.nodes[node.nodeIndex]?.type : undefined
  const fireEnter = () => window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }))

  return (
    <div className="tool-options">
      <div className="to-tool-id">
        <ToolIcon tool={tool} />
        <div><strong>{toolName(tool)}</strong><span>{toolHint(tool, state)}</span></div>
      </div>
      <span className="to-divider" />
      {tool === 'select' && (
        <>
          <div className="to-cluster">
            <span className="to-label">Selection</span>
            <div className="to-value">{selected.length ? `${selected.length} object${selected.length > 1 ? 's' : ''}` : 'None'}</div>
          </div>
          <span className="to-divider" />
          <div className="to-buttons">
            <button onClick={() => store.duplicateSelection()} disabled={!primary} title="Duplicate"><Copy size={14} />Duplicate</button>
            <button onClick={() => store.deleteSelection()} disabled={!primary} title="Delete" className="danger"><Trash2 size={14} /></button>
            <button onClick={() => store.toggleSnap()} className={state.doc.snap.enabled ? 'on' : ''} title="Toggle snap"><Magnet size={14} /></button>
          </div>
          <span className="to-divider" />
          <div className="to-buttons">
            <button onClick={() => store.openPatterns('grid')} title="Repeat selected objects in rows and columns"><Grid2X2 size={14} />Rectangular pattern</button>
            <button onClick={() => store.openPatterns('radial')} title="Repeat selected objects around a pivot"><Orbit size={14} />Circular pattern</button>
            <button onClick={() => {store.setRightOpen(true);store.setRightTab('snap')}}><Magnet size={14} />Snapping</button>
          </div>
        </>
      )}
      {tool === 'node' && (
        <>
          <div className="to-cluster">
            <span className="to-label">Node type</span>
            <div className="node-type-mini">
              {(['cusp', 'smooth', 'symmetric'] as const).map(t => (
                <button key={t} disabled={!node} className={activeNodeType === t ? 'on' : ''} onClick={() => store.setNodeType(t)} title={`Convert to ${t}`}>
                  <span className={`node-glyph ${t}`}><i /><i /></span>{t}
                </button>
              ))}
            </div>
          </div>
          <span className="to-divider" />
          <div className="to-buttons">
            <button onClick={() => store.deleteNode()} disabled={!node} className="danger"><Trash2 size={14} />Node</button>
          </div>
          <div className="to-hint">Double-click segment to insert</div>
        </>
      )}
      {tool === 'pen' && (
        <>
          <div className="to-cluster">
            <span className="to-label">Node mode</span>
            <Segmented compact value={state.penType} onChange={v => store.setPenType(v)} options={[{ value: 'corner', label: 'Corner' }, { value: 'smooth', label: 'Smooth' }]} />
          </div>
          <span className="to-divider" />
          <div className="to-buttons">
            <button onClick={fireEnter} className="primary"><Check size={14} />Finish path</button>
          </div>
          <div className="to-hint">Click to place · drag for tangents</div>
        </>
      )}
      {tool === 'knife' && (
        <>
          <div className="to-value knife-instructions">{state.knife.mode==='line'?'Click start + end, or drag':state.knife.mode==='bezier'?'Click points, then Cut / Enter':'Drag across the shape'}</div>
          <div className="to-cluster">
            <span className="to-label">Cut mode</span>
            <Segmented compact value={state.knife.mode} onChange={v => store.setKnife({ mode: v })} options={[{ value: 'line', label: '2-point' }, { value: 'freehand', label: 'Freehand' }, { value: 'bezier', label: 'Bézier' }]} />
          </div>
          <span className="to-divider" />
          <div className="to-cluster">
            <span className="to-label">Span</span>
            <Segmented compact value={state.knife.span} onChange={v => store.setKnife({ span: v })} options={[{ value: 'normal', label: 'Slice' }, { value: 'gap', label: 'Gap' }, { value: 'overlap', label: 'Overlap' }]} />
          </div>
          <div className="to-num">
            <span className="to-label">Width</span>
            <input aria-label="Knife gap or overlap width" type="number" value={state.knife.width} min={0} step={0.5} onChange={e => {const n=Number(e.target.value);if(Number.isFinite(n))store.setKnife({ width: Math.max(0,n) })}} />
            <span>mm</span>
          </div>
          <div className="to-switch"><Switch description="Knife auto-close" checked={state.knife.autoClose} onChange={v => store.setKnife({ autoClose: v })} /><span>Auto-close</span></div>
          <div className="to-switch"><Switch description="Cut all shapes under path" checked={state.knife.cutAll} onChange={v => store.setKnife({ cutAll: v })} /><span>All under path</span></div>
          <span className="to-divider" />
          <div className="to-buttons">
            <button className="primary" onClick={() => store.commitKnifeDraft()} disabled={!state.draft || state.draft.type !== 'knife' || state.draft.anchors.length<2}><Scissors size={14} />Cut</button>
          </div>
        </>
      )}
      {(tool === 'rect' || tool === 'ellipse' || tool === 'line' || tool === 'polygon') && (
        <>
          <div className="to-cluster">
            <span className="to-label">Draw</span>
            <div className="to-value">{tool === 'rect' ? 'Drag a rectangle' : tool === 'ellipse' ? 'Drag an ellipse' : tool === 'line' ? 'Drag a straight segment' : 'Drag a polygon radius'}</div>
          </div>
          {tool === 'polygon' && (
            <>
              <span className="to-divider" />
              <div className="to-num"><span className="to-label">Sides</span><input type="number" min={3} max={24} value={state.polygonSides} onChange={e => store.setPolygonSides(Number(e.target.value))} /></div>
            </>
          )}
          <div className="to-hint">Shift constrains · snap is live</div>
        </>
      )}
      {tool === 'text' && (
        <>
          <div className="to-value">Click the artboard to place a text object</div>
          <div className="to-hint">Edit typography in Design</div>
        </>
      )}
      {tool === 'hand' && <div className="to-value">Drag to pan · Space pans from any tool · wheel zooms at cursor</div>}
      {tool === 'zoom' && <div className="to-value">Click to zoom in · Alt-click to zoom out · 0 fits the page</div>}
    </div>
  )
}

function ToolIcon({ tool }: { tool: string }) {
  const map: Record<string, typeof MousePointer2> = {
    select: MousePointer2, node: Spline, pen: PenTool, knife: Scissors, rect: Square, ellipse: Circle,
    polygon: Hexagon, line: Slash, text: Type, hand: Hand, zoom: ZoomIn,
  }
  const Icon = map[tool] ?? MousePointer2
  return <span className={`to-icon ${tool}`}><Icon size={17} /></span>
}
function toolName(tool: string): string {
  const map: Record<string, string> = { select: 'Select', node: 'Shape', pen: 'Pen', knife: 'Knife', rect: 'Rectangle', ellipse: 'Ellipse', polygon: 'Polygon', line: 'Line', text: 'Text', hand: 'Pan', zoom: 'Zoom' }
  return map[tool] ?? tool
}
function toolHint(tool: string, state: EditorState): string {
  if (tool === 'select') return `${Math.round((state.view.zoom / (96 / 25.4)) * 100)}% · smart snapping ${state.doc.snap.enabled ? 'on' : 'off'}`
  if (tool === 'node') return state.selection.length ? 'F10 · edit Bézier topology' : 'Select a curve first'
  if (tool === 'knife') return state.knife.autoClose ? 'Split shapes into closed pieces' : 'Split into open paths'
  if (tool === 'pen') return 'Bézier path authoring'
  return 'Precision drawing tool'
}
