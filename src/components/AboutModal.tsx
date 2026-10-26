import { X, Orbit, Github, Sparkles } from 'lucide-react'
import { Kbd, useModalFocus } from './ui'

export default function AboutModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  const focusRef=useModalFocus(open,onClose)
  if (!open) return null
  return (
    <div className="modal-scrim" onClick={onClose}>
      <div ref={focusRef} role="dialog" aria-modal="true" aria-label="About Corelith" tabIndex={-1} className="about-modal" onClick={e => e.stopPropagation()}>
        <button aria-label="Close About" className="modal-close" onClick={onClose}><X size={16} /></button>
        <div className="about-mark"><span /><i /></div>
        <span className="eyebrow">CORELITH / CORE ALGORITHMS</span>
        <h2>A vector laboratory built on geometry.</h2>
        <p className="about-lead">An interactive study of the drawing pipeline, Bézier topology, gravity snapping, knife topology and procedural pattern engines.</p>
        <div className="about-grid">
          <div><span>Drawing</span><strong>Double precision mm · 3×3 viewport</strong></div>
          <div><span>Nodes</span><strong>Cusp · smooth · symmetric</strong></div>
          <div><span>Snapping</span><strong>8px gravity field · 9 target kinds</strong></div>
          <div><span>Knife</span><strong>Auto-close · gap · overlap</strong></div>
          <div><span>Patterns</span><strong>Cartesian & polar transforms</strong></div>
          <div><span>Laser job</span><strong>Kerf · leads · nesting · DXF/PLT</strong></div>
          <div><span>Exports</span><strong>PNG · SVG · DXF · PLT · jobs</strong></div>
        </div>
        <div className="about-shortcuts">
          <div><span>Shape tool</span><Kbd>F10</Kbd></div>
          <div><span>Pen / Knife</span><Kbd>P</Kbd><Kbd>K</Kbd></div>
          <div><span>Pan</span><Kbd>Space</Kbd></div>
          <div><span>Fit</span><Kbd>0</Kbd></div>
        </div>
        <div className="about-foot"><Orbit size={13} /><span>Clean-room UI inspired by the CorelDRAW architecture report · 2026</span><Sparkles size={13} /></div>
      </div>
    </div>
  )
}
