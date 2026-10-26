import { Grid2X2, Magnet, PanelRightClose, SlidersHorizontal } from 'lucide-react'
import { EditorState, EditorStore } from '../core/store'
import DesignPanel from './panels/DesignPanel'
import SnapPanel from './panels/SnapPanel'
import PatternsPanel from './panels/PatternsPanel'
import ProductionPanel from './panels/ProductionPanel'

export default function RightDock({state,store}:{state:EditorState;store:EditorStore}) {
  const design=state.workflow==='design'
  const title=design?(state.rightTab==='snap'?'Snapping':state.rightTab==='patterns'?'Repeat artwork':state.selectedNode?'Node properties':state.selection.length?`${state.selection.length>1?'Selection':'Object'} properties`:'Sheet properties'):state.workflow==='laser'?'Laser preparation':'Preview & Send'
  return <aside className={`right-dock ${state.rightOpen?'':'collapsed'}`} aria-label="Inspector">
    <div className="dock-head right"><h2>{title}</h2><button className="dock-collapse" aria-label="Close Inspector" title="Close Inspector (])" onClick={()=>store.toggleRight()}><PanelRightClose size={16}/></button></div>
    {design&&<nav className="right-tabs" aria-label="Design inspector">
      {[{id:'design' as const,label:'Properties',icon:SlidersHorizontal},{id:'snap' as const,label:'Snapping',icon:Magnet},{id:'patterns' as const,label:'Patterns',icon:Grid2X2}].map(t=><button key={t.id} aria-pressed={state.rightTab===t.id} className={state.rightTab===t.id?'on':''} onClick={()=>store.setRightTab(t.id)}><t.icon size={14}/>{t.label}</button>)}
    </nav>}
    <div className="right-body scroll">
      <div hidden={!design||state.rightTab!=='design'}><DesignPanel state={state} store={store}/></div>
      <div hidden={!design||state.rightTab!=='snap'}><SnapPanel state={state} store={store}/></div>
      <div hidden={!design||state.rightTab!=='patterns'}><PatternsPanel state={state} store={store}/></div>
      <div hidden={design}><ProductionPanel state={state} store={store}/></div>
    </div>
  </aside>
}
