import {CheckCircle2} from 'lucide-react'
import {EditorState,EditorStore} from '../core/store'
import {ProductionJob} from '../core/production'
import {layerOperation} from '../core/model'
import {Section} from './ui'
export default function JobChecks({state,store,job,error}:{state:EditorState;store:EditorStore;job:ProductionJob;error:string|null}) {
 const errors=[...new Set([...(error?[error]:[]),...job.errors])]
 const issue=(message:string,severity:'error'|'warning',key:string)=>{
  const shapes=state.doc.layers.flatMap(l=>l.shapes).filter(s=>message.startsWith(`${s.name}:`))
  const layers=state.doc.layers.filter(l=>message.startsWith(`${l.name}:`))
  return <div className={`job-issue ${severity}`} key={key}><strong>{severity==='error'?'Error':'Warning'}</strong><span>{message}</span>
   {!!shapes.length&&<button className="link-btn" onClick={()=>{store.setWorkflow('design');store.setSelection(shapes.map(s=>s.id));store.fitArtwork('selection')}}>Select object</button>}
   {!!layers.length&&<button className="link-btn" onClick={()=>{store.setActiveLayer(layers[0].id);store.setWorkflow('laser')}}>Review layer</button>}
  </div>
 }
 return <Section title="Job checks" action={<span>{errors.length?'Blocked':job.warnings.length?`${job.warnings.length} warnings`:'Passed'}</span>}>
  {errors.map((e,i)=>issue(e,'error',`e${i}`))}{job.warnings.map((e,i)=>issue(e,'warning',`w${i}`))}
  {!errors.length&&<div className="job-issue success"><CheckCircle2 size={15}/><span>RD generation and preflight passed.</span></div>}
  {state.doc.layers.filter(l=>layerOperation(state.doc.production,l.id).mode==='ignore').map(l=><div className="job-issue info" key={l.id}><strong>Information</strong><span>{l.name}: {l.shapes.length} objects ignored.</span></div>)}
  {!!errors.length&&<button className="wide-ghost" onClick={()=>store.setWorkflow('laser')}>Review operations and settings</button>}
  {job.errors.some(e=>e.includes('text object'))&&<button className="wide-ghost" onClick={()=>void store.convertTextToCurves('job')}>Convert job text to curves</button>}
  <p className="panel-note">Estimates exclude acceleration, cornering and controller delays.</p>
 </Section>
}
