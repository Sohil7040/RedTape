/* SVG import in millimeters. Curves, transforms and compound fills are preserved. */
import { Bounds, PathNode, Pt, Subpath, makeNode, uid, ellipseSubpaths } from './geometry'
import { Shape, makeFill, makeShape, makeStroke } from './model'
interface SvgParseResult { shapes: Shape[]; warnings: string[]; viewBox?: Bounds }
interface SvgTransform { a: number; b: number; c: number; d: number; e: number; f: number }
const identity = (): SvgTransform => ({ a: 1, b: 0, c: 0, d: 1, e: 0, f: 0 })
function multiply(t: SvgTransform, u: SvgTransform): SvgTransform {
  return { a: t.a*u.a+t.c*u.b, b: t.b*u.a+t.d*u.b, c: t.a*u.c+t.c*u.d, d: t.b*u.c+t.d*u.d,
    e: t.a*u.e+t.c*u.f+t.e, f: t.b*u.e+t.d*u.f+t.f }
}
const apply = (p: Pt, t: SvgTransform): Pt => ({ x: t.a*p.x+t.c*p.y+t.e, y: t.b*p.x+t.d*p.y+t.f })
export function parseSvgTransform(str: string): SvgTransform {
  let t = identity()
  const syntax = /([a-zA-Z]+)\s*\(([^)]+)\)/g
  const matches = [...str.matchAll(syntax)]
  if (str.replace(syntax, '').replace(/[\s,]/g, '')) throw new Error('Malformed SVG transform')
  if (str.trim() && !matches.length) throw new Error('Malformed SVG transform')
  for (const m of matches) {
    const args = m[2].trim().split(/[\s,]+/).map(Number)
    if (args.some(n=>!Number.isFinite(n))) throw new Error('Invalid SVG transform')
    const counts: Record<string, number[]> = {matrix:[6],translate:[1,2],scale:[1,2],rotate:[1,3],skewX:[1],skewY:[1]}
    if (!counts[m[1]]?.includes(args.length)) throw new Error(`Malformed SVG transform: ${m[1]}`)
    const u = identity(), rad = args[0]*Math.PI/180
    if (m[1]==='matrix' && args.length===6) [u.a,u.b,u.c,u.d,u.e,u.f] = args
    else if (m[1]==='translate') { u.e=args[0];u.f=args[1]??0 }
    else if (m[1]==='scale') { u.a=args[0];u.d=args[1]??args[0] }
    else if (m[1]==='rotate') {
      u.a=Math.cos(rad);u.b=Math.sin(rad);u.c=-u.b;u.d=u.a
      if(args.length===3){u.e=args[1]-u.a*args[1]-u.c*args[2];u.f=args[2]-u.b*args[1]-u.d*args[2]}
    } else if(m[1]==='skewX')u.c=Math.tan(rad)
    else if(m[1]==='skewY')u.b=Math.tan(rad)
    else throw new Error(`Unsupported SVG transform: ${m[1]}`)
    t=multiply(t,u)
  }
  return t
}

