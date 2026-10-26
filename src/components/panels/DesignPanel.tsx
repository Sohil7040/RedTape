import { useState } from 'react'
import {
  Copy, Layers2, RotateCw, Spline, Trash2, Type, Unlink, Grid2X2, ScanLine,
  AlignStartHorizontal, AlignCenterHorizontal, AlignEndHorizontal, AlignStartVertical, AlignCenterVertical, AlignEndVertical,
  AlignHorizontalSpaceAround, AlignVerticalSpaceAround, Combine, Scissors, Layers, Sparkles, FolderSync,
} from 'lucide-react'
import { pathCentroid } from '../../core/geometry'
import { EditorState, EditorStore } from '../../core/store'
import { shapeBounds, selectionBounds, getLayerOfShape } from '../../core/model'
import { ColorField, EmptyHint, Kbd, NumField, Section, Segmented, SelectField, Switch } from '../ui'

interface Props { state: EditorState; store: EditorStore }

export default function DesignPanel({ state, store }: Props) {
  const [alignToPage, setAlignToPage] = useState(false)
  const shapes = store.getSelectedShapes()
  const alignWithPage = alignToPage || shapes.length === 1
  const primary = shapes[0]
  if (!primary) return <ArtboardPanel state={state} store={store} />
  const b = selectionBounds(shapes)
  const sb = shapeBounds(primary)
  const center = { x: b.x + b.w / 2, y: b.y + b.h / 2 }
  const centroid = pathCentroid(primary.subpaths, sb)
  const nodeCount = shapes.reduce((n, s) => n + s.subpaths.reduce((m, sp) => m + sp.nodes.length, 0), 0)
  const currentLayer = getLayerOfShape(state.doc, primary.id)
  const fill = primary.fill
  const stroke = primary.stroke
  const t = primary.text
  const selNode = state.selectedNode
  const nodeShape = selNode ? store.getSelectedShapes().find(s => s.id === selNode.shapeId) : undefined
  const activeNode = selNode && nodeShape ? nodeShape.subpaths[selNode.subpathIndex]?.nodes[selNode.nodeIndex] : undefined
  const stops = fill.stops.length >= 2 ? fill.stops : [{ offset: 0, color: fill.color }, { offset: 1, color: '#ffffff' }]

  const hasClipChildren = state.doc.layers.some(l => l.shapes.some(s => s.meta?.clipFrameId === primary.id))
  const dashPreset = stroke.dash.length === 0 ? 'solid' : stroke.dash[0] <= 1.2 && stroke.dash.length > 1 ? 'dot' : stroke.dash.length > 2 ? 'dashdot' : 'dash'

  return (
    <div className="inspector-stack">
      <div className="selection-hero">
        <div className="selection-hero-top">
          <span className="shape-kind-badge"><Spline size={13} />{primary.kind.toUpperCase()}</span>
          <span className="node-pill">{nodeCount} NODES</span>
        </div>
        <input className="object-name-input" value={primary.name} onChange={e => store.setShapeName(primary.id, e.target.value)} />
        <div className="selection-hero-meta">
          <span>{shapes.length} object{shapes.length > 1 ? 's' : ''}</span>
          <span>{b.w.toFixed(1)} × {b.h.toFixed(1)} mm</span>
          <span className="hero-layer">{currentLayer?.name ?? 'Layer'}</span>
        </div>

        {/* Transfer Element to Layer */}
        <div className="layer-transfer-row">
          <span className="mini-label">TRANSFER TO LAYER</span>
          <div className="layer-select-wrap">
            <FolderSync size={13} className="transfer-icon" />
            <select
              className="layer-transfer-select"
              value={currentLayer?.id ?? ''}
              onChange={e => {
                if (e.target.value) {
                  store.moveShapesToLayer(shapes.map(s => s.id), e.target.value)
                }
              }}
              title="Transfer selected element(s) to another layer"
            >
              {state.doc.layers.map(l => (
                <option key={l.id} value={l.id}>
                  {l.name} ({l.shapes.length} objects)
                </option>
              ))}
            </select>
          </div>
        </div>
      </div>

      <Section title="Transform" action={<span className="section-hint">WORLD / MM</span>}>
        <div className="num-grid">
          <NumField label="X" value={b.x} onChange={v => store.setSelectionPosition(v, b.y)} precision={1} suffix="mm" />
          <NumField label="Y" value={b.y} onChange={v => store.setSelectionPosition(b.x, v)} precision={1} suffix="mm" />
          <NumField label="W" value={b.w} onChange={v => store.setSelectionSize(v, b.h)} min={0.1} precision={1} suffix="mm" />
          <NumField label="H" value={b.h} onChange={v => store.setSelectionSize(b.w, v)} min={0.1} precision={1} suffix="mm" />
        </div>
        <div className="readout-row">
          <span className="readout"><i className="crosshair-dot" />Center <strong>{center.x.toFixed(1)}, {center.y.toFixed(1)}</strong></span>
          <span className="readout"><i className="centroid-dot" />Centroid <strong>{centroid.x.toFixed(1)}, {centroid.y.toFixed(1)}</strong></span>
        </div>
        <div className="object-actions">
          <button onClick={() => store.duplicateSelection()}><Copy size={13} />Duplicate <Kbd>⌘D</Kbd></button>
          <button onClick={() => store.deleteSelection()} className="danger"><Trash2 size={13} />Delete</button>
        </div>
      </Section>

      {/* Alignment & Distribute Toolbar */}
      <Section
        title="Alignment & Distribute"
        action={
          <button
            type="button"
            className={`align-target-pill ${alignWithPage ? 'page' : 'selection'}`}
            onClick={() => setAlignToPage(!alignToPage)}
            disabled={shapes.length === 1}
            title={shapes.length === 1 ? 'One object aligns to the page. Select multiple objects to align them to each other.' : alignWithPage ? 'Align to page bounds' : 'Align to selection bounds'}
          >
            {alignWithPage ? 'BED PAGE' : 'SELECTION'}
          </button>
        }
      >
        <div className="align-buttons-grid">
          <button onClick={() => store.alignSelection('left', alignWithPage)} title="Align left edges"><AlignStartVertical size={14} /><span>Left</span></button>
          <button onClick={() => store.alignSelection('hcenter', alignWithPage)} title="Center X — move left/right to align horizontal centres"><AlignCenterVertical size={14} /><span>Center X</span></button>
          <button onClick={() => store.alignSelection('right', alignWithPage)} title="Align right edges"><AlignEndVertical size={14} /><span>Right</span></button>
          <button onClick={() => store.alignSelection('top', alignWithPage)} title="Align top edges"><AlignStartHorizontal size={14} /><span>Top</span></button>
          <button onClick={() => store.alignSelection('vcenter', alignWithPage)} title="Middle Y — move up/down to align vertical centres"><AlignCenterHorizontal size={14} /><span>Middle Y</span></button>
          <button onClick={() => store.alignSelection('bottom', alignWithPage)} title="Align bottom edges"><AlignEndHorizontal size={14} /><span>Bottom</span></button>
        </div>
        <small>Center X moves left/right. Middle Y moves up/down.</small>
        <div className="distribute-row">
          <button
            type="button"
            className="distribute-btn"
            onClick={() => store.distributeSelection('horizontal')}
            disabled={shapes.length < 3}
            title="Distribute horizontally with equal spacing (3+ objects)"
          >
            <AlignHorizontalSpaceAround size={13} />
            <span>Distribute Horiz</span>
          </button>
          <button
            type="button"
            className="distribute-btn"
            onClick={() => store.distributeSelection('vertical')}
            disabled={shapes.length < 3}
            title="Distribute vertically with equal spacing (3+ objects)"
          >
            <AlignVerticalSpaceAround size={13} />
            <span>Distribute Vert</span>
          </button>
        </div>
      </Section>

      {/* Boolean Operations (Union, Subtract, Intersect, Exclude) */}
      <Section title="Boolean Operations" action={<span className="section-hint">COMBINE</span>}>
        <div className="boolean-buttons-grid">
          <button
            type="button"
            onClick={() => store.booleanUnion()}
            disabled={shapes.length < 2}
            title="Union: Combine shapes into a single unified perimeter"
          >
            <Combine size={14} />
            <span>Union</span>
          </button>
          <button
            type="button"
            onClick={() => store.booleanSubtract()}
            disabled={shapes.length < 2}
            title="Subtract: Cut upper shapes out of bottom shape"
          >
            <Scissors size={14} />
            <span>Subtract</span>
          </button>
          <button
            type="button"
            onClick={() => store.booleanIntersect()}
            disabled={shapes.length < 2}
            title="Intersect: Keep overlapping area only"
          >
            <Layers size={14} />
            <span>Intersect</span>
          </button>
          <button
            type="button"
            onClick={() => store.booleanExclude()}
            disabled={shapes.length < 2}
            title="Exclude (XOR): Hollow out overlapping area"
          >
            <Sparkles size={14} />
            <span>Exclude</span>
          </button>
        </div>
        {shapes.length < 2 && (
          <div className="boolean-hint">Select 2 or more shapes to perform Boolean operations.</div>
        )}
      </Section>

      <Section title="Fill" action={<span className="section-hint">PAINT</span>}>
        <Segmented
          compact
          value={fill.type}
          onChange={v => {
            if (v === 'mesh' && fill.stops.length < 4) {
              const a = fill.stops[0]?.color ?? fill.color
              const b = fill.stops[1]?.color ?? '#ffb21c'
              store.setFill({ type: v, stops: [{ offset: 0, color: a }, { offset: 1, color: b }, { offset: 0, color: '#2b59ff' }, { offset: 1, color: '#63e6c1' }] }, true)
            } else store.setFill({ type: v }, true)
          }}
          options={[
            { value: 'solid', label: 'Solid' },
            { value: 'linear', label: 'Linear' },
            { value: 'radial', label: 'Radial' },
            { value: 'pattern', label: 'Patrn' },
            { value: 'mesh', label: 'Mesh' },
            { value: 'none', label: 'None' },
          ]}
        />
        {fill.type !== 'none' && (
          <>
            {fill.type === 'solid' && (
              <div className="field-row">
                <span>Color</span>
                <ColorField value={fill.color} onChange={v => store.setFill({ color: v }, true)} />
              </div>
            )}
            {(fill.type === 'linear' || fill.type === 'radial') && (
              <>
                <div className="gradient-bar" style={{ background: `linear-gradient(90deg, ${stops[0].color}, ${stops[1].color})` }} />
                <div className="field-row">
                  <span className="mini-label">STOP A</span>
                  <ColorField value={stops[0].color} onChange={v => store.setFill({ stops: [{ ...stops[0], color: v }, stops[1]] }, true)} />
                </div>
                <div className="field-row">
                  <span className="mini-label">STOP B</span>
                  <ColorField value={stops[1].color} onChange={v => store.setFill({ stops: [stops[0], { ...stops[1], color: v }] }, true)} />
                </div>
                {fill.type === 'linear' && (
                  <div className="slider-field">
                    <span>Angle</span>
                    <input type="range" min={0} max={360} value={fill.angle} onChange={e => store.setFill({ angle: Number(e.target.value) })} />
                    <NumField label="" value={fill.angle} onChange={v => store.setFill({ angle: v })} min={0} max={360} precision={0} suffix="°" />
                  </div>
                )}
              </>
            )}
            {fill.type === 'pattern' && (
              <div className="field-row">
                <span>Pattern</span>
                <SelectField value={fill.pattern ?? 'dots'} onChange={v => store.setFill({ pattern: v })} options={[{ value: 'dots', label: 'Dots' }, { value: 'lines', label: 'Diagonal lines' }, { value: 'checker', label: 'Checker' }]} />
              </div>
            )}
            {fill.type === 'mesh' && (
              <div className="mesh-grid">
                {[0, 1, 2, 3].map(i => {
                  const stop = fill.stops[i] ?? fill.stops[Math.min(i, fill.stops.length - 1)]
                  const label = ['TL', 'TR', 'BL', 'BR'][i]
                  return (
                    <label key={label} className="mesh-color">
                      <span>{label}</span>
                      <input type="color" value={stop?.color ?? '#ffffff'} onChange={e => {
                        const next = [0, 1, 2, 3].map(k => fill.stops[k] ?? { offset: k % 2, color: e.target.value })
                        next[i] = { ...next[i], color: e.target.value }
                        store.setFill({ stops: next }, true)
                      }} />
                      <em>{stop?.color.toUpperCase() ?? ''}</em>
                    </label>
                  )
                })}
              </div>
            )}
            <div className="slider-field">
              <span>Opacity</span>
              <input type="range" min={0} max={100} value={Math.round(fill.opacity * 100)} onChange={e => store.setFill({ opacity: Number(e.target.value) / 100 }, true)} />
              <span className="range-value">{Math.round(fill.opacity * 100)}%</span>
            </div>
            {primary.subpaths.some(sp => sp.closed) && (
              <div className="field-row">
                <span>Fill rule</span>
                <Segmented compact value={primary.fillRule} onChange={v => store.setFillRule(v)} options={[{ value: 'nonzero', label: 'Non-zero' }, { value: 'evenodd', label: 'Even-odd' }]} />
              </div>
            )}
          </>
        )}
      </Section>

      <Section title="Outline" action={<Switch checked={stroke.enabled} onChange={v => store.setStroke({ enabled: v }, true)} />}>
        <div className="field-row">
          <span>Color</span>
          <ColorField value={stroke.color} onChange={v => store.setStroke({ color: v }, true)} />
        </div>
        <div className="num-grid two">
          <NumField label="Width" value={stroke.width} onChange={v => store.setStroke({ width: v }, true)} min={0} precision={2} suffix="mm" />
          <NumField label="Opacity" value={Math.round(stroke.opacity * 100)} onChange={v => store.setStroke({ opacity: v / 100 }, true)} min={0} max={100} precision={0} suffix="%" />
        </div>
        <div className="field-row">
          <span>Cap</span>
          <Segmented compact value={stroke.cap} onChange={v => store.setStroke({ cap: v }, true)} options={[{ value: 'butt', label: 'Butt' }, { value: 'round', label: 'Round' }, { value: 'square', label: 'Square' }]} />
        </div>
        <div className="field-row">
          <span>Join</span>
          <Segmented compact value={stroke.join} onChange={v => store.setStroke({ join: v }, true)} options={[{ value: 'miter', label: 'Miter' }, { value: 'round', label: 'Round' }, { value: 'bevel', label: 'Bevel' }]} />
        </div>
        <div className="field-row">
          <span>Dash</span>
          <Segmented
            compact
            value={dashPreset}
            onChange={v => {
              const dash = v === 'solid' ? [] : v === 'dot' ? [1, 2.6] : v === 'dashdot' ? [6, 2.5, 1.2, 2.5] : [5, 2.4]
              store.setStroke({ dash }, true)
            }}
            options={[{ value: 'solid', label: '—' }, { value: 'dash', label: '--' }, { value: 'dot', label: '··' }, { value: 'dashdot', label: '-·' }]}
          />
        </div>
        <div className="field-row">
          <span>Scale with shape</span>
          <Switch checked={primary.scaleStroke !== false} onChange={v => store.updateSelectedShapes(s => ({ ...s, scaleStroke: v }), true)} />
        </div>
      </Section>

      {t && (
        <Section title="Typography" action={<Type size={14} />}>
          <textarea className="text-editor" aria-label="Text content" placeholder="Type your text" value={t.content} rows={3} onChange={e => store.setSelectedText(e.target.value)} />
          <div className="num-grid two">
            <NumField label="Size" value={t.fontSize} onChange={v => store.setTextProps({ fontSize: Math.max(1, v) })} precision={1} suffix="mm" />
            <NumField label="Weight" value={t.fontWeight} onChange={v => store.setTextProps({ fontWeight: Math.min(900, Math.max(100, Math.round(v / 100) * 100)) })} min={100} max={900} step={100} precision={0} />
          </div>
          <div className="field-row">
            <span>Family</span>
            <SelectField value={t.fontFamily} onChange={v => store.setTextProps({ fontFamily: v })} options={[{ value: 'Arial', label: 'Arial' }, { value: 'Arial Black', label: 'Arial Black' }, { value: 'Georgia', label: 'Georgia' }, { value: 'Courier New', label: 'Courier New' }, { value: 'Times New Roman', label: 'Times' }]} />
          </div>
          <div className="field-row">
            <span>Letter spacing</span>
            <NumField label="" value={t.letterSpacing} onChange={v => store.setTextProps({ letterSpacing: v })} precision={1} suffix="mm" />
          </div>
          <button type="button" className="safe-export-btn" onClick={() => void store.convertTextToCurves('selection')}>Convert selected text to curves</button>
          <small>Uses bundled Sans, Serif or Mono fonts for consistent outlines. Undo restores editable text. Weights resolve to Regular or Bold.</small>
        </Section>
      )}

      {(t || typeof primary.meta?.originalText === 'string') && <Section title="Text infill">
        <Switch label="Filled text engraving" checked={primary.textInfill?.enabled ?? false} onChange={v => store.setTextInfill(v, primary.textInfill?.spacing ?? .15)} />
        {primary.textInfill?.enabled && <NumField label="Infill spacing" value={primary.textInfill.spacing} min={.02} max={5} precision={2} suffix="mm" onChange={v => store.setTextInfill(true, v)} />}
        <small>Filled text engraves before cuts, using its layer's speed, power and passes. Use a separate layer for independent engraving settings. Convert editable text to curves before sending. Smaller spacing creates denser fill and takes longer.</small>
      </Section>}

      {state.tool === 'node' && (
        <Section title="Node" action={activeNode ? <span className="section-hint">{(selNode?.nodeIndex ?? 0) + 1} / {nodeShape?.subpaths[selNode?.subpathIndex ?? 0]?.nodes.length ?? 0}</span> : undefined}>
          {activeNode ? (
            <>
              <div className="node-type-row">
                {(['cusp', 'smooth', 'symmetric'] as const).map(type => (
                  <button key={type} className={`node-type-btn ${activeNode.type === type ? 'on' : ''}`} onClick={() => store.setNodeType(type)}>
                    <NodeGlyph type={type} />
                    <span>{type}</span>
                  </button>
                ))}
              </div>
              <div className="num-grid two">
                <NumField label="Node X" value={activeNode.x} onChange={v => store.moveNodeTo(selNode!, { x: v, y: activeNode.y }, true)} precision={1} suffix="mm" />
                <NumField label="Node Y" value={activeNode.y} onChange={v => store.moveNodeTo(selNode!, { x: activeNode.x, y: v }, true)} precision={1} suffix="mm" />
              </div>
              <div className="node-info-row">
                <span>In handle <strong>{Math.hypot(activeNode.in.x - activeNode.x, activeNode.in.y - activeNode.y).toFixed(1)} mm</strong></span>
                <span>Out handle <strong>{Math.hypot(activeNode.out.x - activeNode.x, activeNode.out.y - activeNode.y).toFixed(1)} mm</strong></span>
              </div>
              <button className="wide-ghost danger" onClick={() => store.deleteNode()}><Trash2 size={13} />Delete node</button>
              <p className="panel-note">Drag the handle circles or use the segment shaper. Double-click a segment to insert a node at that parameter.</p>
            </>
          ) : (
            <EmptyHint icon={Spline} title="Select a node" body="Click an anchor or drag a segment directly on the canvas. Switch node type above the artwork." />
          )}
        </Section>
      )}

      {(shapes.length > 1 || primary.clip || hasClipChildren) && (
        <Section title="PowerClip" action={<span className="section-hint">LIVE CLIP</span>}>
          <div className="powerclip-card">
            <span className="powerclip-icon"><Layers2 size={16} /></span>
            <div>
              <strong>{primary.clip ? 'Contents are inside a frame' : hasClipChildren ? 'Container frame with contents' : 'Nested clipping available'}</strong>
              <p>{primary.clip ? 'The selected object is clipped to its container geometry. Extract to release it.' : hasClipChildren ? 'This object clips one or more child objects.' : 'Clip all selected objects into the topmost object in the selection stack.'}</p>
            </div>
          </div>
          {shapes.length > 1 && <button className="wide-ghost" onClick={() => store.powerClipSelection()}><Layers2 size={13} />PowerClip into topmost</button>}
          {(primary.clip || hasClipChildren) && <button className="wide-ghost" onClick={() => store.extractClip()}><Unlink size={13} />Extract contents</button>}
        </Section>
      )}

      <Section title="Effect" action={<Switch checked={primary.shadow.enabled} onChange={v => store.setShadow({ enabled: v }, true)} />}>
        <div className="num-grid two">
          <NumField label="Offset X" value={primary.shadow.x} onChange={v => store.setShadow({ x: v }, true)} precision={1} suffix="mm" />
          <NumField label="Offset Y" value={primary.shadow.y} onChange={v => store.setShadow({ y: v }, true)} precision={1} suffix="mm" />
          <NumField label="Blur" value={primary.shadow.blur} onChange={v => store.setShadow({ blur: v }, true)} min={0} precision={1} suffix="mm" />
          <ColorField value={primary.shadow.color} onChange={v => store.setShadow({ color: v }, true)} />
        </div>
        <div className="slider-field">
          <span>Shadow opacity</span>
          <input type="range" min={0} max={100} value={Math.round(primary.shadow.opacity * 100)} onChange={e => store.setShadow({ opacity: Number(e.target.value) / 100 }, true)} />
          <span className="range-value">{Math.round(primary.shadow.opacity * 100)}%</span>
        </div>
      </Section>
      <div className="inspector-foot"><span>ID {primary.id.slice(-8)}</span><span>Z {state.doc.layers.findIndex(l => l.shapes.some(s => s.id === primary.id)) + 1}</span></div>
    </div>
  )
}

