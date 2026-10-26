import { useState } from 'react'
import {
  ChevronDown, ChevronRight, Circle, Eye, EyeOff, FileStack, Layers3, Lock, LockOpen, Minus, MoreHorizontal,
  Plus, Square, Star, Type, PenLine, Hexagon, Slash, Trash2, ArrowUp, ArrowDown, PanelLeftClose,
  FolderSync, Gauge, Zap,
} from 'lucide-react'
import { EditorState, EditorStore } from '../core/store'
import { OPERATION_COLORS, Shape, layerOperation } from '../core/model'
import { IconButton, ProcessNumber } from './ui'

interface Props { state: EditorState; store: EditorStore }

function shapeIcon(shape: Shape) {
  switch (shape.kind) {
    case 'ellipse': return Circle
    case 'rect': return Square
    case 'text': return Type
    case 'star': return Star
    case 'polygon': return Hexagon
    case 'line': return Slash
    default: return PenLine
  }
}

export default function LeftDock({ state, store }: Props) {
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({})
  const [tab, setTab] = useState<'layers' | 'document'>('layers')
  const [editingLayerId, setEditingLayerId] = useState<string | null>(null)
  const [layerNameVal, setLayerNameVal] = useState('')

  const doc = state.doc
  const selected = new Set(state.selection)
  const activeLayer = doc.layers.find(l => l.id === doc.activeLayerId)
  const selectedShapes = store.getSelectedShapes()
  const primary = selectedShapes[0]

  const startRename = (id: string, name: string) => {
    setEditingLayerId(id)
    setLayerNameVal(name)
  }

  const commitRename = (id: string) => {
    if (layerNameVal.trim()) {
      store.setLayerName(id, layerNameVal.trim())
    }
    setEditingLayerId(null)
  }

  return (
    <aside className={`left-dock ${state.leftOpen ? '' : 'collapsed'}`}>
      <div className="dock-head">
        <div>
          <span className="eyebrow">DOCUMENT</span>
          <h2>Artwork</h2>
        </div>
        <button className="dock-collapse" onClick={() => store.toggleLeft()} title="Hide panel"><PanelLeftClose size={14} /></button>
      </div>
      <div className="subtabs">
        <button className={tab === 'layers' ? 'on' : ''} onClick={() => setTab('layers')}><Layers3 size={13} />Layers</button>
        <button className={tab === 'document' ? 'on' : ''} onClick={() => setTab('document')}><FileStack size={13} />Document</button>
      </div>

      {tab === 'layers' ? (
        <>
          <div className="tree-tools">
            <span>{doc.layers.length} LAYERS · {doc.layers.reduce((n, l) => n + l.shapes.length, 0)} OBJECTS</span>
            <div>
              <IconButton icon={Plus} label="New layer" onClick={() => store.addLayer(`Layer ${doc.layers.length + 1}`)} size={13} />
              <IconButton icon={Trash2} label="Delete active layer" onClick={() => activeLayer && store.deleteLayer(activeLayer.id)} size={13} disabled={doc.layers.length <= 1} />
            </div>
          </div>
          <div className="layer-tree scroll">
            {[...doc.layers].reverse().map(layer => {
              const isCollapsed = collapsed[layer.id]
              const layerOp = layerOperation(doc.production, layer.id)
              const count = layer.shapes.length
              const isActive = layer.id === doc.activeLayerId
              const isRenaming = editingLayerId === layer.id

              return (
                <div className={`layer-block ${isActive ? 'active' : ''}`} key={layer.id}>
                  <div className={`layer-row ${isActive ? 'active' : ''}`} onClick={() => store.setActiveLayer(layer.id)}>
                    <button className="twist" onClick={e => { e.stopPropagation(); setCollapsed(c => ({ ...c, [layer.id]: !c[layer.id] })) }}>
                      {isCollapsed ? <ChevronRight size={12} /> : <ChevronDown size={12} />}
                    </button>
                    <input className="layer-color-input" type="color" value={layer.color} aria-label={`Colour for ${layer.name}`} title="Layer colour — applies to its objects" onClick={e => e.stopPropagation()} onChange={e => store.setLayerColor(layer.id, e.target.value)} />

                    {isRenaming ? (
                      <input
                        className="layer-rename-input"
                        value={layerNameVal}
                        onChange={e => setLayerNameVal(e.target.value)}
                        onBlur={() => commitRename(layer.id)}
                        onKeyDown={e => {
                          if (e.key === 'Enter') commitRename(layer.id)
                          if (e.key === 'Escape') setEditingLayerId(null)
                        }}
                        autoFocus
                        onClick={e => e.stopPropagation()}
                      />
                    ) : (
                      <span
                        className="layer-name"
                        onDoubleClick={e => {
                          e.stopPropagation()
                          startRename(layer.id, layer.name)
                        }}
                        title="Double-click to rename layer"
                      >
                        {layer.name}
                      </span>
                    )}

                    <span
                      className="layer-op-badge"
                      style={{ color: OPERATION_COLORS[layerOp.mode], borderColor: `${OPERATION_COLORS[layerOp.mode]}55` }}
                      title={`Click to open Laser params (${layerOp.speed}mm/s, ${layerOp.power}%)`}
                      onClick={e => {
                        e.stopPropagation()
                        store.setRightTab('production')
                        if (!state.rightOpen) store.setRightOpen(true)
                      }}
                    >
                      {layerOp.mode === 'ignore' ? 'SKIP' : `${layerOp.mode.toUpperCase()}`}
                    </span>
                    <span className="layer-count">{count}</span>
                    <button className="row-icon" title={layer.visible ? 'Hide layer' : 'Show layer'} onClick={e => { e.stopPropagation(); store.updateLayer(layer.id, { visible: !layer.visible }) }}>
                      {layer.visible ? <Eye size={13} /> : <EyeOff size={13} />}
                    </button>
                    <button className="row-icon" title={layer.locked ? 'Unlock layer' : 'Lock layer'} onClick={e => { e.stopPropagation(); store.updateLayer(layer.id, { locked: !layer.locked }) }}>
                      {layer.locked ? <Lock size={12} /> : <LockOpen size={12} />}
                    </button>
                  </div>

                  {/* Inline Laser Speed & Power Controls for Each Layer */}
                  <div className="layer-cam-inline" onClick={e => e.stopPropagation()}>
                    <div className="layer-cam-field">
                      <Gauge size={10} />
                      <input
                        type="number"
                        value={layerOp.speed}
                        step={1}
                        min={1}
                        max={1000}
                        onChange={e => store.setLayerSpeed(layer.id, Number(e.target.value))}
                        title="Layer Speed in mm/s"
                      />
                      <em>mm/s</em>
                    </div>
                    <div className="layer-cam-field">
                      <Zap size={10} />
                      <ProcessNumber
                        value={layerOp.maxPower ?? layerOp.power}
                        step={1}
                        min={0}
                        max={99}
                        onChange={v => store.setLayerPower(layer.id, v)}
                        title="Laser Power % (<=99% safe ceiling)"
                      />
                      <em>%</em>
                    </div>
                  </div>

                  {!isCollapsed && (
                    <div className="shape-list">
                      {count === 0 && <div className="layer-empty">No objects on this layer</div>}
                      {[...layer.shapes].reverse().map(shape => {
                        const Icon = shapeIcon(shape)
                        const isSel = selected.has(shape.id)
                        return (
                          <div
                            key={shape.id}
                            className={`shape-row ${isSel ? 'selected' : ''}`}
                            onClick={e => store.setSelection([shape.id], e.shiftKey, true)}
                            onDoubleClick={() => { store.setTool('node'); store.setSelection([shape.id]) }}
                          >
                            <span className="shape-indent" />
                            <span className={`shape-type ${isSel ? 'sel' : ''}`}><Icon size={12} /></span>
                            <span className="shape-name">{shape.name}</span>
                            {shape.clip && <span className="shape-chip">CLIP</span>}

                            {/* Transfer shape to another layer */}
                            <select
                              className="shape-layer-picker"
                              value={layer.id}
                              title="Transfer element to another layer"
                              onClick={e => e.stopPropagation()}
                              onChange={e => {
                                e.stopPropagation()
                                if (e.target.value && e.target.value !== layer.id) {
                                  store.moveShapesToLayer([shape.id], e.target.value)
                                }
                              }}
                            >
                              {doc.layers.map(ly => (
                                <option key={ly.id} value={ly.id}>
                                  ➔ {ly.name}
                                </option>
                              ))}
                            </select>

                            <button className="row-icon shape-eye" title={shape.hidden ? 'Show' : 'Hide'} onClick={e => { e.stopPropagation(); store.setShapeHidden(shape.id, !shape.hidden) }}>
                              {shape.hidden ? <EyeOff size={12} /> : <Eye size={12} />}
                            </button>
                            <button className={`row-icon shape-lock ${shape.locked ? 'on' : ''}`} title={shape.locked ? 'Unlock' : 'Lock'} onClick={e => { e.stopPropagation(); store.setShapeLocked(shape.id, !shape.locked) }}>
                              {shape.locked ? <Lock size={11} /> : <LockOpen size={11} />}
                            </button>
                          </div>
                        )
                      })}
                    </div>
                  )}
                </div>
              )
            })}
          </div>
          <div className="layer-footer">
            <div className="layer-info">
              <span className="mini-label">ACTIVE LAYER</span>
              <strong>{activeLayer?.name ?? '—'}</strong>
            </div>
            {selectedShapes.length > 0 && (
              <div className="layer-transfer-quick">
                <span className="mini-label">MOVE TO</span>
                <select
                  className="quick-move-select"
                  value=""
                  onChange={e => {
                    if (e.target.value) {
                      store.moveShapesToLayer(selectedShapes.map(s => s.id), e.target.value)
                    }
                  }}
                >
                  <option value="" disabled>Layer…</option>
                  {doc.layers.map(l => (
                    <option key={l.id} value={l.id}>{l.name}</option>
                  ))}
                </select>
              </div>
            )}
            <div className="object-order">
              <span className="mini-label">ORDER</span>
              <div>
                <IconButton icon={ArrowUp} label="Bring forward" size={13} disabled={!primary} onClick={() => primary && store.moveShapeZ(primary.id, 1)} />
                <IconButton icon={ArrowDown} label="Send backward" size={13} disabled={!primary} onClick={() => primary && store.moveShapeZ(primary.id, -1)} />
              </div>
            </div>
          </div>
        </>
      ) : (
        <div className="document-pane scroll">
          <div className="page-card">
            <div className="page-thumb">
              <div className="page-thumb-inner">
                <span />
                <span />
                <span />
              </div>
            </div>
            <div className="page-card-meta">
              <span className="eyebrow">PAGE 01</span>
              <strong>{doc.page.name}</strong>
              <span>{doc.page.width} × {doc.page.height} mm · {doc.page.unit.toUpperCase()}</span>
            </div>
          </div>
          <div className="doc-stats">
            <div><span>Objects</span><strong>{doc.layers.reduce((n, l) => n + l.shapes.length, 0)}</strong></div>
            <div><span>Nodes</span><strong>{doc.layers.reduce((n, l) => n + l.shapes.reduce((m, s) => m + s.subpaths.reduce((k, sp) => k + sp.nodes.length, 0), 0), 0)}</strong></div>
            <div><span>Guides</span><strong>{doc.guides.length}</strong></div>
          </div>
          <div className="page-field-row"><span>Background</span><span className="inline-color"><i style={{ background: doc.page.color }} />{doc.page.color.toUpperCase()}</span></div>
          <div className="page-field-row"><span>Grid</span><span>{doc.grid.size} mm / {doc.grid.subdivisions} div</span></div>
          <div className="page-field-row"><span>Color mode</span><span>RGB / 8</span></div>
          <div className="page-field-row"><span>Origin</span><span>Top left</span></div>
          <button className="wide-ghost" onClick={() => store.resetDemo()}><Trash2 size={13} />Restore showcase</button>
          <p className="doc-note">Corelith uses double-precision millimetre coordinates with a 3×3 affine viewport matrix. Exports are resolution independent.</p>
        </div>
      )}

      {state.leftOpen && <div className="dock-resize-line" />}
      <div className="dock-footnote"><Minus size={11} /><span>{selectedShapes.length ? `${selectedShapes.length} SELECTED` : 'NO SELECTION'}</span><MoreHorizontal size={12} /></div>
    </aside>
  )
}
