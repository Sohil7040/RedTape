import { useState } from 'react'
import { ArrowRight, ArrowUp, CircleDot, Grid2X2, MoveRight, Orbit, Sparkles, Target, WandSparkles } from 'lucide-react'
import { EditorStore, EditorState } from '../../core/store'
import { gridPatternCount, radialStep } from '../../core/patterns'
import { selectionBounds } from '../../core/model'
import { NumField, Section, Segmented, Switch } from '../ui'

interface Props { state: EditorState; store: EditorStore }

export default function PatternsPanel({ state, store }: Props) {
  const [tab, setTab] = useState<'grid' | 'radial'>('grid')
  const selected = store.getSelectedShapes()
  const primary = selected[0]
  const b = selected.length ? selectionBounds(selected) : null
  const grid = state.gridPattern
  const radial = state.radialPattern
  const gridCount = gridPatternCount(grid)

  return (
    <div className="inspector-stack">
      <div className="pattern-head">
        <div>
          <span className="eyebrow">PROCEDURAL ARRAYS</span>
          <h2>Pattern engine</h2>
        </div>
        <span className="pattern-mode">{tab === 'grid' ? 'CARTESIAN' : 'POLAR'}</span>
      </div>
      <div className="pattern-tabs">
        <button className={tab === 'grid' ? 'on' : ''} onClick={() => setTab('grid')}><Grid2X2 size={14} />Rectangular</button>
        <button className={tab === 'radial' ? 'on' : ''} onClick={() => setTab('radial')}><Orbit size={14} />Circular</button>
      </div>

      {!primary && (
        <div className="pattern-warning"><Target size={14} /><span>Select an artwork object to activate the array engine.</span></div>
      )}

      {tab === 'grid' ? (
        <>
          <div className="pattern-preview grid-preview">
            <div className="grid-preview-canvas" style={{ gridTemplateColumns: `repeat(${Math.min(6, Math.max(1, grid.columns))}, 1fr)` }}>
              {Array.from({ length: Math.min(18, Math.max(1, grid.columns) * Math.max(1, grid.rows)) }).map((_, i) => (
                <span key={i} className={i === 0 ? 'source' : ''} style={{ width: `${Math.max(10, Math.min(22, 26 - Math.min(8, i)))}px` }} />
              ))}
            </div>
            <div className="pattern-preview-meta">
              <span className="eyebrow">STEP & REPEAT</span>
              <strong>{grid.columns} × {grid.rows}</strong>
              <span>{gridCount} new copies</span>
            </div>
            <span className="pattern-corner">ΔX {grid.mode === 'spacing' ? `${b ? (b.w + grid.dx).toFixed(1) : grid.dx}` : grid.dx} · ΔY {grid.mode === 'spacing' ? `${b ? (b.h + grid.dy).toFixed(1) : grid.dy}` : grid.dy}</span>
          </div>

          <Section title="Grid array" action={<span className="section-hint">CTRL+SHIFT+D</span>}>
            <div className="num-grid two">
              <NumField label="Columns" value={grid.columns} onChange={v => store.setGridPattern({ columns: Math.max(1, Math.round(v)) })} min={1} max={40} precision={0} />
              <NumField label="Rows" value={grid.rows} onChange={v => store.setGridPattern({ rows: Math.max(1, Math.round(v)) })} min={1} max={40} precision={0} />
            </div>
            <div className="field-row">
              <span>Measure</span>
              <Segmented compact value={grid.mode} onChange={v => store.setGridPattern({ mode: v })} options={[{ value: 'offset', label: 'Offset' }, { value: 'spacing', label: 'Gap' }]} />
            </div>
            <div className="num-grid two">
              <NumField label={grid.mode === 'spacing' ? 'Gap X' : 'Offset X'} value={grid.dx} onChange={v => store.setGridPattern({ dx: v })} suffix="mm" />
              <NumField label={grid.mode === 'spacing' ? 'Gap Y' : 'Offset Y'} value={grid.dy} onChange={v => store.setGridPattern({ dy: v })} suffix="mm" />
            </div>
            <div className="direction-row">
              <span className="mini-label">DIRECTION</span>
              <div className="direction-pair">
                <button className={grid.directionX === 1 ? 'on' : ''} onClick={() => store.setGridPattern({ directionX: 1 })}><ArrowRight size={13} />+X</button>
                <button className={grid.directionX === -1 ? 'on' : ''} onClick={() => store.setGridPattern({ directionX: -1 })}><ArrowRight size={13} className="flip" />−X</button>
              </div>
              <div className="direction-pair">
                <button className={grid.directionY === 1 ? 'on' : ''} onClick={() => store.setGridPattern({ directionY: 1 })}><ArrowUp size={13} className="flip" />+Y</button>
                <button className={grid.directionY === -1 ? 'on' : ''} onClick={() => store.setGridPattern({ directionY: -1 })}><ArrowUp size={13} />−Y</button>
              </div>
            </div>
            <div className="formula-box">
              <span>P(r,c) = P₀ + c · ΔX · x̂ + r · ΔY · ŷ</span>
              <small>{grid.mode === 'spacing' ? 'ΔX = width + gap · ΔY = height + gap' : 'ΔX / ΔY measured origin to origin'}</small>
            </div>
            <button className="apply-btn" disabled={!primary || gridCount === 0} onClick={() => store.applyGridPattern()}>
              <WandSparkles size={16} />
              <span>Apply step & repeat</span>
              <kbd>{gridCount}</kbd>
            </button>
          </Section>
          <div className="pattern-detail"><Grid2X2 size={13} /><span>Copies inherit the source fill, outline, opacity, shadow and layer. The original remains untouched at the array origin.</span></div>
        </>
      ) : (
        <>
          <div className="pattern-preview radial-preview">
            <div className="radial-stage">
              <span className="radial-orbit o1" /><span className="radial-orbit o2" /><span className="radial-orbit o3" />
              <span className="radial-pivot" />
              {Array.from({ length: Math.min(16, Math.max(1, radial.copies)) }).map((_, i) => {
                const count = Math.min(16, Math.max(1, radial.copies))
                const a = ((radial.startAngle + (i + 1) * radialStep(radial.span, radial.copies)) * Math.PI) / 180
                return <span key={i} className="radial-dot" style={{ transform: `translate(${Math.cos(a) * 46}px, ${Math.sin(a) * 46}px) rotate(${radial.rotateWithShape ? (a * 180) / Math.PI : 0}deg)` }} />
              })}
              <span className="radial-center-mark">⊕</span>
            </div>
            <div className="pattern-preview-meta">
              <span className="eyebrow">POLAR ARRAY</span>
              <strong>{radial.copies} × copies</strong>
              <span>{radial.span}° span</span>
            </div>
            <span className="pattern-corner">Δθ {radialStep(radial.span, radial.copies).toFixed(1)}°</span>
          </div>

          <Section title="Circular array" action={<span className="section-hint">ROTATE</span>}>
            <div className="num-grid two">
              <NumField label="Copies" value={radial.copies} onChange={v => store.setRadialPattern({ copies: Math.max(1, Math.round(v)) })} min={1} max={72} precision={0} />
              <NumField label="Radius" value={radial.radius} onChange={v => store.setRadialPattern({ radius: Math.max(0, v) })} min={0} suffix="mm" />
            </div>
            <div className="num-grid two">
              <NumField label="Pivot X" value={radial.pivotX} onChange={v => store.setRadialPattern({ pivotX: v })} suffix="mm" />
              <NumField label="Pivot Y" value={radial.pivotY} onChange={v => store.setRadialPattern({ pivotY: v })} suffix="mm" />
            </div>
            <button className="wide-ghost" onClick={() => store.useSelectionAsRadialAnchor()}><Target size={13} />Pivot to selection centre</button>
            <div className="num-grid two">
              <NumField label="Start" value={radial.startAngle} onChange={v => store.setRadialPattern({ startAngle: v })} suffix="°" />
              <NumField label="Span" value={radial.span} onChange={v => store.setRadialPattern({ span: v })} suffix="°" />
            </div>
            <div className="field-row">
              <span>Orientation</span>
              <Segmented compact value={radial.rotateWithShape ? 'rotate' : 'upright'} onChange={v => store.setRadialPattern({ rotateWithShape: v === 'rotate' })} options={[{ value: 'rotate', label: 'Rotate' }, { value: 'upright', label: 'Upright' }]} />
            </div>
            <div className="formula-box">
              <span>Tₖ = T(pivot) · R(θ₀ + kΔθ) · T(−pivot)</span>
              <small>Δθ = Θ / {Math.abs(radial.span) >= 359.999 ? radial.copies + 1 : radial.copies} · {radial.rotateWithShape ? 'orientation follows tangent' : 'orientation locked at 0°'}</small>
            </div>
            <button className="apply-btn" disabled={!primary} onClick={() => store.applyRadialPattern()}>
              <Sparkles size={16} />
              <span>Apply radial array</span>
              <kbd>{radial.copies}</kbd>
            </button>
          </Section>
          <div className="pattern-detail"><CircleDot size={13} /><span>Rotate with shape produces tangential orientation. Upright keeps every copy at its original angle while orbiting the pivot.</span></div>
        </>
      )}
    </div>
  )
}