// Endpoint-to-center arc conversion follows W3C SVG implementation notes.
function arcCubics(from: Pt, to: Pt, rx: number, ry: number, rotation: number, large: number, sweep: number): Pt[][] {
  rx=Math.abs(rx);ry=Math.abs(ry)
  if (!rx || !ry || (from.x===to.x && from.y===to.y)) return []
  const phi=rotation*Math.PI/180, co=Math.cos(phi), si=Math.sin(phi)
  const dx=(from.x-to.x)/2,dy=(from.y-to.y)/2
  const xp=co*dx+si*dy, yp=-si*dx+co*dy
  const lambda=xp*xp/(rx*rx)+yp*yp/(ry*ry)
  if(lambda>1){rx*=Math.sqrt(lambda);ry*=Math.sqrt(lambda)}
  const numerator=Math.max(0,rx*rx*ry*ry-rx*rx*yp*yp-ry*ry*xp*xp)
  const denom=rx*rx*yp*yp+ry*ry*xp*xp
  const factor=(large===sweep?-1:1)*Math.sqrt(denom ? numerator/denom : 0)
  const cxp=factor*rx*yp/ry,cyp=-factor*ry*xp/rx
  const cx=co*cxp-si*cyp+(from.x+to.x)/2,cy=si*cxp+co*cyp+(from.y+to.y)/2
  const start=Math.atan2((yp-cyp)/ry,(xp-cxp)/rx)
  let delta=Math.atan2((-yp-cyp)/ry,(-xp-cxp)/rx)-start
  if(!sweep && delta>0)delta-=Math.PI*2
  if(sweep && delta<0)delta+=Math.PI*2
  const count=Math.ceil(Math.abs(delta)/(Math.PI/2)), step=delta/count
  const point=(theta:number):Pt=>({x:cx+co*rx*Math.cos(theta)-si*ry*Math.sin(theta),y:cy+si*rx*Math.cos(theta)+co*ry*Math.sin(theta)})
  const tangent=(theta:number):Pt=>({x:-co*rx*Math.sin(theta)-si*ry*Math.cos(theta),y:-si*rx*Math.sin(theta)+co*ry*Math.cos(theta)})
  const curves:Pt[][]=[]
  for(let i=0;i<count;i++){
    const a=start+i*step,b=a+step,k=4/3*Math.tan(step/4),p=point(a),q=point(b),ta=tangent(a),tb=tangent(b)
    curves.push([{x:p.x+k*ta.x,y:p.y+k*ta.y},{x:q.x-k*tb.x,y:q.y-k*tb.y},i===count-1?to:q])
  }
  return curves
}
export function parseSvgPathD(d: string, transform: SvgTransform = identity()): Subpath[] {
  const tokenRE=/[a-zA-Z]|[-+]?(?:\d*\.\d+|\d+\.?\d*)(?:[eE][-+]?\d+)?/g
  const tokens=d.match(tokenRE)??[]
  if(tokens.length && !/^[mM]$/.test(tokens[0] ?? ''))throw new Error('SVG path must begin with M')
  if(d.replace(tokenRE,'').replace(/[\s,]/g,''))throw new Error('Invalid SVG path syntax')
  const result:Subpath[]=[]
  let nodes:PathNode[]=[],i=0,cmd='',previous='',cur:Pt={x:0,y:0},start=cur,cp:Pt=cur
  const flush=(closed=false)=>{
    if(closed && nodes.length>1){const a=nodes[0],b=nodes[nodes.length-1];if(Math.hypot(a.x-b.x,a.y-b.y)<1e-9){a.in=b.in;nodes.pop()}}
    if(nodes.length)result.push({id:uid('sp'),closed,nodes})
    nodes=[]
  }
  const read=()=>{if(i>=tokens.length||/^[a-z]$/i.test(tokens[i]))throw new Error(`Missing coordinates for SVG ${cmd}`);const n=Number(tokens[i++]);if(!Number.isFinite(n))throw new Error('Invalid SVG coordinate');return n}
  const add=(p:Pt)=>{const q=apply(p,transform);nodes.push(makeNode(q.x,q.y));cur=p}
  const cubic=(c1:Pt,c2:Pt,end:Pt)=>{if(!nodes.length)throw new Error('SVG path must begin with M');nodes[nodes.length-1].out=apply(c1,transform);add(end);nodes[nodes.length-1].in=apply(c2,transform)}
  while(i<tokens.length){
    if(/^[a-z]$/i.test(tokens[i]))cmd=tokens[i++]
    if(!cmd)throw new Error('SVG path must begin with M')
    const upper=cmd.toUpperCase(),relative=cmd!==upper
    if(upper==='Z'){flush(true);cur=start;previous='Z';cmd='';continue}
    if(!'MLHVCSQTA'.includes(upper))throw new Error(`Unsupported SVG path command: ${cmd}`)
    const origin={...cur}
    const point=():Pt=>{const x=read(),y=read();return{x:x+(relative?origin.x:0),y:y+(relative?origin.y:0)}}
    if(upper==='M'){const p=point();flush();add(p);start=p;cmd=relative?'l':'L'}
    else{
      if(!nodes.length)add(cur)
      if(upper==='L')add(point())
      else if(upper==='H')add({x:read()+(relative?cur.x:0),y:cur.y})
      else if(upper==='V')add({x:cur.x,y:read()+(relative?cur.y:0)})
      else if(upper==='C'){const c1=point(),c2=point(),end=point();cubic(c1,c2,end);cp=c2}
      else if(upper==='S'){const c1=['C','S'].includes(previous)?{x:2*cur.x-cp.x,y:2*cur.y-cp.y}:{...cur};const c2=point(),end=point();cubic(c1,c2,end);cp=c2}
      else if(upper==='Q'||upper==='T'){
        const q=upper==='Q'?point():['Q','T'].includes(previous)?{x:2*cur.x-cp.x,y:2*cur.y-cp.y}:{...cur}
        const end=point();cubic({x:cur.x+2/3*(q.x-cur.x),y:cur.y+2/3*(q.y-cur.y)},{x:end.x+2/3*(q.x-end.x),y:end.y+2/3*(q.y-end.y)},end);cp=q
      } else if(upper==='A'){
        const rx=read(),ry=read(),rot=read(),large=read(),sweep=read(),end=point()
        if(![0,1].includes(large)||![0,1].includes(sweep))throw new Error('SVG arc flags must be 0 or 1')
        const curves=arcCubics(cur,end,rx,ry,rot,large,sweep)
        if(curves.length)for(const [c1,c2,to] of curves)cubic(c1,c2,to)
        else if(cur.x!==end.x||cur.y!==end.y)add(end)
      }
    }
    previous=upper
  }
  flush();return result
}

