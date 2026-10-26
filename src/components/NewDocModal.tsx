import { useModalFocus } from './ui'
import { useState } from 'react'
import { FilePlus2, X, Check, Grid2X2 } from 'lucide-react'
import { EditorStore } from '../core/store'
import { RUIDA_HARDWARE_LIMITS } from '../core/ruidaIO'

interface Props {
  open: boolean
  onClose: () => void
  store: EditorStore
}

interface Preset {
  id: string
  name: string
  width: number
  height: number
  desc: string
  recommended?: boolean
}

const PRESETS: Preset[] = [
  {
    id: 'ruida-bed',
    name: 'Ruida Machine Bed',
    width: RUIDA_HARDWARE_LIMITS.bedWidth,
    height: RUIDA_HARDWARE_LIMITS.bedHeight,
    desc: `${RUIDA_HARDWARE_LIMITS.bedWidth} × ${RUIDA_HARDWARE_LIMITS.bedHeight} mm · Full Machine Limit`,
    recommended: true,
  },
  {
    id: 'laser-desktop',
    name: 'Standard Laser 6040',
    width: 600,
    height: 400,
    desc: '600 × 400 mm · Medium Work Bed',
  },
  {
    id: 'a3-land',
    name: 'A3 Landscape',
    width: 420,
    height: 297,
    desc: '420 × 297 mm · Standard Blueprint',
  },
  {
    id: 'a4-port',
    name: 'A4 Standard',
    width: 210,
    height: 297,
    desc: '210 × 297 mm · Document Sheet',
  },
  {
    id: 'square-300',
    name: 'Square Tile',
    width: 300,
    height: 300,
    desc: '300 × 300 mm · Craft Sheet',
  },
]

export default function NewDocModal({ open, onClose, store }: Props) {
  const [name, setName] = useState('New Laser Project')
  const [selectedPreset, setSelectedPreset] = useState<string>('ruida-bed')
  const [width, setWidth] = useState<number>(RUIDA_HARDWARE_LIMITS.bedWidth)
  const [height, setHeight] = useState<number>(RUIDA_HARDWARE_LIMITS.bedHeight)

  const focusRef=useModalFocus(open,onClose)
  if (!open) return null

  const handleSelectPreset = (p: Preset) => {
    setSelectedPreset(p.id)
    setWidth(p.width)
    setHeight(p.height)
  }

  const handleCreate = () => {
    store.newDocument({
      name: name.trim() || 'Untitled Project',
      width: Math.max(10, width),
      height: Math.max(10, height),
      unit: 'mm',
    })
    onClose()
  }

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div ref={focusRef} role="dialog" aria-modal="true" aria-label="New document" tabIndex={-1} className="modal-card new-doc-modal" onClick={e => e.stopPropagation()}>
        <div className="modal-head">
          <div className="modal-title-row">
            <FilePlus2 size={16} className="modal-icon" />
            <h3>Create New Document</h3>
          </div>
          <button className="modal-close" onClick={onClose} aria-label="Close modal">
            <X size={15} />
          </button>
        </div>

        <div className="modal-body">
          <label className="modal-field">
            <span>DOCUMENT NAME</span>
            <input
              type="text"
              value={name}
              onChange={e => setName(e.target.value)}
              placeholder="Laser Job Name"
              autoFocus
            />
          </label>

          <div className="modal-section-title">PAGE / BED PRESETS</div>
          <div className="preset-cards-grid">
            {PRESETS.map(p => {
              const active = selectedPreset === p.id
              return (
                <button
                  key={p.id}
                  type="button"
                  className={`preset-card ${active ? 'active' : ''}`}
                  onClick={() => handleSelectPreset(p)}
                >
                  <div className="preset-card-top">
                    <strong>{p.name}</strong>
                    {p.recommended && <span className="recommended-badge">LASER</span>}
                    {active && <Check size={13} className="preset-check" />}
                  </div>
                  <span className="preset-desc">{p.desc}</span>
                </button>
              )
            })}
          </div>

          <div className="modal-section-title">CUSTOM BED DIMENSIONS</div>
          <div className="custom-dim-row">
            <label>
              <span>WIDTH</span>
              <div className="input-suffix-wrap">
                <input
                  type="number"
                  value={width}
                  onChange={e => {
                    setWidth(Math.max(10, Number(e.target.value)))
                    setSelectedPreset('custom')
                  }}
                  min={10}
                  max={2500}
                />
                <em>mm</em>
              </div>
            </label>
            <label>
              <span>HEIGHT</span>
              <div className="input-suffix-wrap">
                <input
                  type="number"
                  value={height}
                  onChange={e => {
                    setHeight(Math.max(10, Number(e.target.value)))
                    setSelectedPreset('custom')
                  }}
                  min={10}
                  max={2500}
                />
                <em>mm</em>
              </div>
            </label>
          </div>
        </div>

        <div className="modal-foot">
          <button type="button" className="modal-btn-cancel" onClick={onClose}>
            Cancel
          </button>
          <button type="button" className="modal-btn-create" onClick={handleCreate}>
            <FilePlus2 size={14} />
            <span>Create Document</span>
          </button>
        </div>
      </div>
    </div>
  )
}
