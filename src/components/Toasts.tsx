import { CheckCircle2, Info, TriangleAlert, X } from 'lucide-react'
import { EditorState, EditorStore } from '../core/store'

export default function Toasts({ state, store }: { state: EditorState; store: EditorStore }) {
  return (
    <div className="toast-stack">
      {state.toasts.map(t => (
        <div key={t.id} className={`toast ${t.tone}`}>
          <span className="toast-icon">
            {t.tone === 'success' ? <CheckCircle2 size={15} /> : t.tone === 'warn' ? <TriangleAlert size={15} /> : <Info size={15} />}
          </span>
          <span>{t.message}</span>
          <button onClick={() => store.dismissToast(t.id)}><X size={12} /></button>
        </div>
      ))}
    </div>
  )
}
