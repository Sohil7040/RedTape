import { useModalFocus } from './components/ui'
import ExportDialog from './components/ExportDialog'
import CommandPalette from './components/CommandPalette'
import { saveLocalDocument } from './core/workspace'
import { useEffect, useState } from 'react'
import { ChevronDown, Maximize2, Minus, Plus, Grid3X3, Magnet, Ruler, Keyboard, Sparkles, Zap, PanelLeftOpen, PanelRightOpen } from 'lucide-react'
import { useEditor } from './core/store'
import TopBar from './components/TopBar'
import ToolRail from './components/ToolRail'
import LeftDock from './components/LeftDock'
import RightDock from './components/RightDock'
import CanvasStage from './components/CanvasStage'
import StatusBar from './components/StatusBar'
import Toasts from './components/Toasts'
import AboutModal from './components/AboutModal'
import NewDocModal from './components/NewDocModal'
import PageBar from './components/PageBar'
import { editor } from './core/store'
import { exportProject } from './core/exporters'
import { parseVectorFile } from './core/vectorIO'
import { isMediaFile } from './core/mediaImport'
import MediaImportModal from './components/MediaImportModal'
import ToolOptions from './components/ToolOptions'

export default function App() {
  const [state, store] = useEditor()
  const [startupDocument] = useState(() => state.doc)
  const [exporting,setExporting] = useState(false)
  const [commands, setCommands] = useState(false)
  const [save, setSave] = useState<{label:string;error?:string}>({label:'Saving locally…'})
  const [about, setAbout] = useState(false)
  const [newDoc, setNewDoc] = useState(false)
  const [shortcuts, setShortcuts] = useState(false)
  const [importing, setImporting] = useState(false)
  const [mediaFile, setMediaFile] = useState<File | null>(null)

  useEffect(() => {
    let active = true
    Promise.all(['Corelith Sans', 'Corelith Serif', 'Corelith Mono'].flatMap(family =>
      [400, 700].map(weight => document.fonts.load(`${weight} 12px "${family}"`))))
      .then(() => { if (active) store.setStatus('Ready') }).catch(() => store.toast('Local fonts could not load. Text conversion will report any missing font.', 'warn'))
    return () => { active = false }
  }, [store])

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement | null
      if (commands || shortcuts || about || newDoc || exporting) return
      if (mediaFile || (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable || t.tagName === 'SELECT'))) return
      const mod = e.metaKey || e.ctrlKey
      const k = e.key.toLowerCase()
      if (mod && k === 'k') { e.preventDefault(); setCommands(true); return }
      if (mod) {
        if (k === 'z') { e.preventDefault(); if (e.shiftKey) store.redo(); else store.undo() }
        else if (k === 'y') { e.preventDefault(); store.redo() }
        else if (k === 'a') { e.preventDefault(); store.selectAll() }
        else if (k === 'c') { e.preventDefault(); store.copySelection() }
        else if (k === 'v') { e.preventDefault(); store.pasteSelection() }
        else if (k === 'd') { e.preventDefault(); if (e.shiftKey) { store.setRightTab('patterns'); store.toast('Step and Repeat · pattern engine ready', 'info') } else store.duplicateSelection() }
        else if (k === 'n') { e.preventDefault(); setNewDoc(true) }
        else if (k === 's') { e.preventDefault(); exportProject(store.getState().doc) }
        else if (k === 'l' && e.shiftKey) { e.preventDefault(); store.setWorkflow(store.getState().workflow === 'preview' ? 'design' : 'preview') }
        else if (k === 'g') { return }
        return
      }
      switch (e.key) {
        case 'F10': e.preventDefault(); store.setTool('node'); break
        case 'Escape': if (!store.getState().draft) store.clearSelection(); break
        case 'Delete':
        case 'Backspace': e.preventDefault(); store.deleteSelection(); break
        case 'ArrowLeft': e.preventDefault(); store.nudgeSelection(e.shiftKey ? -10 : -0.5, 0); break
        case 'ArrowRight': e.preventDefault(); store.nudgeSelection(e.shiftKey ? 10 : 0.5, 0); break
        case 'ArrowUp': e.preventDefault(); store.nudgeSelection(0, e.shiftKey ? -10 : -0.5); break
        case 'ArrowDown': e.preventDefault(); store.nudgeSelection(0, e.shiftKey ? 10 : 0.5); break
        case '0': e.preventDefault(); store.fitPage(); break
        case '1': e.preventDefault(); store.zoomActual(); break
        case '+':
        case '=': e.preventDefault(); store.zoomBy(1.25); break
        case '-': e.preventDefault(); store.zoomBy(1 / 1.25); break
        default:
          if (k === 'v') store.setTool('select')
          else if (k === 'p') store.setTool('pen')
          else if (k === 'k') store.setTool('knife')
          else if (k === 'r') store.setTool('rect')
          else if (k === 'e') store.setTool('ellipse')
          else if (k === 'l') store.setTool('line')
          else if (k === 'y') store.setTool('polygon')
          else if (k === 't') store.setTool('text')
          else if (k === 'h') store.setTool('hand')
          else if (k === 'z') store.setTool('zoom')
          else if (k === 'g') store.setGrid({ enabled: !store.getState().doc.grid.enabled })
          else if (k === 'n') store.toggleSnap()
          else if (k === '[') { e.preventDefault(); store.toggleLeft() }
          else if (k === ']') { e.preventDefault(); store.toggleRight() }
          else if (k === '?') setShortcuts(s => !s)
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [store, mediaFile, commands, shortcuts, about, newDoc, exporting])

  useEffect(() => {
    const query = window.matchMedia('(max-width: 980px)')
    const change = () => store.setCompactView(query.matches)
    change(); query.addEventListener('change',change)
    return () => query.removeEventListener('change',change)
  }, [store])
  useEffect(() => {
    document.documentElement.dataset.theme = state.theme
  }, [state.theme])
  useEffect(() => {
    // Opening a blank canvas must not overwrite the previous session's recovery file.
    if (state.doc === startupDocument) { setSave({label:'New document'}); return }
    setSave({label:'Saving locally…'})
    const timer = window.setTimeout(() => {
      try {
        const result = saveLocalDocument(localStorage, store.getState().doc)
        setSave(result.ok ? {label:'Saved locally'} : {label:'Save failed',error:result.error})
      } catch(error) { setSave({label:'Save failed',error:error instanceof Error ? error.message : 'Storage unavailable'}) }
    }, 900)
    return () => clearTimeout(timer)
  }, [state.doc, store, startupDocument])

  const onImportFile = async (file: File | undefined) => {
    if (!file) return
    if (isMediaFile(file.name)) { setMediaFile(file); return }
    setImporting(true)
    try {
      const arrayBuf = await file.arrayBuffer()
      const rawBytes = new Uint8Array(arrayBuf)
      const text = new TextDecoder('utf-8', { fatal: false }).decode(rawBytes)
      const result = parseVectorFile(text, file.name, store.getState().doc.page, rawBytes)
      if (!result.shapes.length) {
        store.toast(result.warnings[0] ?? 'No readable vector geometry', 'warn', 5000)
        return
      }
      if (result.bed) {
        const curPage = store.getState().doc.page
        if (curPage.width !== result.bed.width || curPage.height !== result.bed.height) {
          store.setPage({ width: result.bed.width, height: result.bed.height, name: `Ruida ${result.bed.width}×${result.bed.height}` })
        }
      }
      store.importShapes(result.shapes, file.name)
      if (result.warnings.length) {
        store.toast(result.warnings[0], 'warn', 5500)
      } else {
        store.toast(`Imported ${result.shapes.length} vector objects from ${file.name}`, 'success')
      }
    } catch (err) {
      store.toast(err instanceof Error ? err.message : 'Could not parse the vector file', 'warn', 7000)
    } finally {
      setImporting(false)
    }
  }

  return (
    <div className={`app-shell workflow-${state.workflow}`}>
      <TopBar state={state} store={store} onAbout={() => setAbout(true)} onNewDoc={() => setNewDoc(true)} saveStatus={save.label} saveError={save.error} onExport={() => setExporting(true)} onCommands={() => setCommands(true)} onShortcuts={() => setShortcuts(true)} />
      <div hidden={state.workflow !== 'design'} className="property-bar" role="toolbar" aria-label="Tool properties"><ToolOptions state={state} store={store} /></div>
      <div className={`workspace ${state.leftOpen ? 'with-left' : 'no-left'} ${state.rightOpen ? 'with-right' : 'no-right'}`}>
        <ToolRail state={state} store={store} />
        <LeftDock state={state} store={store} />
        <main className="stage-area">
          {!state.leftOpen && (
            <button
              type="button"
              className="dock-restore-tab left"
              onClick={() => store.setLeftOpen(true)}
              title="Expand Artwork & Layers Panel ([)"
            >
              <PanelLeftOpen size={14} />
              <span>LAYERS</span>
            </button>
          )}
          {!state.rightOpen && (
            <button
              type="button"
              className="dock-restore-tab right"
              onClick={() => store.setRightOpen(true)}
              title="Expand Inspector & Laser CAM Panel (])"
            >
              <span>INSPECTOR</span>
              <PanelRightOpen size={14} />
            </button>
          )}
          <CanvasStage state={state} store={store} />
          <PageBar state={state} store={store} />
          <div className="zoom-dock" aria-label="Canvas navigation">
            <button onClick={() => store.fitPage()} title="Fit Sheet (0)" aria-label="Fit Sheet"><Maximize2 size={14} /></button>
            <button onClick={() => store.fitArtwork('selection')} disabled={!state.selection.length} title="Fit Selection">Selection</button>
            <button onClick={() => store.fitArtwork('all')} title="Fit All Artwork">All</button>
            <span />
            <button onClick={() => store.zoomBy(1 / 1.25)} title="Zoom out" aria-label="Zoom out"><Minus size={13} /></button>
            <button className="zoom-num" title="Actual size (1)" onClick={() => store.zoomActual()}>{Math.round((state.view.zoom / (96 / 25.4)) * 100)}%</button>
            <button onClick={() => store.zoomBy(1.25)} title="Zoom in" aria-label="Zoom in"><Plus size={13} /></button>
          </div>
          {shortcuts && <ShortcutSheet onClose={() => setShortcuts(false)} />}
        </main>
        <RightDock state={state} store={store} />
      </div>
      <StatusBar state={state} store={store} />
      <Toasts state={state} store={store} />
      {exporting && <ExportDialog state={state} store={store} onClose={() => setExporting(false)} />}
      {commands && <CommandPalette store={store} onClose={() => setCommands(false)} />}
      <AboutModal open={about} onClose={() => setAbout(false)} />
      <NewDocModal open={newDoc} onClose={() => setNewDoc(false)} store={store} />
      <input
        id="job-import"
        type="file"
        accept=".svg,.dxf,.plt,.hpgl,.rld,.rd,.pdf,.png,.jpg,.jpeg,.webp,.bmp,.gif,image/svg+xml,application/pdf,image/png,image/jpeg,image/webp,image/bmp,image/gif,application/dxf,application/octet-stream"
        hidden
        onChange={e => { onImportFile(e.target.files?.[0]); e.currentTarget.value = '' }}
      />
      {importing && <div className="import-overlay"><span />Parsing vector job…</div>}
      {mediaFile && <MediaImportModal file={mediaFile} store={store} onClose={() => setMediaFile(null)} />}
    </div>
  )
}

