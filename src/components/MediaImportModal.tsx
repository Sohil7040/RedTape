import { useEffect, useMemo, useRef, useState } from 'react'
import { X, ImagePlus } from 'lucide-react'
import { BitmapPixels, traceBitmap } from '../core/bitmapTrace'
import { ImportMedia, openImportMedia } from '../core/mediaImport'
import { EditorStore } from '../core/store'

export default function MediaImportModal({file,store,onClose}:{file:File;store:EditorStore;onClose:()=>void}) {
  const dialog=useRef<HTMLElement>(null)
  useEffect(()=>{const previous=document.activeElement as HTMLElement|null;dialog.current?.focus();return()=>previous?.focus()},[])
  const [media,setMedia]=useState<ImportMedia|null>(null)
  const [page,setPage]=useState(1), [loading,setLoading]=useState(true), [error,setError]=useState('')
  const [source,setSource]=useState<{pixels:BitmapPixels;preview:string;widthMm:number;heightMm:number}|null>(null)
  const [width,setWidth]=useState(100), [threshold,setThreshold]=useState(128), [invert,setInvert]=useState(false)
  const [mode,setMode]=useState<'outline'|'engrave'>('engrave'), [spacing,setSpacing]=useState(.2)
  const [showSource,setShowSource]=useState(false)
  useEffect(()=>{
    let active=true,opened:ImportMedia|null=null
    openImportMedia(file).then(result=>{opened=result;if(active)setMedia(result);else void result.close()})
      .catch(e=>{if(active){setError(String(e.message??e));setLoading(false)}})
    return ()=>{active=false;if(opened)void opened.close()}
  },[file])
  useEffect(()=>{
    if(!media)return
    let active=true
    setLoading(true);setError('');setSource(null)
    media.render(page).then(result=>{
      if(!active)return
      setSource(result)
      const bed=store.getState().doc.page
      const fit=Math.min(1,bed.width/result.widthMm,bed.height/result.heightMm)
      setWidth(Math.round(result.widthMm*fit*100)/100)
    }).catch(e=>{if(active)setError(String(e.message??e))}).finally(()=>{if(active)setLoading(false)})
    return()=>{active=false}
  },[media,page,store])
  const trace=useMemo(()=>{
    if(!source)return {shapes:[],error:''}
    try{return {shapes:traceBitmap(source.pixels,{widthMm:width,heightMm:width*source.heightMm/source.widthMm,threshold,invert,mode,spacing}),error:''}}
    catch(e){return {shapes:[],error:e instanceof Error?e.message:'Trace failed'}}
  },[source,width,threshold,invert,mode,spacing])
  const height=source?width*source.heightMm/source.widthMm:0
  const bed=store.getState().doc.page
  const sizeError=width>bed.width+.001||height>bed.height+.001?'Import size exceeds the current sheet. Reduce width.':''
  const message=error||trace.error||sizeError
  const path=trace.shapes.flatMap(s=>s.subpaths.map(sp=>sp.nodes.map((n,i)=>`${i?'L':'M'}${n.x},${n.y}`).join(' ')+(sp.closed?' Z':''))).join(' ')
  return <div className="modal-backdrop" onKeyDown={e=>{
    e.stopPropagation();if(e.key==='Escape')onClose()
    if(e.key==='Tab') {
      const controls=dialog.current?.querySelectorAll<HTMLElement>('button:not(:disabled),input:not(:disabled),select:not(:disabled)')
      if(controls?.length){const first=controls[0],last=controls[controls.length-1]
        if(e.shiftKey&&(document.activeElement===first||document.activeElement===dialog.current)){e.preventDefault();last.focus()}
        else if(!e.shiftKey&&document.activeElement===last){e.preventDefault();first.focus()}}
    }
  }}>
    <section ref={dialog} tabIndex={-1} className="media-import-modal" role="dialog" aria-modal="true" aria-labelledby="media-import-title">
      <header><div><ImagePlus size={19}/><h3 id="media-import-title">Import image / PDF</h3></div><button aria-label="Close import" onClick={onClose}><X size={19}/></button></header>
      <p className="media-filename">{file.name}</p>
      <div className="media-import-body">
        <div className="media-preview"><div className="media-preview-paper">
          {loading?<p>Rendering artwork…</p>:source&&<svg viewBox={`0 0 ${width||100} ${height||100}`} aria-label="Import preview" role="img">
            {showSource?<image href={source.preview} width={width} height={height}/>:<path d={path} fill="none" stroke="#111827" strokeWidth={mode==='engrave'?Math.max(.04,spacing*.8):Math.max(width/800,.05)} />}
          </svg>}
        </div><label><input type="checkbox" checked={showSource} onChange={e=>setShowSource(e.target.checked)}/> Show original artwork</label></div>
        <div className="media-controls">
          {!!media&&media.pages>1&&<label>PDF page<select aria-label="PDF page" value={page} onChange={e=>setPage(Number(e.target.value))}>{Array.from({length:media.pages},(_,i)=><option key={i} value={i+1}>Page {i+1} of {media.pages}</option>)}</select></label>}
          <label>Prepare as<select aria-label="Import mode" value={mode} onChange={e=>setMode(e.target.value as typeof mode)}><option value="engrave">Filled engraving · vector lines</option><option value="outline">Trace outlines · cut</option></select></label>
          <label>Width (mm)<input aria-label="Import width" type="number" min="0.01" max={bed.width} step=".1" value={width} onChange={e=>setWidth(Number(e.target.value))}/></label>
          <small>Height {height.toFixed(2)} mm · aspect ratio locked</small>
          <label>Dark threshold · {threshold}<input aria-label="Dark threshold" type="range" min="1" max="255" value={threshold} onChange={e=>setThreshold(Number(e.target.value))}/></label>
          <label className="media-checkbox"><input type="checkbox" checked={invert} onChange={e=>setInvert(e.target.checked)}/> Invert dark / light</label>
          {mode==='engrave'&&<label>Engraving line spacing (mm)<input aria-label="Engraving line spacing" type="number" min=".05" max="10" step=".05" value={spacing} onChange={e=>setSpacing(Number(e.target.value))}/></label>}
          <p className="media-note">{ /\.pdf$/i.test(file.name)?'PDF pages are rendered, then traced. Original PDF curves and layers are not preserved. ':'Images are converted into editable paths. '}Black artwork becomes laser paths; white and transparent areas stay blank. This is monochrome tracing, not grayscale photo engraving. Resolution is limited to 1024 pixels on the longest side.</p>
          <small>{trace.shapes.reduce((n,s)=>n+s.subpaths.length,0)} paths · Set layer speed and power after import.</small>
        </div>
      </div>
      {message&&<p role="alert" className="media-import-error">{message}</p>}
      <footer><button className="modal-btn-cancel" onClick={onClose}>Cancel</button><button className="modal-btn-create" disabled={loading||!!message||!trace.shapes.length} onClick={()=>{
        store.importShapes(trace.shapes,media&&media.pages>1?file.name.replace(/\.pdf$/i,`-page-${page}.pdf`):file.name,mode==='engrave'?'engrave':'cut')
        store.fitPage();onClose()
      }}>Import {mode==='engrave'?'engraving':'outlines'}</button></footer>
    </section>
  </div>
}
