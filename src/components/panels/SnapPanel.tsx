import {
  Circle, CircleDot, Crosshair, Diamond, Grid3X3, Magnet, Move, Ruler, Spline, Target, X, CornerDownRight,
  RotateCw, Trash2, Plus, Scan, MousePointer2,
} from 'lucide-react'
import { EditorStore, EditorState } from '../../core/store'
import { SnapSettings } from '../../core/model'
import { Section, Switch, Toggle, NumField } from '../ui'

interface Props { state: EditorState; store: EditorStore }

const options: { key: keyof SnapSettings; label: string; icon: typeof Magnet; hint: string; color: string }[] = [
  { key: 'grid', label: 'Grid', icon: Grid3X3, hint: 'Grid lines and intersections', color: '#a9b1bb' },
  { key: 'nodes', label: 'Nodes', icon: Circle, hint: 'Anchor vertices', color: '#f7f9fb' },
  { key: 'midpoints', label: 'Midpoints', icon: CircleDot, hint: 'Bézier t=0.5 and line centres', color: '#5cb8ff' },
  { key: 'centers', label: 'Centers', icon: Crosshair, hint: 'Bounding box and centroid', color: '#63e6c1' },
  { key: 'intersections', label: 'Intersect', icon: X, hint: 'Curve-curve crossing points', color: '#ff6b81' },
  { key: 'quadrants', label: 'Quadrants', icon: Diamond, hint: '0°, 90°, 180°, 270° ellipse marks', color: '#c4a2ff' },
  { key: 'guides', label: 'Guides', icon: Ruler, hint: 'Horizontal and vertical guides', color: '#7a8dff' },
  { key: 'perpendicular', label: 'Perpendicular', icon: CornerDownRight, hint: '90° projection to an edge', color: '#ff9a52' },
  { key: 'tangent', label: 'Tangent', icon: RotateCw, hint: 'Tangent points on curved edges', color: '#ffc15c' },
  { key: 'dynamicGuides', label: 'Dynamic', icon: Move, hint: 'Magnetic alignment rays', color: '#5b9fff' },
]

export default function SnapPanel({ state, store }: Props) {
  const snap = state.doc.snap
  const grid = state.doc.grid
  const guides = state.doc.guides

  return (
    <div className="inspector-stack">
      <div className={`snap-master ${snap.enabled ? 'on' : ''}`}>
        <div className="snap-master-icon"><Magnet size={20} /></div>
        <div className="snap-master-copy">
          <span className="eyebrow">OBJECTSNAPDS</span>
          <strong>{snap.enabled ? 'Snapping armed' : 'Snapping off'}</strong>
          <p>{snap.enabled ? 'Gravity filter is sampling 3D spatial index' : 'Canvas interactions are free'}</p>
        </div>
        <Switch checked={snap.enabled} onChange={v => store.setSnapSettings({ enabled: v })} />
      </div>

      <Section title="Gravity field" action={<span className="section-hint">{snap.radius} PX</span>}>
        <div className="gravity-viz">
          <span className="g-ring r1" /><span className="g-ring r2" /><span className="g-ring r3" />
          <span className="g-axis h" /><span className="g-axis v" />
          <span className="g-node a" /><span className="g-node b" /><span className="g-node c" />
          <span className="g-cursor"><MousePointer2 size={15} /></span>
          <div className="g-caption"><strong>{snap.radius}px</strong><span>SCREEN SPACE</span></div>
        </div>
        <div className="slider-field">
          <span>Radius</span>
          <input type="range" min={4} max={22} value={snap.radius} onChange={e => store.setSnapSettings({ radius: Number(e.target.value) })} />
          <span className="range-value">{snap.radius}px</span>
        </div>
        <p className="panel-note">Candidate geometry is transformed into screen space, then the nearest point within the gravity radius wins. Snap radius stays constant while zooming.</p>
      </Section>

      <Section title="Snap targets" action={<button className="link-btn" onClick={() => store.setSnapSettings({ grid: true, nodes: true, midpoints: true, centers: true, intersections: true, quadrants: true, guides: true })}>All on</button>}>
        <div className="toggle-grid">
          {options.map(o => (
            <Toggle key={o.key} icon={o.icon} label={o.label} active={!!snap[o.key]} onClick={() => store.setSnapSettings({ [o.key]: !snap[o.key] } as Partial<SnapSettings>)} hint={o.hint} />
          ))}
        </div>
        <div className="screen-tip-legend">
          <span className="eyebrow">SCREEN TIPS</span>
          {[
            ['node', '#f7f9fb'], ['midpoint', '#5cb8ff'], ['center', '#63e6c1'], ['intersection', '#ff6b81'], ['quadrant', '#c4a2ff'], ['perpendicular', '#ff9a52'],
          ].map(([label, color]) => <span key={label}><i style={{ background: color }} />{label}</span>)}
        </div>
      </Section>

      <Section title="Grid" action={<Switch checked={grid.enabled} onChange={v => store.setGrid({ enabled: v })} />}>
        <div className="num-grid two">
          <NumField label="Spacing" value={grid.size} onChange={v => store.setGrid({ size: Math.max(0.5, v) })} min={0.5} suffix="mm" />
          <NumField label="Subdiv" value={grid.subdivisions} onChange={v => store.setGrid({ subdivisions: Math.max(1, Math.round(v)) })} min={1} precision={0} />
        </div>
      </Section>

      <Section title="Guides" action={<span className="section-hint">{guides.length} SET</span>}>
        <div className="guide-list">
          {guides.length === 0 && <div className="guide-empty">Drag from a ruler to create a guide.</div>}
          {guides.map(g => (
            <div className="guide-row" key={g.id}>
              <span className={`guide-axis ${g.orientation}`}>{g.orientation === 'h' ? 'H' : 'V'}</span>
              <span>{g.position.toFixed(1)} mm</span>
              <button onClick={() => store.removeGuide(g.id)} title="Delete guide"><Trash2 size={12} /></button>
            </div>
          ))}
        </div>
        <button className="wide-ghost" onClick={() => store.addGuide('v', state.doc.page.width / 2)}><Plus size={13} />Guide at page centre</button>
        {guides.length > 0 && <button className="wide-ghost" onClick={() => store.clearGuides()}><Trash2 size={13} />Clear all guides</button>}
        <p className="panel-note">Tip: drag a guide back onto the ruler to delete it.</p>
      </Section>

      <Section title="Engine">
        <div className="engine-stats">
          <div><span>Arbiter</span><strong>Min distance</strong></div>
          <div><span>Index</span><strong>QuadTree</strong></div>
          <div><span>Transform</span><strong>Viewport 3×3</strong></div>
          <div><span>Priority</span><strong>Kind + distance</strong></div>
        </div>
        <div className="legend-line"><Target size={12} /><span>Candidates outside the radius are discarded before arbitration.</span></div>
        <div className="legend-line"><Scan size={12} /><span>Dynamic guides project full-canvas alignment rays.</span></div>
      </Section>
    </div>
  )
}
