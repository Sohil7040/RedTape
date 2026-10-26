import {useEffect,useRef} from 'react'
import {X,Download} from 'lucide-react'
import {EditorState,EditorStore} from '../core/store'
import {exportPNG,exportSVG,exportProject,downloadBlob} from '../core/exporters'
import {buildJobDXF,buildJobPLT,buildJobJSON} from '../core/vectorIO'
import {prepareLaserJob,loadMachineProfile,machineOrientationIssue} from '../core/laserClient'
export default function ExportDialog({state,store,onClose}:{state:EditorState;store:EditorStore;onClose:()=>void}) {
  const ref=useRef<HTMLDialogElement>(null)
  useEffect(()=>{const el=ref.current;el?.showModal();return()=>el?.close()},[])
  const profile=loadMachineProfile()
  const orientationIssue=machineOrientationIssue(state.doc,profile)
  const prepared=prepareLaserJob(state.doc,state.doc.name,profile)
  const run=async(kind:'project'|'svg'|'png'|'rd'|'dxf'|'plt'|'json')=>{
    try {
      const name=state.doc.name.replace(/[^\w-]+/g,'-')||'corelith'
      if(kind==='project')exportProject(state.doc)
      else if(kind==='svg')exportSVG(state)
      else if(kind==='png')await exportPNG(state)
      else if(kind==='rd'){
        if(!prepared.bytes)throw Error(prepared.error??'Invalid RD job')
        downloadBlob(new Blob([prepared.bytes.buffer as ArrayBuffer],{type:'application/octet-stream'}),prepared.filename)
      } else {
        const content=kind==='dxf'?buildJobDXF(state.doc):kind==='plt'?buildJobPLT(state.doc):buildJobJSON(state.doc)
        downloadBlob(new Blob([content],{type:kind==='json'?'application/json':'text/plain'}),`${name}.${kind==='json'?'laser-job.json':kind}`)
      }
      store.toast('Export downloaded','success');onClose()
    }catch(error){store.toast(error instanceof Error?error.message:'Export failed','warn')}
  }
  return <dialog ref={ref} className="export-dialog" aria-label="Export document" onCancel={onClose}>
    <header><div><h2>Export</h2><p>{state.doc.page.name} · {state.doc.page.width} × {state.doc.page.height} mm</p></div><button aria-label="Close export dialog" onClick={onClose}><X size={18}/></button></header>
    <section><h3>Project backup</h3><button onClick={()=>void run('project')}><Download size={16}/><span><strong>Corelith project</strong><small>Editable document with sheets, layers and laser settings</small></span></button></section>
    <section><h3>Artwork — active sheet</h3><div className="export-choices"><button onClick={()=>void run('svg')}>SVG vector artwork</button><button onClick={()=>void run('png')}>PNG · 300 DPI</button></div></section>
    <section><h3>Manufacturing — generated job</h3><div className="export-choices">{(['rd','dxf','plt','json'] as const).map(kind=><button disabled={kind==='rd'&&!!prepared.error} key={kind} onClick={()=>void run(kind)}>{kind==='rd'?'Ruida .RD':kind==='json'?'Laser-job JSON':kind.toUpperCase()}</button>)}</div>{prepared.error&&<p className="export-error">RD blocked: {prepared.error}</p>}{orientationIssue&&<button onClick={()=>store.useSavedEVAHome()}>Use corrected EVA orientation</button>}<p>DXF/PLT contain generated toolpaths. Native RDWorks .RLD export is unavailable. Exporting does not upload or start a job.</p></section>
    <footer><button onClick={onClose}>Close</button></footer>
  </dialog>
}
