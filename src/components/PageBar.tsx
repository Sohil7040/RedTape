import { useState } from 'react'
import { Plus, X, Copy, Cpu, FileSpreadsheet } from 'lucide-react'
import { EditorState, EditorStore } from '../core/store'
import { isWasmActive } from '../wasm/wasmEngine'

interface Props {
  state: EditorState
  store: EditorStore
}

export default function PageBar({ state, store }: Props) {
  const [editingId, setEditingId] = useState<string | null>(null)
  const [tempName, setTempName] = useState('')
  const wasmOn = isWasmActive()

  const doc = state.doc
  const pages = doc.pages && doc.pages.length ? doc.pages : [{ ...doc.page, id: 'default-page' }]
  const activeId = doc.activePageId || pages[0]?.id

  const startRename = (id: string, name: string) => {
    setEditingId(id)
    setTempName(name)
  }

  const commitRename = (id: string) => {
    if (tempName.trim()) {
      store.renamePage(id, tempName.trim())
    }
    setEditingId(null)
  }

  return (
    <div className="page-sheet-bar">
      <div className="sheet-tabs-scroll">
        <span className="sheet-bar-label">
          <FileSpreadsheet size={12} />
          <span>SHEETS:</span>
        </span>

        {pages.map((p, idx) => {
          const isActive = p.id === activeId
          const isEditing = editingId === p.id

          return (
            <div
              key={p.id || idx}
              className={`sheet-tab ${isActive ? 'active' : ''}`}
              onClick={() => p.id && store.setActivePage(p.id)}
            >
              {isEditing ? (
                <input
                  className="sheet-rename-input"
                  value={tempName}
                  onChange={e => setTempName(e.target.value)}
                  onBlur={() => p.id && commitRename(p.id)}
                  onKeyDown={e => {
                    if (e.key === 'Enter' && p.id) commitRename(p.id)
                    if (e.key === 'Escape') setEditingId(null)
                  }}
                  autoFocus
                  onClick={e => e.stopPropagation()}
                />
              ) : (
                <span
                  className="sheet-tab-name"
                  onDoubleClick={() => p.id && startRename(p.id, p.name)}
                  title="Double click to rename"
                >
                  {p.name}
                </span>
              )}

              <span className="sheet-tab-dims">{p.width}×{p.height}</span>

              {pages.length > 1 && (
                <button
                  type="button"
                  className="sheet-tab-close"
                  onClick={e => {
                    e.stopPropagation()
                    if (p.id) store.deletePage(p.id)
                  }}
                  title="Delete sheet"
                >
                  <X size={11} />
                </button>
              )}
            </div>
          )
        })}

        <button
          type="button"
          className="add-sheet-btn"
          onClick={() => store.addPage()}
          title="Add New Sheet / Page to Document"
        >
          <Plus size={13} />
          <span>New Page</span>
        </button>
      </div>

      <div className="sheet-bar-right">
        {wasmOn && (
          <span className="wasm-pill" title="WebAssembly active: Accelerating toolpaths, cipher & hatch operations">
            <Cpu size={11} />
            <span>WASM ACCELERATED</span>
            <i className="wasm-led" />
          </span>
        )}
      </div>
    </div>
  )
}
