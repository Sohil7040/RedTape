import { Bounds, Pt, boundsCenter, deg, dist, rotatePoint, rotateSubpaths, translateSubpaths, uid } from './geometry'
import {
  GridPatternSettings, RadialPatternSettings, Shape, cloneShape, makeFill, makeShadow, makeStroke, shapeBounds,
} from './model'

export function gridPattern(shape: Shape, s: GridPatternSettings, selectionBounds?: Bounds): Shape[] {
  const b = selectionBounds ?? shapeBounds(shape)
  const cols = Math.max(1, Math.round(s.columns))
  const rows = Math.max(1, Math.round(s.rows))
  const stepX = s.mode === 'spacing' ? b.w + s.dx : s.dx
  const stepY = s.mode === 'spacing' ? b.h + s.dy : s.dy
  const out: Shape[] = []
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      if (r === 0 && c === 0) continue
      const copy = cloneShape(shape, s.directionX * c * stepX, s.directionY * r * stepY, `${shape.name} · ${c + 1},${r + 1}`)
      copy.meta = { ...(copy.meta ?? {}), pattern: 'grid', row: r, col: c }
      out.push(copy)
    }
  }
  return out
}

export function gridPatternCount(s: GridPatternSettings): number {
  return Math.max(1, Math.round(s.columns)) * Math.max(1, Math.round(s.rows)) - 1
}

export interface RadialLayout {
  center: Pt; pivot: Pt; radius: number; step: number; sourceOnRing: boolean; reservesSource: boolean
  placements: { center: Pt; angle: number; rotation: number }[]
}
/** One authoritative layout for creation and preview. Angles are relative to the source ray. */
export function radialLayout(bounds: Bounds, s: RadialPatternSettings): RadialLayout {
  if([s.copies,s.radius,s.startAngle,s.span,s.pivotX,s.pivotY].some(v=>!Number.isFinite(v)))throw new Error('Enter finite circular-pattern settings')
  const center=boundsCenter(bounds),pivot={x:s.pivotX,y:s.pivotY}
  const copies=Math.max(1,Math.min(72,Math.round(s.copies)))
  const distance=dist(center,pivot),radius=s.radius>0?s.radius:distance
  const base=Math.atan2(center.y-pivot.y,center.x-pivot.x)
  const offset=s.startAngle*Math.PI/180,span=Math.max(-360,Math.min(360,s.span))
  const full=Math.abs(span)>=359.999
  const sourceOnRing=radius>1e-8&&Math.abs(radius-distance)<=Math.max(1e-7,radius*1e-9)
  const zeroOffset=Math.abs(Math.sin(offset))<1e-9&&Math.cos(offset)>0
  const reservesSource=!full||(sourceOnRing&&zeroOffset)
  const step=radialStep(span,copies,reservesSource)
  const placements=Array.from({length:copies},(_,index)=>{
    const angle=s.startAngle+(index+(reservesSource?1:0))*step
    const theta=base+angle*Math.PI/180
    return {center:{x:pivot.x+Math.cos(theta)*radius,y:pivot.y+Math.sin(theta)*radius},angle:deg(theta),rotation:s.rotateWithShape?angle*Math.PI/180:0}
  })
  return {center,pivot,radius,step,sourceOnRing,reservesSource,placements}
}

export function radialPattern(shape: Shape, s: RadialPatternSettings, selectionBounds?: Bounds): Shape[] {
  const layout=radialLayout(selectionBounds??shapeBounds(shape),s),center=layout.center
  return layout.placements.map((placement,index)=>{
    const {center:target,rotation:orientation}=placement
    const move=(paths:typeof shape.subpaths)=>translateSubpaths(orientation?rotateSubpaths(paths,center,orientation):paths,target.x-center.x,target.y-center.y)
    const copy=cloneShape(shape,0,0,`${shape.name} · ${String(index+2).padStart(2,'0')}`)
    copy.subpaths=move(shape.subpaths)
    if(shape.clip)copy.clip=move(shape.clip)
    if(copy.text){
      const box=copy.text.box,boxCenter=rotatePoint(boundsCenter(box),center,orientation)
      copy.text={...copy.text,box:{...box,x:boxCenter.x-box.w/2+target.x-center.x,y:boxCenter.y-box.h/2+target.y-center.y},rotation:(shape.text?.rotation??0)+orientation}
    }
    copy.meta={...(shape.meta??{}),pattern:'radial',copy:index+1,angle:placement.angle*Math.PI/180}
    return copy
  })
}

export function radialPreviewCenters(self: Shape, s: RadialPatternSettings, selectionBounds?: Bounds): { center: Pt; angle: number }[] {
  return radialLayout(selectionBounds??shapeBounds(self),s).placements.map(({center,angle})=>({center,angle}))
}

export function radialStep(span: number, copies: number, reserveSource = true): number {
  const n=Math.max(1,Math.min(72,Math.round(copies))),angle=Math.max(-360,Math.min(360,span))
  return Math.abs(angle)>=359.999?angle/(n+(reserveSource?1:0)):angle/n
}