function NodeGlyph({ type }: { type: 'cusp' | 'smooth' | 'symmetric' }) {
  return (
    <svg width="34" height="26" viewBox="0 0 34 26" fill="none">
      <path d={type === 'cusp' ? 'M8 5 L17 16 L26 5' : type === 'smooth' ? 'M8 5 L17 16 L26 7' : 'M8 6 L17 16 L26 6'} stroke="currentColor" strokeWidth="1.1" strokeDasharray="2 2" opacity="0.5" />
      <circle cx="8" cy="5" r="2.4" stroke="currentColor" fill="none" />
      <circle cx="26" cy={type === 'smooth' ? 7 : type === 'symmetric' ? 6 : 5} r="2.4" stroke="currentColor" fill="none" />
      <rect x="14" y="13" width="6" height="6" transform="rotate(45 17 16)" fill="currentColor" />
    </svg>
  )
}

function ArtboardPanel({ state, store }: { state: EditorState; store: EditorStore }) {
  const page = state.doc.page
  const setSize = (w: number, h: number) => store.setPage({ width: w, height: h })
  return (
    <div className="inspector-stack">
      <div className="selection-hero artboard">
        <div className="selection-hero-top"><span className="shape-kind-badge"><Grid2X2 size={13} />ARTBOARD</span><span className="node-pill">ACTIVE</span></div>
        <h2 className="artboard-name">Page 01 <span>/ {page.name}</span></h2>
        <div className="selection-hero-meta"><span>{page.width} × {page.height} mm</span><span>Top-left origin</span><span>RGB</span></div>
      </div>
      <Section title="Page setup" action={<span className="section-hint">WORLD</span>}>
        <div className="preset-grid">
          <button onClick={() => setSize(1220, 915)} className={page.width === 1220 && page.height === 915 ? 'on' : ''}><strong>Ruida</strong><span>1220 × 915</span></button>
          <button onClick={() => setSize(420, 297)} className={page.width === 420 && page.height === 297 ? 'on' : ''}><strong>A3</strong><span>420 × 297</span></button>
          <button onClick={() => setSize(297, 420)} className={page.width === 297 && page.height === 420 ? 'on' : ''}><strong>A3</strong><span>Portrait</span></button>
          <button onClick={() => setSize(210, 297)} className={page.width === 210 && page.height === 297 ? 'on' : ''}><strong>A4</strong><span>210 × 297</span></button>
        </div>
        <div className="num-grid two">
          <NumField label="Width" value={page.width} onChange={v => store.setPage({ width: Math.max(10, v) })} min={10} suffix="mm" />
          <NumField label="Height" value={page.height} onChange={v => store.setPage({ height: Math.max(10, v) })} min={10} suffix="mm" />
        </div>
        <div className="object-actions">
          <button onClick={() => store.setPage({ width: page.height, height: page.width })}><RotateCw size={13} />Swap orientation</button>
        </div>
        <div className="field-row">
          <span>Background</span>
          <ColorField value={page.color} onChange={v => store.setPage({ color: v })} />
        </div>
      </Section>
      <Section title="Grid & units" action={<Switch checked={state.doc.grid.enabled} onChange={v => store.setGrid({ enabled: v })} />}>
        <div className="num-grid two">
          <NumField label="Spacing" value={state.doc.grid.size} onChange={v => store.setGrid({ size: Math.max(0.5, v) })} min={0.5} suffix="mm" />
          <NumField label="Subdiv" value={state.doc.grid.subdivisions} onChange={v => store.setGrid({ subdivisions: Math.max(1, Math.round(v)) })} min={1} precision={0} />
        </div>
        <div className="field-row"><span>Units</span><span className="static-value">Millimetres (mm)</span></div>
        <div className="field-row"><span>Snap radius</span><span className="static-value">{state.doc.snap.radius} px screen</span></div>
      </Section>
      <Section title="Quick start">
        <div className="shortcut-list">
          <div><span>Select artwork</span><Kbd>V</Kbd></div>
          <div><span>Edit nodes</span><Kbd>F10</Kbd></div>
          <div><span>Pen path</span><Kbd>P</Kbd></div>
          <div><span>Knife slice</span><Kbd>K</Kbd></div>
          <div><span>Fit page</span><Kbd>0</Kbd></div>
        </div>
        <EmptyHint icon={ScanLine} title="Select an object" body="Click any shape to inspect geometry, fills, stroke joins, nodes and effects." />
      </Section>
    </div>
  )
}

