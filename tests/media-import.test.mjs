import assert from 'node:assert/strict'
import {test} from 'node:test'
import {loadCore} from '../scripts/load-core.mjs'
const c=await loadCore()
const options={widthMm:7,threshold:128,invert:false,mode:'outline',spacing:1}
const bitmap=rows=>({width:rows[0].length,height:rows.length,data:rows.flatMap(row=>[...row].flatMap(p=>p==='#'?[0,0,0,255]:p==='t'?[0,0,0,0]:[255,255,255,255]))})
test('image outline preserves holes, separate islands and diagonal contacts',()=>{
  const image=bitmap(['###..##','#.#..##','###....','....#..','.....#.'])
  const shapes=c.traceBitmap(image,options)
  assert.equal(shapes[0].subpaths.length,5)
  assert.ok(shapes[0].subpaths.every(p=>p.closed&&p.nodes.length===4))
  const signedArea=sp=>sp.nodes.reduce((sum,p,i)=>{const q=sp.nodes[(i+1)%sp.nodes.length];return sum+p.x*q.y-q.x*p.y},0)/2
  assert.deepEqual(shapes[0].subpaths.map(signedArea).sort((a,b)=>a-b),[-1,1,1,4,9])
})
test('image engraving preserves white holes and uses laser-off gaps between spans',()=>{
  const image=bitmap(['###..##','#.#..##','###....'])
  const shapes=c.traceBitmap(image,{...options,mode:'engrave'})
  assert.equal(shapes[0].subpaths.length,6)
  assert.ok(shapes[0].subpaths.every(p=>!p.closed&&p.nodes.length===2))
  const doc=c.createBlankDocument();doc.layers[0].shapes=shapes
  doc.production.layers[doc.layers[0].id]=c.defaultLayerOperation('engrave')
  const job=c.getProductionJob(doc)
  assert.deepEqual(job.errors,[]);assert.equal(job.paths.length,6)
  assert.equal(job.hatchCount,6);assert.equal(job.contourCount,0)
  assert.equal(job.totalLength,12)
  const bytes=c.buildJobRD(doc), decoded=c.parseRD(bytes)
  assert.equal(decoded.shapes.flatMap(s=>s.subpaths).length,6)
})
test('image alpha and inversion leave transparent pixels blank',()=>{
  const image=bitmap(['#t.'])
  assert.deepEqual([...c.bitmapMask(image,128,false)],[1,0,0])
  assert.deepEqual([...c.bitmapMask(image,128,true)],[0,0,1])
  const half={width:1,height:1,data:[0,0,0,100]}
  assert.deepEqual([...c.bitmapMask(half,128,false)],[0])
})
test('physical page aspect ratio survives integer bitmap rendering dimensions',()=>{
  const shapes=c.traceBitmap(bitmap(['##','##','##']),{...options,widthMm:20,heightMm:30.5})
  const b=c.selectionBounds(shapes)
  assert.equal(b.w,20);assert.equal(b.h,30.5)
})
test('image import rejects invalid sizes, empty artwork and excessive row counts',()=>{
  const image=bitmap(['##','##'])
  for(const change of [{widthMm:NaN},{widthMm:0},{threshold:0},{mode:'engrave',spacing:0}])assert.throws(()=>c.traceBitmap(image,{...options,...change}))
  assert.throws(()=>c.traceBitmap(bitmap(['..']),options),/No dark/)
  assert.throws(()=>c.traceBitmap(image,{...options,widthMm:1000,mode:'engrave',spacing:.05}),/Too many/)
})
test('image engraving imports as Engrave with one undoable import',()=>{
  const store=new c.EditorStore();store.loadDocument(c.createBlankDocument())
  const before=store.getState().doc.layers.length
  store.importShapes(c.traceBitmap(bitmap(['##','##']),{...options,mode:'engrave'}),'image.png','engrave')
  const doc=store.getState().doc,layer=doc.layers.at(-1)
  assert.equal(doc.production.layers[layer.id].mode,'engrave')
  assert.equal(layer.shapes.length,1)
  store.undo();assert.equal(store.getState().doc.layers.length,before)
})
