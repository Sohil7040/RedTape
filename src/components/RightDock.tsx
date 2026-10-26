import { Grid2X2, Magnet, PanelRightClose, SlidersHorizontal, Zap } from 'lucide-react'
import { EditorState, EditorStore, PanelTab } from '../core/store'
import DesignPanel from './panels/DesignPanel'
import SnapPanel from './panels/SnapPanel'
import PatternsPanel from './panels/PatternsPanel'
import ProductionPanel from './panels/ProductionPanel'

interface Props { state: EditorState; store: EditorStore }

const tabs: { id: PanelTab; label: string; icon: typeof SlidersHorizontal }[] = [
  { id: 'design', label: 'Design', icon: SlidersHorizontal },
  { id: 'snap', label: 'Snap', icon: Magnet },
  { id: 'patterns', label: 'Patterns', icon: Grid2X2 },
  { id: 'production', label: 'Laser', icon: Zap },
]

export default function RightDock({ state, store }: Props) {
  return (
    <aside className={`right-dock ${state.rightOpen ? '' : 'collapsed'}`}>
      <div className="dock-head right">
        <div>
          <span className="eyebrow">INSPECTOR</span>
          <h2>{state.rightTab === 'design' ? 'Properties' : state.rightTab === 'snap' ? 'Snapping' : state.rightTab === 'production' ? 'Laser Job' : 'Patterns'}</h2>
        </div>
        <button className="dock-collapse" onClick={() => store.toggleRight()} title="Hide inspector"><PanelRightClose size={14} /></button>
      </div>
      <div className="right-tabs">
        {tabs.map(t => {
          const Icon = t.icon
          return (
            <button key={t.id} className={state.rightTab === t.id ? 'on' : ''} onClick={() => store.setRightTab(t.id)}>
              <Icon size={14} /><span>{t.label}</span>
              {t.id === 'snap' && <i className={`tab-led ${state.doc.snap.enabled ? 'on' : ''}`} />}
            </button>
          )
        })}
      </div>
      <div className="right-body scroll">
        {state.rightTab === 'design' && <DesignPanel state={state} store={store} />}
        {state.rightTab === 'snap' && <SnapPanel state={state} store={store} />}
        {state.rightTab === 'patterns' && <PatternsPanel state={state} store={store} />}
        {state.rightTab === 'production' && <ProductionPanel state={state} store={store} />}
      </div>
      <div className="right-foot">
        <span>{state.selection.length ? `${state.selection.length} OBJ SELECTED` : 'ARTBOARD'}</span>
        <span className={`right-foot-dot ${state.doc.production.preview ? 'live' : ''}`} />
        <span>{state.doc.production.preview ? 'LASER PREVIEW' : 'CORE ENGINE 1.0'}</span>
      </div>
    </aside>
  )
}
