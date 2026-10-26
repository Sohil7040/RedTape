/**
 * Small portable reconstructions from the supplied native binaries.
 * These are verified arithmetic routines, not the original source project.
 * Hashes, addresses and REA records: docs/RDWORKS_REVERSE_ENGINEERING.md.
 */

// Corel CDRCRV.dll, double-coordinate evaluator at 0x180018f90.
export function corelCubicCoordinate(p0:number,p1:number,p2:number,p3:number,t:number):number {
  // Preserve exact editor endpoints; the interior follows the recovered Horner form.
  if(t===0)return p0
  if(t===1)return p3
  return (((p3-3*(p2-p1)-p0)*t+3*(p2-2*p1+p0))*t+3*(p1-p0))*t+p0
}

// RDWorks ExMath.dll::_math_elli2bezier at 0x100080e0.
export const RDWORKS_ELLIPSE_FACTOR = .2761423749154
export function rdworksEllipseControlPoints(x0:number,y0:number,x1:number,y1:number):{x:number;y:number}[] {
  const dx=Math.abs(x1-x0)*RDWORKS_ELLIPSE_FACTOR,dy=Math.abs(y1-y0)*RDWORKS_ELLIPSE_FACTOR
  const cx=(x1+x0)*.5,cy=(y0+y1)*.5
  return [[x0,cy],[x0,cy+dy],[cx-dx,y1],[cx,y1],[cx+dx,y1],[x1,cy+dy],
    [x1,cy],[x1,cy-dy],[cx+dx,y0],[cx,y0],[cx-dx,y0],[x0,cy-dy],[x0,cy]].map(([x,y])=>({x,y}))
}
