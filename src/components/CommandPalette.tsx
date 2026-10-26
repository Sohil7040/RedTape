import { useEffect, useRef, useState } from 'react'
import { Search, X } from 'lucide-react'
import { EditorStore } from '../core/store'
import { exportProject, exportSVG, exportPNG } from '../core/exporters'

export default function CommandPalette({store,onClose}:{store:EditorStore;onClose:()=>void}) {
  const [query,setQuery]=useState('')
  const dialog=useRef<HTMLDialogElement>(null)
  useEffect(()=>{ const el=dialog.current;el?.showModal();return()=>el?.close() },[])
  const commands=[
    {name:'Design workspace',run:()=>store.setWorkflow('design')},
    {name:'Laser operations and material presets',run:()=>store.setWorkflow('laser')},
    {name:'Preview job and simulation',run:()=>store.setWorkflow('preview')},
    {name:'Connection and upload review',run:()=>{store.setWorkflow('preview');store.setProductionTab('machine')}},
    {name:'Machine exports — RD, DXF, PLT, job JSON',run:()=>{store.setWorkflow('preview');store.setProductionTab('output')}},
    {name:'Import vectors, image or PDF',run:()=>document.getElementById('job-import')?.click()},
    {name:'Save portable Corelith project',run:()=>exportProject(store.getState().doc)},
    {name:'Export SVG artwork',run:()=>exportSVG(store.getState())},
    {name:'Export PNG artwork at 300 DPI',run:()=>{void exportPNG(store.getState()).catch(e=>store.toast(e.message,'warn'))}},
    {name:'Fit Sheet',run:()=>store.fitPage()},
    {name:'Fit Selection',run:()=>store.fitArtwork('selection')},
    {name:'Fit All Artwork',run:()=>store.fitArtwork('all')},
    {name:'Actual size',run:()=>store.zoomActual()},
    {name:'Snapping settings and guides',run:()=>store.setRightTab('snap')},
    {name:'Rectangular pattern',run:()=>store.openPatterns('grid')},
    {name:'Circular pattern',run:()=>store.openPatterns('radial')},
    {name:'Knife tool',run:()=>{store.setWorkflow('design');store.setTool('knife')}},
    {name:'Node editor (F10)',run:()=>{store.setWorkflow('design');store.setTool('node')}},
    {name:'Convert selected text to curves',run:()=>void store.convertTextToCurves('selection')},
    {name:'Toggle Objects panel',run:()=>store.toggleLeft()},
    {name:'Toggle Inspector',run:()=>store.toggleRight()},
    {name:'Toggle light / dark theme',run:()=>store.setTheme(store.getState().theme==='light'?'dark':'light')},
  ].filter(c=>c.name.toLowerCase().includes(query.toLowerCase()))
  const run=(fn:()=>void)=>{onClose();fn()}
  return <dialog ref={dialog} className="command-dialog" aria-label="Search commands" onCancel={onClose} onClick={e=>{if(e.target===dialog.current)onClose()}}>
    <div className="command-search"><Search size={18}/><input autoFocus aria-label="Search commands" placeholder="Search tools, settings and actions…" value={query} onChange={e=>setQuery(e.target.value)} onKeyDown={e=>{if(e.key==='Enter'&&commands[0]){e.preventDefault();run(commands[0].run)}}}/><button aria-label="Close command palette" onClick={onClose}><X size={18}/></button></div>
    <div className="command-results">{commands.map(c=><button key={c.name} onClick={()=>run(c.run)}>{c.name}<span>↵</span></button>)}{!commands.length&&<p>No matching commands.</p>}</div>
    <footer>Tab to choose · Enter to run · Esc to close</footer>
  </dialog>
}
