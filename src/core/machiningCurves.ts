import { Cubic, Pt, Subpath, dist, segments, splitCubic } from './geometry'

// Chord accuracy is separate from display flattening. The native 25 mm CIR.RD
// has ~0.0051 mm circle deviation; see docs/RDWORKS_REVERSE_ENGINEERING.md.
export const MACHINING_CHORD_ERROR_MM = 0.005
const MAX_TANGENT_ANGLE = 1.5 * Math.PI / 180
const MAX_POINTS = 100000

function distanceToSegment(p: Pt, a: Pt, b: Pt): number {
  const dx=b.x-a.x,dy=b.y-a.y,length2=dx*dx+dy*dy
  const t=length2 ? Math.max(0,Math.min(1,((p.x-a.x)*dx+(p.y-a.y)*dy)/length2)) : 0
  return Math.hypot(p.x-a.x-t*dx,p.y-a.y-t*dy)
}
function tangentAngle(a: Pt, b: Pt, chord: Pt): number {
  const tangent={x:b.x-a.x,y:b.y-a.y}
  if(Math.hypot(tangent.x,tangent.y)<1e-12)return 0
  return Math.abs(Math.atan2(tangent.x*chord.y-tangent.y*chord.x,tangent.x*chord.x+tangent.y*chord.y))
}

/** Error-bounded subdivision; never smooth intentional corners or drop short edges. */
export function flattenMachiningSubpath(sub: Subpath): Pt[] {
  if(!sub.nodes.length)return []
  const points: Pt[]=[{x:sub.nodes[0].x,y:sub.nodes[0].y}]
  const add=(p:Pt)=>{
    if(!Number.isFinite(p.x)||!Number.isFinite(p.y))throw new Error('Machining curve has invalid coordinates')
    if(dist(points[points.length-1],p)>1e-10)points.push({x:p.x,y:p.y})
    if(points.length>MAX_POINTS)throw new Error('Machining curve exceeds 100,000 points; split or simplify the source artwork')
  }
  const flatten=(c:Cubic,depth:number)=>{
    // For a cubic with endpoints on the chord, distance to the chord segment
    // is at most 3t(1-t) times the largest control-point distance (<= 3/4).
    const error=.75*Math.max(distanceToSegment(c.p1,c.p0,c.p3),distanceToSegment(c.p2,c.p0,c.p3))
    const chord={x:c.p3.x-c.p0.x,y:c.p3.y-c.p0.y}
    const angle=Math.max(tangentAngle(c.p0,c.p1,chord),tangentAngle(c.p2,c.p3,chord))
    if(error<=MACHINING_CHORD_ERROR_MM && (error<1e-10 || angle<=MAX_TANGENT_ANGLE)) {add(c.p3);return}
    if(depth>=24)throw new Error('Machining curve cannot meet the supported precision; inspect the source geometry')
    const [left,right]=splitCubic(c,.5)
    flatten(left,depth+1);flatten(right,depth+1)
  }
  for(const c of segments(sub))flatten(c,0)
  if(sub.closed&&points.length>1&&dist(points[0],points[points.length-1])<1e-10)points.pop()
  return points
}
