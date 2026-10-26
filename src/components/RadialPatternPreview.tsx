import {useMemo} from 'react'
import {EditorState,EditorStore} from '../core/store'
import {selectionBounds,shapeBounds} from '../core/model'
import {radialLayout,radialPattern} from '../core/patterns'
import {pathToSvgD,unionBounds} from '../core/geometry'
export default function RadialPatternPreview({state,store}:{state:EditorState;store:EditorStore}) {
 const preview=useMemo(()=>{
  const sources=store.getSelectedShapes()
  if(!sources.length)return null
  const bounds=selectionBounds(sources),layout=radialLayout(bounds,state.radialPattern)
  const copies=sources.flatMap(s=>radialPattern(s,state.radialPattern,bounds))
  const extent=unionBounds([bounds,...copies.map(shapeBounds),{x:layout.pivot.x-layout.radius,y:layout.pivot.y-layout.radius,w:layout.radius*2,h:layout.radius*2}])
  const pad=Math.max(extent.w,extent.h,1)*.1,w=Math.max(1,extent.w+pad*2),h=Math.max(1,extent.h+pad*2)
  const outside=copies.filter(s=>{const b=shapeBounds(s);return b.x<0||b.y<0||b.x+b.w>state.doc.page.width||b.y+b.h>state.doc.page.height}).length
  return {sources,copies,layout,extent,pad,w,h,outside}
 },[state.doc,state.selection,state.radialPattern,store])
 if(!preview)return null
 const {sources,copies,layout,extent,pad,w,h}=preview
 const size=Math.max(w,h)/70
 return <div className="radial-geometry-preview">
  <svg role="img" aria-label={`Circular pattern geometry preview: ${copies.length} new objects`} viewBox={`${extent.x-pad} ${extent.y-pad} ${w} ${h}`}>
   <circle cx={layout.pivot.x} cy={layout.pivot.y} r={layout.radius} className="pattern-orbit"/>
   {copies.slice(0,200).map(shape=><path key={shape.id} d={pathToSvgD(shape.subpaths)} className="pattern-copy"/>)}
   {sources.map(shape=><path key={shape.id} d={pathToSvgD(shape.subpaths)} className="pattern-source"/>)}
   <path d={`M${layout.pivot.x-size},${layout.pivot.y}h${size*2}M${layout.pivot.x},${layout.pivot.y-size}v${size*2}`} className="pattern-source"/>
  </svg>
  <p><span className="pattern-source-key"/>Original · <span className="pattern-copy-key"/>New copies · + pivot</p>
  <strong>{copies.length} new objects · {layout.step.toFixed(2)}° steps</strong>
  <small>{layout.radius.toFixed(2)} mm radius{state.radialPattern.radius===0?' (from source to pivot)':''}. {Math.abs(state.radialPattern.span)<359.999?'The original stays in place; new copies follow the arc.':layout.reservesSource?'The original occupies the first position.':'New copies fill the circle; the original stays where it is.'}</small>
  {layout.radius<1e-6&&<p className="pattern-warning">Zero radius: copies overlap at the pivot. Move the pivot or enter a radius.</p>}
  {!!preview.outside&&<p className="pattern-warning">{preview.outside} new objects extend outside the active sheet.</p>}
  {copies.length>200&&<small>Showing the first 200 new objects in this outline preview.</small>}
 </div>
}
