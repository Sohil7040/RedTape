import { useEffect, useRef, useState } from 'react'
import {
  ChevronDown, Download, FileImage, FileJson, FolderOpen, Grid3X3, Magnet, Minus, Redo2, RotateCcw,
  Moon, Sun, Search, ArrowRight, Ruler, Save, Settings2, Sparkles, Undo2, Plus, FileCode2, Info, Upload, PanelLeft, PanelRight, FilePlus2,
} from 'lucide-react'
import { EditorState, EditorStore } from '../core/store'
import { exportPNG, exportProject, exportSVG } from '../core/exporters'
import { WORKFLOWS } from '../core/workspace'
import { IconButton } from './ui'

interface Props { state: EditorState; store: EditorStore; onAbout: () => void; onNewDoc: () => void; saveStatus: string; saveError?: string; onCommands: () => void; onShortcuts: () => void; onExport: () => void }
type MenuName = 'file' | 'edit' | 'view' | null

export default function TopBar({ state, store, onAbout, onNewDoc, saveStatus, saveError, onCommands, onShortcuts, onExport }: Props) {
  const [menu, setMenu] = useState<MenuName>(null)
  const menuRef = useRef<HTMLDivElement>(null)
  const fileRef = useRef<HTMLInputElement>(null)
  const doc = state.doc, snap = doc.snap.enabled
  useEffect(() => {
    const close = (e: MouseEvent) => { if (menuRef.current && !menuRef.current.contains(e.target as Node)) setMenu(null) }
    const escape = (e: KeyboardEvent) => { if(e.key === 'Escape') setMenu(null) }
    window.addEventListener('mousedown', close); window.addEventListener('keydown', escape)
    return () => { window.removeEventListener('mousedown', close); window.removeEventListener('keydown', escape) }
  }, [])
  const savePNG = async () => {
    setMenu(null)
    try { await exportPNG(state); store.toast('PNG exported at 300 DPI', 'success') }
    catch(error) { store.toast(error instanceof Error ? error.message : 'PNG export failed', 'warn') }
  }
  const openProject = () => fileRef.current?.click()
  const onFile = async (file?: File) => {
    if (!file) return
    try {
      const parsed = JSON.parse(await file.text()), loaded = parsed.doc ?? parsed
      if (!loaded?.layers || !loaded?.page) throw new Error('Invalid Corelith project')
      store.loadDocument(loaded); store.setWorkflow('design'); setMenu(null); store.toast('Project opened', 'success')
    } catch(error) { store.toast(error instanceof Error ? error.message : 'Could not open project', 'warn') }
  }
  const next = () => {
    if (state.workflow === 'design') store.setWorkflow('laser')
    else if (state.workflow === 'laser') store.setWorkflow('preview')
    else { store.setProductionTab('machine'); requestAnimationFrame(() => document.querySelector('.right-body')?.scrollTo({ top:0 })) }
  }
  return (
    <header className="topbar">
      <div className="brand"><span className="brand-symbol" aria-hidden="true">C</span><strong>Corelith</strong></div>
      <div className="doc-head">
        <input aria-label="Document name" className="doc-name-input" value={doc.name} onChange={e => store.setDocName(e.target.value)} />
        <span className={`save-status ${saveError ? 'failed' : ''}`} role="status" title={saveError ?? 'Autosave in this browser profile; export a project for a portable backup'}>{saveStatus}</span>
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
            <button onClick={()=>{setMenu(null);onExport()}}><Download size={14}/><span>Export…</span><kbd>ART / JOB</kbd></button>
            <button onClick={() => { store.restoreAutosave(); setMenu(null) }}><RotateCcw size={14} /><span>Restore last autosave</span></button>
            <button onClick={onShortcuts}><span>Keyboard shortcuts</span><kbd>?</kbd></button>
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
            <button onClick={() => store.fitPage()}><span>Fit Sheet</span><kbd>0</kbd></button>
            <button onClick={() => store.fitArtwork('selection')}><span>Fit Selection</span></button>
            <button onClick={() => store.fitArtwork('all')}><span>Fit All Artwork</span></button>
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


      <nav className="workflow-nav" aria-label="Workspace">
        {WORKFLOWS.map((w,i) => <button key={w.id} aria-current={state.workflow === w.id ? 'page' : undefined} onClick={() => store.setWorkflow(w.id)}><span>{i+1}</span>{w.label}</button>)}
      </nav>
      <div className="top-actions">
        <IconButton icon={Undo2} label="Undo (Ctrl+Z)" disabled={!store.canUndo} onClick={() => store.undo()} />
        <IconButton icon={Redo2} label="Redo (Ctrl+Shift+Z)" disabled={!store.canRedo} onClick={() => store.redo()} />
        <IconButton icon={Search} label="Search commands (Ctrl+K)" onClick={onCommands} />
        <IconButton icon={state.theme === 'light' ? Moon : Sun} label={`Use ${state.theme === 'light' ? 'dark' : 'light'} theme`} onClick={() => store.setTheme(state.theme === 'light' ? 'dark' : 'light')} />
        <IconButton icon={PanelLeft} label="Toggle Objects panel ([)" active={state.leftOpen} onClick={() => store.toggleLeft()} />
        <IconButton icon={PanelRight} label="Toggle Inspector (])" active={state.rightOpen} onClick={() => store.toggleRight()} />
        <button className="primary-action" title={WORKFLOWS.find(w=>w.id===state.workflow)?.action} aria-label={WORKFLOWS.find(w=>w.id===state.workflow)?.action} onClick={next}><span>{WORKFLOWS.find(w=>w.id===state.workflow)?.action}</span><ArrowRight size={14} /></button>
      </div>
    </header>
  )
}
