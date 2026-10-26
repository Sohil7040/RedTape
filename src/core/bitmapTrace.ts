import { makeNode, Subpath, uid } from './geometry'
import { makeFill, makeShape, makeStroke, Shape } from './model'

export interface BitmapPixels { width: number; height: number; data: ArrayLike<number> }
export interface TraceOptions { widthMm: number; heightMm?: number; threshold: number; invert: boolean; mode: 'outline' | 'engrave'; spacing: number }
const MAX_POINTS = 80000

/** Threshold against white, including alpha, so transparent backgrounds never burn. */
export function bitmapMask(image: BitmapPixels, threshold: number, invert: boolean): Uint8Array {
  const {width, height, data} = image
  if (!Number.isInteger(width) || !Number.isInteger(height) || width < 1 || height < 1 || width*height > 1048576 || data.length !== width*height*4) throw new Error('Invalid or oversized trace bitmap')
  if (!Number.isFinite(threshold) || threshold < 1 || threshold > 255) throw new Error('Threshold must be 1–255')
  const mask = new Uint8Array(width*height)
  for (let i=0;i<mask.length;i++) {
    const alpha = data[i*4+3]/255
    const lum = .2126*data[i*4] + .7152*data[i*4+1] + .0722*data[i*4+2]
    mask[i] = alpha > 0 && (invert ? 255-lum : lum)*alpha + 255*(1-alpha) < threshold ? 1 : 0
  }
  return mask
}

/** Pixel boundaries retain separate islands and counters; no travel joins are added. */
export function traceBitmap(image: BitmapPixels, options: TraceOptions): Shape[] {
  const {width:w, height:h} = image, {widthMm, threshold, invert, mode, spacing} = options
  if (!Number.isFinite(widthMm) || widthMm <= 0 || widthMm > 3000) throw new Error('Import width must be greater than 0 and at most 3000 mm')
  if (!['outline','engrave'].includes(mode)) throw new Error('Invalid trace mode')
  if (mode === 'engrave' && (!Number.isFinite(spacing) || spacing < .05 || spacing > 10)) throw new Error('Line spacing must be 0.05–10 mm')
  const mask = bitmapMask(image, threshold, invert), scale = widthMm/w
  const heightMm=options.heightMm ?? h*scale, scaleY=heightMm/h
  if(!Number.isFinite(heightMm)||heightMm<=0||heightMm>3000)throw new Error('Import height must be greater than 0 and at most 3000 mm')
  const subpaths: Subpath[] = []
  let pointCount = 0
  const add = (points: number[][], closed: boolean) => {
    pointCount += points.length
    if (pointCount > MAX_POINTS || subpaths.length >= 10000) throw new Error('Trace is too complex. Reduce detail or use a cleaner image / wider engraving spacing.')
    subpaths.push({id:uid('sp'), closed, nodes:points.map(([x,y])=>makeNode(x*scale,y*scaleY))})
  }
  if (mode === 'engrave') {
    const rows = Math.ceil(heightMm/spacing)
    if (rows > 10000) throw new Error('Too many engraving rows. Increase line spacing.')
    for (let row=0; row<rows; row++) {
      const y = (row+.5)*spacing/scaleY
      if (y >= h) break
      const iy = Math.floor(y), spans: number[][][] = []
      for (let x=0; x<w;) {
        if (!mask[iy*w+x]) { x++; continue }
        const start=x
        while (x<w && mask[iy*w+x]) x++
        spans.push([[start,y],[x,y]])
      }
      if (row%2) { spans.reverse(); spans.forEach(span=>span.reverse()) }
      for (const span of spans) add(span,false)
    }
  } else {
    // Clockwise edges around each dark pixel. At a shared diagonal vertex,
    // taking the rightmost turn keeps touching islands as separate loops.
    const stride=w+1, edges = new Map<number, number[]>()
    const edge=(a:number,b:number)=>{ const list=edges.get(a)??[]; list.push(b); edges.set(a,list) }
    const dark=(x:number,y:number)=>x>=0&&y>=0&&x<w&&y<h&&mask[y*w+x]===1
    let edgeCount=0
    for(let y=0;y<h;y++) for(let x=0;x<w;x++) if(dark(x,y)) {
      const a=y*stride+x, b=a+1, d=a+stride, c=d+1
      if(!dark(x,y-1)){edge(a,b);edgeCount++}
      if(!dark(x+1,y)){edge(b,c);edgeCount++}
      if(!dark(x,y+1)){edge(c,d);edgeCount++}
      if(!dark(x-1,y)){edge(d,a);edgeCount++}
      if(edgeCount>MAX_POINTS*4)throw new Error('Trace is too complex. Use a cleaner image or filled engraving.')
    }
    const xy=(key:number)=>[key%stride,Math.floor(key/stride)]
    const direction=(a:number,b:number)=>{const [x,y]=xy(a),[xx,yy]=xy(b);return xx>x?0:yy>y?1:xx<x?2:3}
    while(edges.size) {
      const start=edges.keys().next().value as number
      const loop:number[]=[start]
      let at=start, previousDirection=0
      do {
        const choices=edges.get(at)
        if(!choices?.length)throw new Error('Could not close image outline')
        const priority=[1,0,3,2]
        choices.sort((a,b)=>priority.indexOf((direction(at,a)-previousDirection+4)%4)-priority.indexOf((direction(at,b)-previousDirection+4)%4))
        const next=choices.shift()!
        if(!choices.length)edges.delete(at)
        previousDirection=direction(at,next); at=next
        if(at!==start)loop.push(at)
      } while(at!==start)
      const corners=loop.filter((key,i)=>direction(loop[(i+loop.length-1)%loop.length],key)!==direction(key,loop[(i+1)%loop.length]))
      if(corners.length>=3)add(corners.map(xy),true)
    }
  }
  if(!subpaths.length)throw new Error('No dark artwork at these settings. Adjust threshold or invert.')
  return [makeShape('path',subpaths,{name:mode==='outline'?'Traced outlines':'Image engraving',
    fill:makeFill({type:'none'}),stroke:makeStroke({enabled:true,color:'#000000',width:.15}),
    meta:{importLayer:mode==='outline'?'Image outlines':'Image engraving', bitmapTrace:true, bitmapEngraving:mode==='engrave'}})]
}