function ShortcutSheet({ onClose }: { onClose: () => void }) {
  const focusRef=useModalFocus(true,onClose)
  const groups = [
    { title: 'Tools', items: [['Select', 'V'], ['Shape / nodes', 'F10'], ['Pen', 'P'], ['Knife', 'K'], ['Rectangle', 'R'], ['Ellipse', 'E'], ['Polygon', 'Y'], ['Line', 'L'], ['Text', 'T'], ['Hand', 'H']] },
    { title: 'Edit', items: [['Undo', '⌘Z'], ['Redo', '⇧⌘Z'], ['Duplicate', '⌘D'], ['Delete', '⌫'], ['Nudge', '← ↑ → ↓'], ['Snap toggle', 'N'], ['Grid', 'G']] },
    { title: 'View', items: [['Fit page', '0'], ['Actual size', '1'], ['Zoom', '+ / −'], ['Pan', 'Space'], ['Laser preview', '⇧⌘L'], ['Commit draft', 'Enter'], ['Cancel', 'Esc']] },
  ]
  return (
    <div className="shortcut-sheet" onClick={onClose}>
      <div ref={focusRef} role="dialog" aria-modal="true" aria-label="Keyboard shortcuts" tabIndex={-1} className="shortcut-inner" onClick={e => e.stopPropagation()}>
        <div className="shortcut-head"><span className="eyebrow">QUICK REFERENCE</span><h3>Keyboard map</h3><button aria-label="Close shortcuts" onClick={onClose}>×</button></div>
        {groups.map(g => (
          <div className="shortcut-group" key={g.title}>
            <h4>{g.title}</h4>
            {g.items.map(([label, key]) => <div className="shortcut-item" key={label}><span>{label}</span><kbd>{key}</kbd></div>)}
          </div>
        ))}
      </div>
    </div>
  )
}

void editor
