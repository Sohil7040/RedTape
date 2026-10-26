import { EditorState, EditorStore } from '../core/store'
import { layerOperation } from '../core/model'
import { nestShapes } from '../core/production'
export default function NestingPreview({state,store}:{state:EditorState;store:EditorStore}) {
  const {doc}=state,p=doc.production
  const selected=store.getSelectedShapes().filter(s=>s.kind!=='text')
  const shapes=selected.length?selected:doc.layers.filter(l=>l.visible&&layerOperation(p,l.id).mode!=='ignore').flatMap(l=>l.shapes.filter(s=>!s.hidden&&!s.locked&&s.kind!=='text'))
  const result=nestShapes(shapes,doc.page.width,doc.page.height,p.margin,p.spacing,p.allowRotate)
  const utilization=result.placements.reduce((sum,r)=>sum+r.w*r.h,0)/(doc.page.width*doc.page.height)*100
  return <div className="nest-preview">
    <svg role="img" aria-label={`Shelf packing preview: ${result.placements.length} placed, ${result.overflow} unplaced`} viewBox={`0 0 ${doc.page.width} ${doc.page.height}`}>
      <rect width={doc.page.width} height={doc.page.height} className="nest-bed"/>
      <rect x={p.margin} y={p.margin} width={Math.max(0,doc.page.width-p.margin*2)} height={Math.max(0,doc.page.height-p.margin*2)} className="nest-margin"/>
      {result.placements.map(r=><rect key={r.shape.id} x={r.x} y={r.y} width={r.w} height={r.h} className="nest-part"><title>{r.shape.name}{r.rotated?' · rotated 90°':''}</title></rect>)}
    </svg>
    <p>{result.placements.length} placed · {result.overflow} unplaced · {utilization.toFixed(1)}% bounding-box coverage</p>
    <small>Preview uses rectangular bounds and shelf packing. Unplaced objects keep their existing positions. Text must be converted before nesting.</small>
  </div>
}