export function svgLengthMm(text: string | null): number | null {
  if(!text)return null
  const match=text.trim().match(/^([-+]?(?:\d*\.\d+|\d+\.?\d*)(?:e[-+]?\d+)?)\s*(mm|cm|in|pt|pc|px)?$/i)
  if(!match)return null
  const scales:Record<string,number>={mm:1,cm:10,in:25.4,pt:25.4/72,pc:25.4/6,px:25.4/96}
  return Number(match[1])*(scales[match[2]?.toLowerCase()??'px'])
}
export function svgViewportTransform(width: string | null, height: string | null, viewBox: string | null, preserve='xMidYMid meet'): SvgTransform {
  const box=viewBox?.trim().split(/[\s,]+/).map(Number)
  if(!box || box.length!==4)return{a:25.4/96,b:0,c:0,d:25.4/96,e:0,f:0}
  const [x,y,w,h]=box
  if(!box.every(Number.isFinite)||w<=0||h<=0)throw new Error('Invalid SVG viewBox')
  const W=svgLengthMm(width)??w*25.4/96,H=svgLengthMm(height)??h*25.4/96
  if(W<=0||H<=0)throw new Error('Invalid SVG dimensions')
  let sx=W/w,sy=H/h,ox=0,oy=0
  if(!preserve.startsWith('none')){
    sx=sy=preserve.includes('slice')?Math.max(sx,sy):Math.min(sx,sy)
    ox=(W-w*sx)*(preserve.includes('xMin')?0:preserve.includes('xMax')?1:.5)
    oy=(H-h*sy)*(preserve.includes('YMin')?0:preserve.includes('YMax')?1:.5)
  }
  return{a:sx,b:0,c:0,d:sy,e:ox-x*sx,f:oy-y*sy}
}
export function parseSVG(svgText: string): SvgParseResult {
  if(typeof DOMParser==='undefined')throw new Error('SVG document import requires a browser DOM parser')
  const doc=new DOMParser().parseFromString(svgText,'image/svg+xml')
  if(doc.querySelector('parsererror'))throw new Error('Invalid SVG XML')
  const svg=doc.documentElement
  if(svg.localName!=='svg')throw new Error('SVG root element is missing')
  if(svg.querySelector('use, text, image, foreignObject, svg'))throw new Error('Convert referenced symbols, text, images or nested SVG elements to paths before importing')
  const shapes:Shape[]=[],warnings:string[]=[]
  if(svg.querySelector('style'))throw new Error('Inline SVG CSS classes into presentation attributes before importing; external/class styling is not supported.')
  const base=svgViewportTransform(svg.getAttribute('width'),svg.getAttribute('height'),svg.getAttribute('viewBox'),svg.getAttribute('preserveAspectRatio')??undefined)
  const inherited=(el:Element,attr:string,fallback:string)=>{
    let node:Element|null=el
    while(node){const value=(node as SVGElement).style?.getPropertyValue(attr)||node.getAttribute(attr);if(value)return value;node=node.parentElement}
    return fallback
  }
  for(const el of svg.querySelectorAll('path, rect, circle, ellipse, line, polygon, polyline')){
    if(el.closest('defs,clipPath,mask,pattern,marker,symbol'))continue
    if(inherited(el,'display','inline')==='none'||inherited(el,'visibility','visible')==='hidden')continue
    if(inherited(el,'clip-path','none')!=='none'||inherited(el,'mask','none')!=='none')throw new Error('Flatten SVG clipping/masks before laser import')
    let t=identity(),node:Element|null=el
    while(node){if((node as SVGElement).style?.transform)throw new Error('Convert CSS transforms to SVG transform attributes before importing');if(node.hasAttribute('transform'))t=multiply(parseSvgTransform(node.getAttribute('transform')!),t);if(node===svg)break;node=node.parentElement}
    t=multiply(base,t)
    const number=(name:string,fallback=0)=>{const text=el.getAttribute(name);if(text===null)return fallback;const n=Number(text);if(!Number.isFinite(n))throw new Error(`SVG ${name} must use numeric user units`);return n}
    let subs:Subpath[]=[]
    const tag=el.localName
    if(tag==='path')subs=parseSvgPathD(el.getAttribute('d')??'')
    else if(tag==='circle'||tag==='ellipse'){
      const rx=tag==='circle'?number('r'):number('rx'),ry=tag==='circle'?rx:number('ry')
      if(rx>0&&ry>0)subs=ellipseSubpaths(number('cx'),number('cy'),rx,ry)
    } else if(tag==='rect'){
      const x=number('x'),y=number('y'),w=number('width'),h=number('height')
      const rx=Math.min(w/2,Math.max(0,number('rx',number('ry')))),ry=Math.min(h/2,Math.max(0,number('ry',rx)))
      if(w>0&&h>0)subs=parseSvgPathD(rx&&ry?`M${x+rx} ${y}H${x+w-rx}A${rx} ${ry} 0 0 1 ${x+w} ${y+ry}V${y+h-ry}A${rx} ${ry} 0 0 1 ${x+w-rx} ${y+h}H${x+rx}A${rx} ${ry} 0 0 1 ${x} ${y+h-ry}V${y+ry}A${rx} ${ry} 0 0 1 ${x+rx} ${y}Z`:`M${x} ${y}h${w}v${h}h${-w}Z`)
    } else if(tag==='line')subs=[{id:uid('sp'),closed:false,nodes:[makeNode(number('x1'),number('y1')),makeNode(number('x2'),number('y2'))]}]
    else{
      const pts=(el.getAttribute('points')??'').trim().split(/[\s,]+/).map(Number)
      if(pts.length%2||pts.some(n=>!Number.isFinite(n)))throw new Error('Malformed SVG points')
      const nodes:PathNode[]=[];for(let i=0;i<pts.length;i+=2)nodes.push(makeNode(pts[i],pts[i+1]))
      if(nodes.length>=2)subs=[{id:uid('sp'),closed:tag==='polygon',nodes}]
    }
    for(const sub of subs)for(const n of sub.nodes){const p=apply(n,t);n.in=apply(n.in,t);n.out=apply(n.out,t);n.x=p.x;n.y=p.y}
    if(!subs.length)continue
    const fill=inherited(el,'fill','#000000'),stroke=inherited(el,'stroke','none')
    const rule=inherited(el,'fill-rule','nonzero')==='evenodd'?'evenodd':'nonzero'
    const strokeWidth=Number(inherited(el,'stroke-width','1'))*Math.sqrt(Math.abs(t.a*t.d-t.b*t.c))
    let opacity=1;node=el
    while(node){opacity*=Number((node as SVGElement).style?.opacity||node.getAttribute('opacity')||1);node=node.parentElement}
    shapes.push(makeShape('path',subs,{name:el.id||`SVG Object ${shapes.length+1}`,fillRule:rule,opacity,
      fill:makeFill({type:fill==='none'?'none':'solid',color:fill,opacity:Number(inherited(el,'fill-opacity','1'))}),
      stroke:makeStroke({enabled:stroke!=='none',color:stroke==='none'?'#000000':stroke,width:Number.isFinite(strokeWidth)?strokeWidth:.3,opacity:Number(inherited(el,'stroke-opacity','1'))})}))
  }
  return{shapes,warnings}
}
