import { useEffect, useRef, useState } from 'react'
import {
  ChevronDown, Download, FileImage, FileJson, FolderOpen, Grid3X3, Magnet, Minus, Redo2, RotateCcw,
  Ruler, Save, Settings2, Sparkles, Undo2, Plus, FileCode2, Info, Upload, PanelLeft, PanelRight, FilePlus2,
} from 'lucide-react'
import { EditorState, EditorStore } from '../core/store'
import { exportPNG, exportProject, exportSVG } from '../core/exporters'
import { IconButton } from './ui'

interface Props { state: EditorState; store: EditorStore; onAbout: () => void; onNewDoc: () => void }
type MenuName = 'file' | 'edit' | 'view' | null

export default function TopBar({ state, store, onAbout, onNewDoc }: Props) {
  const [menu, setMenu] = useState<MenuName>(null)
  const [zoomOpen, setZoomOpen] = useState(false)
  const [exportOpen, setExportOpen] = useState(false)
  const menuRef = useRef<HTMLDivElement>(null)
  const fileRef = useRef<HTMLInputElement>(null)
  const zoomRef = useRef<HTMLDivElement>(null)
  const exportRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const close = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) setMenu(null)
      if (zoomRef.current && !zoomRef.current.contains(e.target as Node)) setZoomOpen(false)
      if (exportRef.current && !exportRef.current.contains(e.target as Node)) setExportOpen(false)
    }
    window.addEventListener('mousedown', close)
    return () => window.removeEventListener('mousedown', close)
  }, [])

  const zoomPct = Math.round((state.view.zoom / (96 / 25.4)) * 100)
  const doc = state.doc
  const snap = doc.snap.enabled

  const savePNG = async () => {
    setMenu(null); setExportOpen(false)
    try { await exportPNG(state); store.toast('PNG exported at 300 DPI', 'success') }
    catch (err) { store.toast(err instanceof Error ? err.message : 'PNG export failed', 'warn', 6500) }
  }
  const openProject = () => fileRef.current?.click()
  const onFile = async (file: File | undefined) => {
    if (!file) return
    try {
      const raw = await file.text()
      const parsed = JSON.parse(raw)
      const loaded = parsed.doc ?? parsed
      if (!loaded?.layers || !loaded?.page) throw new Error('Invalid document')
      store.loadDocument(loaded)
      store.toast('Project opened successfully', 'success')
      setMenu(null)
    } catch (err) {
      store.toast(err instanceof Error ? err.message : 'Could not open project file', 'warn', 6000)
    }
  }

  return (
    <header className="topbar">
      <div className="brand">
        <div className="brand-mark" aria-hidden="true">
          <span className="brand-orbit" />
          <span className="brand-core" />
          <span className="brand-ray r1" /><span className="brand-ray r2" /><span className="brand-ray r3" />
        </div>
        <div className="brand-copy">
          <strong>Corelith<span className="brand-dot">.</span></strong>
          <span>VECTOR LAB</span>
        </div>
      </div>

      <div className="doc-head">
        <div className="doc-title-row">
          <input
            className="doc-name-input"
            value={doc.name}
            onChange={e => store.setDocName(e.target.value)}
            spellCheck={false}
            aria-label="Document name"
          />
          <span className="doc-badge">{doc.page.unit.toUpperCase()}</span>
          <span className="saved-chip"><i />LOCAL</span>
        </div>
        <span className="doc-meta">{doc.page.width} × {doc.page.height} mm · {doc.layers.reduce((n, l) => n + l.shapes.length, 0)} objects · {doc.layers.length} layers</span>
      </div>

      <nav className="menubar" ref={menuRef}>
        <button type="button" className={menu === 'file' ? 'on' : ''} onClick={() => setMenu(menu === 'file' ? null : 'file')}>File</button>
        <button type="button" className={menu === 'edit' ? 'on' : ''} onClick={() => setMenu(menu === 'edit' ? null : 'edit')}>Edit</button>
        <button type="button" className={menu === 'view' ? 'on' : ''} onClick={() => setMenu(menu === 'view' ? null : 'view')}>View</button>
        {menu === 'file' && (
          <div className="menu-pop">
            <button onClick={() => { onNewDoc(); setMenu(null) }}><FilePlus2 size={14} /><span>New document…</span><kbd>⌘N</kbd></button>
            <button onClick={openProject}><FolderOpen size={14} /><span>Open project…</span><kbd>⌘O</kbd></button>
            <button onClick={() => { document.getElementById('job-import')?.click(); setMenu(null) }}><Upload size={14} /><span>Import vectors / image / PDF…</span><kbd>IMPORT</kbd></button>
            <button onClick={() => { exportProject(state.doc); setMenu(null) }}><Save size={14} /><span>Save project</span><kbd>⌘S</kbd></button>
            <div className="menu-sep" />
            <button onClick={() => { store.resetDemo(); setMenu(null) }}><RotateCcw size={14} /><span>Restore showcase demo</span></button>
            <div className="menu-sep" />
            <button onClick={savePNG}><FileImage size={14} /><span>Export PNG · 300 DPI</span><kbd>PNG</kbd></button>
            <button onClick={() => { exportSVG(state); setMenu(null) }}><FileCode2 size={14} /><span>Export SVG</span></button>
            <div className="menu-sep" />
            <button onClick={() => { onAbout(); setMenu(null) }}><Info size={14} /><span>About Corelith</span></button>
            <input ref={fileRef} type="file" accept="application/json,.json" hidden onChange={e => { onFile(e.target.files?.[0]); e.currentTarget.value = '' }} />
          </div>
        )}
        {menu === 'edit' && (
          <div className="menu-pop">
            <button disabled={!store.canUndo} onClick={() => { store.undo(); setMenu(null) }}><Undo2 size={14} /><span>Undo</span><kbd>⌘Z</kbd></button>
            <button disabled={!store.canRedo} onClick={() => { store.redo(); setMenu(null) }}><Redo2 size={14} /><span>Redo</span><kbd>⇧⌘Z</kbd></button>
            <div className="menu-sep" />
            <button disabled={!state.selection.length} onClick={() => { store.duplicateSelection(); setMenu(null) }}><Plus size={14} /><span>Duplicate</span><kbd>⌘D</kbd></button>
            <button disabled={!state.selection.length} onClick={() => { store.copySelection(); setMenu(null) }}><FileJson size={14} /><span>Copy selection</span><kbd>⌘C</kbd></button>
            <button disabled={!state.selection.length} onClick={() => { store.deleteSelection(); setMenu(null) }}><Minus size={14} /><span>Delete</span><kbd>⌫</kbd></button>
            <div className="menu-sep" />
            <button onClick={() => { store.selectAll(); setMenu(null) }}><Sparkles size={14} /><span>Select all</span><kbd>⌘A</kbd></button>
          </div>
        )}
        {menu === 'view' && (
          <div className="menu-pop">
            <button onClick={() => store.fitPage()}><span>Fit page</span><kbd>0</kbd></button>
            <button onClick={() => store.zoomActual()}><span>Actual size</span><kbd>1</kbd></button>
            <button onClick={() => store.toggleLeft()}><span>{state.leftOpen ? 'Hide' : 'Show'} object panel</span></button>
            <button onClick={() => store.toggleRight()}><span>{state.rightOpen ? 'Hide' : 'Show'} inspector</span></button>
            <div className="menu-sep" />
            <button onClick={() => store.setShowRulers(!state.showRulers)}><Ruler size={14} /><span>{state.showRulers ? 'Hide' : 'Show'} rulers</span></button>
            <button onClick={() => store.setGrid({ enabled: !doc.grid.enabled })}><Grid3X3 size={14} /><span>{doc.grid.enabled ? 'Hide' : 'Show'} grid</span><kbd>G</kbd></button>
            <button onClick={() => store.toggleSnap()}><Magnet size={14} /><span>{snap ? 'Disable' : 'Enable'} snapping</span><kbd>N</kbd></button>
          </div>
        )}
      </nav>

      <div className="topbar-spacer" />

      <div className="top-actions">
        <button className={`magnet-btn ${snap ? 'on' : ''}`} onClick={() => store.toggleSnap()} title="Toggle smart snapping (N)">
          <Magnet size={15} />
          <span>{snap ? 'SNAP ON' : 'SNAP OFF'}</span>
          <i />
        </button>
        <div className="btn-divider" />
        <IconButton icon={Undo2} label="Undo (Ctrl+Z)" disabled={!store.canUndo} onClick={() => store.undo()} />
        <IconButton icon={Redo2} label="Redo (Ctrl+Shift+Z)" disabled={!store.canRedo} onClick={() => store.redo()} />
        <div className="btn-divider" />
        <div className="zoom-group" ref={zoomRef}>
          <button type="button" className="zoom-step" onClick={() => store.zoomBy(1 / 1.25)} aria-label="Zoom out"><Minus size={13} /></button>
          <button type="button" className="zoom-value" onClick={() => setZoomOpen(o => !o)}>
            {zoomPct}% <ChevronDown size={11} />
          </button>
          <button type="button" className="zoom-step" onClick={() => store.zoomBy(1.25)} aria-label="Zoom in"><Plus size={13} /></button>
          {zoomOpen && (
            <div className="menu-pop zoom-pop">
              {[25, 50, 100, 200, 400].map(z => (
                <button key={z} onClick={() => { store.setZoomAt((z / 100) * (96 / 25.4), { x: state.view.width / 2, y: state.view.height / 2 }); setZoomOpen(false) }} className={zoomPct === z ? 'selected' : ''}>{z}%</button>
              ))}
              <div className="menu-sep" />
              <button onClick={() => { store.fitPage(); setZoomOpen(false) }}>Fit page <kbd>0</kbd></button>
              <button onClick={() => { store.zoomActual(); setZoomOpen(false) }}>Actual size <kbd>1</kbd></button>
            </div>
          )}
        </div>
        <div className="btn-divider" />
        <div className="dock-toggles-group">
          <button
            type="button"
            className={`top-dock-btn ${state.leftOpen ? 'on' : ''}`}
            onClick={() => store.toggleLeft()}
            title={state.leftOpen ? 'Hide Artwork / Layers Panel ([)' : 'Show Artwork / Layers Panel ([)'}
          >
            <PanelLeft size={14} />
            <span>Layers</span>
          </button>
          <button
            type="button"
            className={`top-dock-btn ${state.rightOpen ? 'on' : ''}`}
            onClick={() => store.toggleRight()}
            title={state.rightOpen ? 'Hide Inspector / Laser CAM (])' : 'Show Inspector / Laser CAM (])'}
          >
            <PanelRight size={14} />
            <span>Inspector</span>
          </button>
        </div>
        <div className="btn-divider" />
        <div className="export-wrap" ref={exportRef}>
          <button className="export-btn" onClick={() => setExportOpen(o => !o)}>
            <Download size={14} />
            <span>Export</span>
            <ChevronDown size={11} className={exportOpen ? 'flip' : ''} />
          </button>
          {exportOpen && (
            <div className="menu-pop export-pop">
              <div className="export-pop-head">EXPORT ARTWORK</div>
              <button onClick={savePNG}><FileImage size={14} /><span>PNG · 300 DPI</span><kbd>RASTER</kbd></button>
              <button onClick={() => { exportSVG(state); setExportOpen(false); store.toast('SVG vector master exported', 'success') }}><FileCode2 size={14} /><span>SVG · vector</span><kbd>VECTOR</kbd></button>
              <div className="menu-sep" />
              <button onClick={() => { exportProject(state.doc); setExportOpen(false); store.toast('Project saved as .corelith', 'success') }}><Save size={14} /><span>Project · .corelith</span><kbd>JSON</kbd></button>
            </div>
          )}
        </div>
        <button className="settings-btn" onClick={() => store.setRightTab('design')} title="Inspector"><Settings2 size={15} /></button>
      </div>
    </header>
  )
}
