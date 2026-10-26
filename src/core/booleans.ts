/* Boolean boundaries from a split edge arrangement, preserving compound holes.
   Curves are flattened at 0.08 mm, matching the editor's polygon operation scope. */
import { Pt, Subpath, dist, flattenSubpath, makeNode, uid } from './geometry'
import { Shape, makeFill, makeShadow, makeShape, makeStroke } from './model'
export type BooleanOp = 'union' | 'subtract' | 'intersect' | 'exclude'
const cross = (a: Pt,b: Pt) => a.x*b.y-a.y*b.x
const sub = (a: Pt,b: Pt): Pt => ({x:a.x-b.x,y:a.y-b.y})
const key = (p: Pt) => `${Math.round(p.x*1e6)},${Math.round(p.y*1e6)}`
function rings(shape: Shape): Pt[][] {
  if(shape.kind==='text'||shape.clip?.length||shape.subpaths.some(s=>!s.closed))throw new Error('Boolean operations require closed, unclipped vector shapes')
  return shape.subpaths.map(s=>{
    const p=flattenSubpath(s,.08).filter((p,i,all)=>!i||dist(p,all[i-1])>1e-7)
    if(p.length>1&&dist(p[0],p[p.length-1])<1e-7)p.pop()
    return p.filter((b,i)=>{const a=p[(i+p.length-1)%p.length],c=p[(i+1)%p.length];return Math.abs(cross(sub(b,a),sub(c,b)))>1e-8})
  }).filter(p=>p.length>=3)
}
function inside(pt: Pt, polygons: Pt[][], rule: CanvasFillRule): boolean {
  let winding=0
  for(const p of polygons)for(let i=0;i<p.length;i++){
    const a=p[i],b=p[(i+1)%p.length]
    if((a.y<=pt.y&&b.y>pt.y)||(b.y<=pt.y&&a.y>pt.y)){
      const x=a.x+(b.x-a.x)*(pt.y-a.y)/(b.y-a.y)
      if(x>pt.x)winding+=b.y>a.y?1:-1
    }
  }
  return rule==='evenodd'?Math.abs(winding)%2===1:winding!==0
}
interface Edge {a:Pt;b:Pt;cuts:number[]}
function boundaries(a: Pt[][], b: Pt[][], ruleA: CanvasFillRule, ruleB: CanvasFillRule, op: BooleanOp): Pt[][] {
  const edges:Edge[]=[...a,...b].flatMap(p=>p.map((v,i)=>({a:v,b:p[(i+1)%p.length],cuts:[0,1]})))
  if(edges.length>4000)throw new Error('Boolean geometry is too complex; simplify the paths first')
  const add=(e:Edge,t:number)=>{if(t>=-1e-9&&t<=1+1e-9)e.cuts.push(Math.min(1,Math.max(0,t)))}
  for(let i=0;i<edges.length;i++)for(let j=i+1;j<edges.length;j++){
    const e=edges[i],f=edges[j],r=sub(e.b,e.a),s=sub(f.b,f.a),q=sub(f.a,e.a),den=cross(r,s)
    if(Math.abs(den)>1e-10){
      const t=cross(q,s)/den,u=cross(q,r)/den
      if(t>=-1e-9&&t<=1+1e-9&&u>=-1e-9&&u<=1+1e-9){add(e,t);add(f,u)}
    }else if(Math.abs(cross(q,r))<1e-8){
      const rr=r.x*r.x+r.y*r.y,ss=s.x*s.x+s.y*s.y
      if(rr)for(const p of [f.a,f.b])add(e,((p.x-e.a.x)*r.x+(p.y-e.a.y)*r.y)/rr)
      if(ss)for(const p of [e.a,e.b])add(f,((p.x-f.a.x)*s.x+(p.y-f.a.y)*s.y)/ss)
    }
  }
  const filled=(p:Pt)=>{
    const A=inside(p,a,ruleA),B=inside(p,b,ruleB)
    return op==='union'?A||B:op==='intersect'?A&&B:op==='subtract'?A&&!B:A!==B
  }
  const segments=new Map<string,{a:Pt;b:Pt;used:boolean}>()
  for(const e of edges){
    const cuts=[...new Set(e.cuts)].sort((a,b)=>a-b),delta=sub(e.b,e.a)
    for(let i=1;i<cuts.length;i++){
      const from={x:e.a.x+delta.x*cuts[i-1],y:e.a.y+delta.y*cuts[i-1]},to={x:e.a.x+delta.x*cuts[i],y:e.a.y+delta.y*cuts[i]}
      const length=dist(from,to);if(length<1e-7)continue
      const m={x:(from.x+to.x)/2,y:(from.y+to.y)/2},eps=Math.min(1e-5,length*1e-4)
      const n={x:-(to.y-from.y)/length*eps,y:(to.x-from.x)/length*eps}
      const left=filled({x:m.x+n.x,y:m.y+n.y}),right=filled({x:m.x-n.x,y:m.y-n.y})
      if(left===right)continue
      const s=left?{a:from,b:to,used:false}:{a:to,b:from,used:false}
      segments.set(`${key(s.a)}>${key(s.b)}`,s)
    }
  }
  const outgoing=new Map<string,typeof segments extends Map<string,infer T>?T[]:never>()
  for(const s of segments.values()){const k=key(s.a);outgoing.set(k,[...(outgoing.get(k)??[]),s])}
  const result:Pt[][]=[]
  for(const seed of segments.values()){
    if(seed.used)continue
    const poly:Pt[]=[];let current=seed,closed=false
    for(let guard=0;guard<=segments.size;guard++){
      current.used=true;poly.push(current.a)
      if(key(current.b)===key(seed.a)){closed=true;break}
      const candidates=(outgoing.get(key(current.b))??[]).filter(s=>!s.used)
      if(!candidates.length)break
      const incoming=sub(current.b,current.a)
      // At a touching vertex, follow the greatest left turn to keep filled area
      // on the left without joining two otherwise disjoint loops.
      candidates.sort((u,v)=>{
        const du=sub(u.b,u.a),dv=sub(v.b,v.a)
        return Math.atan2(cross(incoming,dv),incoming.x*dv.x+incoming.y*dv.y)-Math.atan2(cross(incoming,du),incoming.x*du.x+incoming.y*du.y)
      })
      current=candidates[0]
    }
    if(!closed)throw new Error('Boolean boundary could not be resolved; original artwork was preserved')
    if(poly.length>=3)result.push(poly)
  }
  return result
}
export function booleanTwoShapes(shapeA: Shape, shapeB: Shape, op: BooleanOp): Shape {
  const polys=boundaries(rings(shapeA),rings(shapeB),shapeA.fillRule,shapeB.fillRule,op)
  const subpaths:Subpath[]=polys.map(points=>({id:uid('sp'),closed:true,nodes:points.map(p=>makeNode(p.x,p.y))}))
  return makeShape('path',subpaths,{name:`${op} (${shapeA.name}, ${shapeB.name})`,fillRule:'evenodd',opacity:shapeA.opacity,
    fill:makeFill(shapeA.fill.type!=='none'?shapeA.fill:shapeB.fill),stroke:makeStroke(shapeA.stroke),shadow:makeShadow(shapeA.shadow)})
}
export function booleanMultipleShapes(shapes: Shape[], op: BooleanOp): Shape|null {
  if(!shapes.length)return null
  return shapes.slice(1).reduce((a,b)=>booleanTwoShapes(a,b,op),shapes[0])
}
