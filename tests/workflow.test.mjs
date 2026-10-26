import assert from 'node:assert/strict'
import { test } from 'node:test'
import fs from 'node:fs'
import path from 'node:path'
import { EventEmitter } from 'node:events'
import { tmpdir } from 'node:os'
import opentype from 'opentype.js'
import { loadCore } from '../scripts/load-core.mjs'
import { createDesktopHandler } from '../server/desktopServer.mjs'
import { inspectRDSettings } from '../scripts/inspect-rd-settings.mjs'
const c = await loadCore()
const fontFile = fs.readFileSync(new URL('../public/fonts/LiberationSans-Bold.ttf', import.meta.url))
const font = opentype.parse(fontFile.buffer.slice(fontFile.byteOffset, fontFile.byteOffset + fontFile.byteLength))
const near = (a, b, eps = .002) => assert.ok(Math.abs(a-b) < eps, `${a} vs ${b}`)

test('changing to Score preserves entered parameters and exports 200 mm/s, 12% in header and body', () => {
  const doc=c.createBlankDocument(),score=doc.layers[0],cut=c.makeLayer('Cut','#ff0000')
  score.name='Score';score.shapes=[c.createLineShape({x:20,y:20},{x:30,y:20})]
  cut.shapes=[c.createRectShape(15,15,30,30)];doc.layers.push(cut)
  doc.production.layers[cut.id]={...c.defaultLayerOperation(),speed:25,minPower:30,maxPower:50,power:50}
  const store=new c.EditorStore();store.loadDocument(doc)
  store.setLayerOperation(score.id,{speed:200,minPower:12,maxPower:12,power:12,passes:1,blower:false})
  store.setLayerMode(score.id,'score')
  const op=c.layerOperation(store.getState().doc.production,score.id)
  assert.equal(op.speed,200);assert.equal(op.minPower,12);assert.equal(op.maxPower,12);assert.equal(op.blower,false)
  const decoded=inspectRDSettings(c.buildJobRD(store.getState().doc))
  for(const group of [decoded.headers,decoded.runtime]) {
    assert.equal(group[0].speed,200);near(group[0].minPower,12,.004);near(group[0].maxPower,12,.004)
    assert.equal(group[1].speed,25);near(group[1].minPower,30,.004);near(group[1].maxPower,50,.004)
  }
  assert.equal(decoded.runtime[0].airAssist,false);assert.equal(decoded.runtime[1].airAssist,true)
  store.setLayerMode(score.id,'cut');assert.equal(c.layerOperation(store.getState().doc.production,score.id).speed,200)
})
test('actual KEYCHAIN controller readback records the hidden 1% score minimum', () => {
  const file=fs.readFileSync(new URL('./fixtures/controller/2026-10-26/KEYCHAIN.RD',import.meta.url))
  const decoded=inspectRDSettings(file)
  for(const group of [decoded.headers,decoded.runtime]) {
    assert.equal(group[0].speed,200);near(group[0].minPower,1,.004);near(group[0].maxPower,12,.004)
  }
  assert.equal(decoded.inlinePowerOverrides.length,0)
})
test('generated layer settings agree with the supplied native PRL reference', () => {
  const native=inspectRDSettings(fs.readFileSync(new URL('./fixtures/controller/2026-10-26/PRL.RD',import.meta.url)))
  const doc=c.createBlankDocument(),score=doc.layers[0],cut=c.makeLayer('Cut','#ff0000')
  score.shapes=[c.createLineShape({x:20,y:20},{x:30,y:20})];cut.shapes=[c.createRectShape(15,15,30,30)];doc.layers.push(cut)
  doc.production.layers[score.id]={...c.defaultLayerOperation('score'),speed:100,power:20,minPower:20,maxPower:20}
  doc.production.layers[cut.id]={...c.defaultLayerOperation('cut'),speed:15,power:70,minPower:70,maxPower:70}
  const generated=inspectRDSettings(c.buildJobRD(doc))
  for(const type of ['headers','runtime']) for(let i=0;i<2;i++) {
    assert.equal(native[type][i].speed,generated[type][i].speed)
    near(native[type][i].minPower,generated[type][i].minPower,.01)
    near(native[type][i].maxPower,generated[type][i].maxPower,.01)
  }
})

test('contour-only default ignores saved leads and exports only the contour', () => {
  const doc=c.createBlankDocument();doc.production.kerf=0
  assert.equal(doc.production.leadMode,'contour-only');assert.equal(doc.production.leadIn,0)
  doc.layers[0].shapes=[c.createRectShape(20,20,20,20)]
  delete doc.production.leadMode;doc.production.leadIn=5;doc.production.leadOut=3
  const job=c.buildProductionJob(doc),path=job.paths[0]
  assert.deepEqual(path.leadIn,[]);assert.deepEqual(path.leadOut,[])
  near(path.length,80);near(job.bounds.w,20);near(job.bounds.h,20)
  const points=c.toolpathPoints(path)
  assert.deepEqual(points[0],path.points[0]);assert.deepEqual(points.at(-1),path.points[0])
  const imported=c.parseRD(c.buildJobRD(doc))
  const bounds=c.selectionBounds(imported.shapes)
  near(bounds.w,20);near(bounds.h,20)
})
test('rapid optimization chooses a nearby existing closed-contour vertex without changing the cut', () => {
  const doc=c.createBlankDocument();doc.production.kerf=0;doc.production.startX=100;doc.production.startY=20
  doc.layers[0].shapes=[c.createRectShape(20,20,20,20)]
  const optimized=c.buildProductionJob(doc)
  assert.deepEqual(optimized.paths[0].points[0],{x:40,y:20})
  near(optimized.paths[0].length,80);near(optimized.rapidLength,60)
  doc.production.optimizeOrder=false
  const original=c.buildProductionJob(doc)
  assert.deepEqual(original.paths[0].points[0],{x:20,y:20})
  near(original.paths[0].length,80);assert.deepEqual(original.bounds,optimized.bounds)
})
test('outer-only leads leave internal cuts untouched even with inside-out ordering off', () => {
  for (const insideOut of [false,true]) {
    const doc=c.createBlankDocument();doc.production.kerf=0
    const outer=c.createRectShape(20,20,80,80),inner=c.createRectShape(40,40,10,10)
    doc.layers[0].shapes=[outer,inner]
    Object.assign(doc.production,{leadMode:'outer-only',leadIn:2,leadOut:3,insideOut})
    const job=c.buildProductionJob(doc),a=job.paths.find(p=>p.shapeId===outer.id),b=job.paths.find(p=>p.shapeId===inner.id)
    assert.equal(a.leadIn.length,2);assert.equal(a.leadOut.length,2)
    assert.deepEqual(b.leadIn,[]);assert.deepEqual(b.leadOut,[]);near(b.length,40)
    assert.ok(c.prepareLaserJob(doc,'ENTRY.RD').bytes)
    doc.production.leadMode='all'
    assert.equal(c.buildProductionJob(doc).paths.find(p=>p.shapeId===inner.id).leadIn.length,2)
  }
})

test('power edits synchronize both controls and never raise maximum to satisfy minimum', () => {
  const doc=c.createBlankDocument();doc.layers[0].shapes=[c.createRectShape(20,20,10,10)]
  const store=new c.EditorStore();store.loadDocument(doc)
  const id=store.getState().doc.layers[0].id
  store.setLayerPower(id,20)
  let op=c.layerOperation(store.getState().doc.production,id)
  assert.equal(op.power,20);assert.equal(op.maxPower,20);assert.equal(op.minPower,20)
  assert.ok(c.prepareLaserJob(store.getState().doc,'POWER.RD').bytes)
  store.setLayerOperation(id,{minPower:30})
  op=c.layerOperation(store.getState().doc.production,id)
  assert.equal(op.maxPower,20);assert.equal(op.minPower,20)
  store.setLayerOperation(id,{maxPower:10})
  op=c.layerOperation(store.getState().doc.production,id)
  assert.equal(op.power,10);assert.equal(op.minPower,10)
  store.undo();assert.equal(c.layerOperation(store.getState().doc.production,id).maxPower,20)
})
test('legacy power defaults follow saved maximum; explicit invalid powers identify the layer', () => {
  const doc=c.createBlankDocument();doc.layers[0].shapes=[c.createRectShape(20,20,10,10)]
  const id=doc.layers[0].id
  doc.production.layers[id]={mode:'cut',speed:25,power:20,passes:1}
  let normalized=c.normalizeDocument(doc),op=c.layerOperation(normalized.production,id)
  assert.equal(op.maxPower,20);assert.equal(op.minPower,20)
  assert.ok(c.prepareLaserJob(normalized,'LEGACY.RD').bytes)
  doc.production.layers[id].minPower=45;doc.production.layers[id].maxPower=20
  normalized=c.normalizeDocument(doc)
  assert.match(c.prepareLaserJob(normalized,'BAD.RD').error,/Layer 1: minimum laser power 45% exceeds maximum 20%/)
})
test('text infill preserves counters, engraves before cuts, respects layer parameters and exports', () => {
  const text=c.createTextShape(30,40,'O',12)
  text.textInfill={enabled:true,spacing:.2};text.fill=c.makeFill({type:'solid',color:'#112233'})
  const outlined=c.textShapeToCurves(text,font)
  assert.equal(outlined.textInfill.enabled,true)
  const doc=c.createBlankDocument(),cut=c.createRectShape(60,30,10,10)
  doc.layers[0].shapes=[cut,outlined];doc.production.hatchEngrave=false
  const id=doc.layers[0].id
  doc.production.layers[id]={...c.defaultLayerOperation(),speed:22,minPower:10,maxPower:20,power:20,passes:2}
  const job=c.buildProductionJob(doc),fill=job.paths.filter(p=>p.isHatch)
  assert.ok(fill.length>0);assert.equal(job.paths[0].operation,'engrave')
  assert.ok(job.paths.filter(p=>p.shapeId===outlined.id).every(p=>p.operation==='engrave' && p.speed===22 && p.power===20 && p.passes===2))
  assert.ok(job.paths.filter(p=>p.shapeId===cut.id).every(p=>p.operation==='cut'))
  const b=c.shapeBounds(outlined),cx=b.x+b.w/2,cy=b.y+b.h/2
  for(const p of fill) if(Math.abs(p.points[0].y-cy)<.3) assert.ok(! (Math.min(...p.points.map(a=>a.x))<cx && Math.max(...p.points.map(a=>a.x))>cx),'hatch crosses the O counter')
  assert.equal(c.estimateJobTime(job).byLayer[0].operation,'mixed')
  assert.ok(c.prepareLaserJob(doc,'INFILL.RD').bytes)
  const store=new c.EditorStore();store.loadDocument(doc);store.setSelection([outlined.id]);store.setTextInfill(false)
  assert.equal(c.buildProductionJob(store.getState().doc).hatchCount,0)
  store.undo();assert.ok(c.buildProductionJob(store.getState().doc).hatchCount>0)
})

test('live shape previews stay under drag endpoints at different zoom and pan values', () => {
  for (const zoom of [.2, 3.78, 12]) for (const kind of ['rect','ellipse','polygon','line']) {
    const view={zoom,panX:-730,panY:183}, start={x:150,y:240}, end={x:310,y:360}
    const world=p=>({x:(p.x-view.panX)/zoom,y:(p.y-view.panY)/zoom})
    let matrix=[1,1,0,0], stack=[], pathPoints=[], strokes=[]
    const point=(x,y)=>pathPoints.push({x:x*matrix[0]+matrix[2],y:y*matrix[1]+matrix[3]})
    const ctx={
      save(){stack.push([...matrix])},restore(){matrix=stack.pop()},
      translate(x,y){matrix[2]+=x*matrix[0];matrix[3]+=y*matrix[1]},scale(x,y){matrix[0]*=x;matrix[1]*=y},
      beginPath(){pathPoints=[]},setLineDash(){},closePath(){},fill(){},stroke(){strokes.push([...pathPoints])},
      moveTo:point,lineTo:point,quadraticCurveTo(_a,_b,x,y){point(x,y)},
      rect(x,y,w,h){point(x,y);point(x+w,y+h)},
      ellipse(x,y,rx,ry){point(x-rx,y-ry);point(x+rx,y+ry)},
      measureText(){return{width:60}},fillText(){},
    }
    c.drawDraft(ctx,{view,polygonSides:4,draft:{type:'shape',kind,start:world(start),current:world(end),shift:false}})
    const points=strokes[0]
    near(Math.min(...points.map(p=>p.x)),start.x);near(Math.max(...points.map(p=>p.x)),end.x)
    near(Math.min(...points.map(p=>p.y)),start.y);near(Math.max(...points.map(p=>p.y)),end.y)
    assert.deepEqual(matrix,[1,1,0,0])
  }
})

test('Center X changes only X and Middle Y changes only Y for selection and page targets', () => {
  for (const toPage of [false,true]) for(const mode of ['hcenter','vcenter']) {
    const doc=c.createBlankDocument({width:200,height:150})
    const a=c.createRectShape(10,20,20,10),b=c.createRectShape(80,90,40,20)
    doc.layers[0].shapes=[a,b]
    const store=new c.EditorStore();store.loadDocument(doc);store.setSelection([a.id,b.id])
    const before=store.getSelectedShapes().map(c.shapeBounds),target=toPage?{x:0,y:0,w:200,h:150}:c.selectionBounds(store.getSelectedShapes())
    store.alignSelection(mode,toPage)
    store.getSelectedShapes().map(c.shapeBounds).forEach((bounds,i)=>{
      if(mode==='hcenter'){near(bounds.x+bounds.w/2,target.x+target.w/2);near(bounds.y,before[i].y)}
      else {near(bounds.y+bounds.h/2,target.y+target.h/2);near(bounds.x,before[i].x)}
    })
    store.undo();assert.deepEqual(store.getSelectedShapes().map(c.shapeBounds),before)
    store.setSelection([a.id]);store.alignSelection(mode)
    const single=c.shapeBounds(store.getSelectedShapes()[0])
    if(mode==='hcenter'){near(single.x+single.w/2,100);near(single.y,20)}
    else {near(single.y+single.h/2,75);near(single.x,10)}
  }
})

test('unfilled text remains visible through its outline; fill and stroke settings both apply', () => {
  const previous = globalThis.Path2D
  globalThis.Path2D = class {}
  try {
    const calls = [], ctx = { globalAlpha: 1, save(){}, restore(){}, setLineDash(){},
      strokeText: (...args) => calls.push(['stroke', ...args]), fillText: (...args) => calls.push(['fill', ...args]) }
    const text = c.createTextShape(20,30,'Visible\nText',12)
    assert.equal(text.fill.type,'none')
    c.drawShape(ctx,text,{view:{zoom:1}})
    assert.deepEqual(calls.map(call=>call.slice(0,2)),[['stroke','Visible'],['stroke','Text']])
    calls.length=0;text.fill=c.makeFill({type:'solid',color:'#123456'});text.stroke.enabled=false
    c.drawShape(ctx,text,{view:{zoom:1}})
    assert.deepEqual(calls.map(call=>call.slice(0,2)),[['fill','Visible'],['fill','Text']])
    calls.length=0;text.fill.type='none';c.drawShape(ctx,text,{view:{zoom:1}})
    assert.equal(calls.length,0)
  } finally { globalThis.Path2D=previous }
})

test('text outlines preserve real glyph curves, counters, placement and rotation', () => {
  const text = c.createTextShape(30, 40, 'O', 12)
  const outlined = c.textShapeToCurves(text, font)
  assert.equal(outlined.id, text.id); assert.equal(outlined.kind, 'path'); assert.equal(outlined.text, undefined)
  assert.equal(outlined.subpaths.length, 2)
  assert.ok(outlined.subpaths.every(s => s.closed))
  assert.ok(outlined.subpaths.some(s => s.nodes.some(n => n.in.x !== n.x || n.in.y !== n.y)))
  const ref = font.getPath('O', text.text.box.x, text.text.box.y + 12*.82, 12).getBoundingBox()
  const bounds = c.shapeBounds(outlined)
  near(bounds.x, ref.x1); near(bounds.y, ref.y1); near(bounds.w, ref.x2-ref.x1); near(bounds.h, ref.y2-ref.y1)
  text.text.content = 'OO\nO'; text.text.letterSpacing = 1.2; text.text.align = 'center'
  const multi = c.textShapeToCurves(text, font)
  assert.equal(multi.subpaths.length, 6)
  text.text.rotation = Math.PI/2
  const rotated = c.shapeBounds(c.textShapeToCurves(text, font)), before = c.shapeBounds(multi)
  near(rotated.w, before.h); near(rotated.h, before.w)
  const doc = c.createBlankDocument(); doc.layers[0].shapes = [outlined]
  doc.production.kerf = 0; doc.production.leadIn = 0; doc.production.leadOut = 0
  assert.ok(c.prepareLaserJob(doc, 'TEXT.RD').bytes)
})
test('conversion refuses missing glyphs, unshaped script and empty text', () => {
  for (const content of ['😀', 'ગુજરાતી', ' ', 'a\u0301']) assert.throws(() => c.textShapeToCurves(c.createTextShape(20,20,content),font), /outline|shaping|visible/)
})
test('job text conversion is atomic, skips ignored layers and undo restores editable text', async () => {
  const doc=c.createBlankDocument(), text=c.createTextShape(30,40,'TEST',12)
  doc.layers[0].shapes=[text]
  const ignored=c.makeLayer('Ignored','#112233');ignored.shapes=[c.createTextShape(30,50,'Ignored')];doc.layers.push(ignored)
  doc.production.layers[ignored.id]={...c.defaultLayerOperation(),mode:'ignore'}
  const store=new c.EditorStore();store.loadDocument(doc)
  const previous=globalThis.fetch
  globalThis.fetch=async()=>new Response(fontFile)
  try { await store.convertTextToCurves('job') } finally { globalThis.fetch=previous }
  assert.equal(store.getState().doc.layers[0].shapes[0].kind,'path')
  assert.equal(store.getState().doc.layers[1].shapes[0].kind,'text')
  store.undo();assert.equal(store.getState().doc.layers[0].shapes[0].kind,'text')
})
test('layer colour updates objects and preview, inherits on add/transfer, and is undoable', () => {
  const doc=c.createBlankDocument(), shape=c.createRectShape(20,20,30,30)
  shape.fill=c.makeFill({type:'none'});doc.layers[0].shapes=[shape]
  const other=c.makeLayer('Other','#123456');other.shapes=[c.createTextShape(20,60,'Text')];doc.layers.push(other)
  const store=new c.EditorStore();store.loadDocument(doc)
  const id=store.getState().doc.layers[0].id
  const original=store.getState().doc.layers[0].shapes[0].stroke.color
  store.setLayerColor(id,'#ff0000')
  let layer=store.getState().doc.layers[0]
  assert.equal(layer.shapes[0].stroke.color,'#ff0000');assert.equal(layer.shapes[0].fill.type,'none')
  assert.equal(c.buildProductionJob(store.getState().doc).paths[0].color,'#ff0000')
  store.undo();assert.equal(store.getState().doc.layers[0].shapes[0].stroke.color,original)
  store.setLayerColor(id,'#00ff00');store.setActiveLayer(id)
  store.addShape(c.createRectShape(60,20,10,10))
  assert.equal(store.getState().doc.layers[0].shapes[1].stroke.color,'#00ff00')
  const moved=store.getState().doc.layers[1].shapes[0]
  store.moveShapesToLayer([moved.id],id)
  assert.equal(c.getShape(store.getState().doc,moved.id).fill.color,'#00ff00')
  assert.equal(store.getState().doc.layers[1].color,'#123456')
  store.setSelection([moved.id]);store.copySelection()
  store.setLayerColor(other.id,'#1122ff');store.setActiveLayer(other.id);store.pasteSelection()
  assert.equal(store.getState().doc.layers[1].shapes[0].fill.color,'#1122ff')
})
test('desktop host guard, static isolation and upload capability need no cutter access', async () => {
  const handler=createDesktopHandler({dist:path.resolve('dist'),writesEnabled:true})
  async function request(url,host='127.0.0.1:5188') {
    return new Promise(resolve=>{
      const req=new EventEmitter();Object.assign(req,{url,method:'GET',headers:{host}})
      const res={headers:{},setHeader(k,v){this.headers[k]=v},writeHead(s){this.statusCode=s},end(body){this.writableEnded=true;resolve({status:this.statusCode??200,body,headers:this.headers})}}
      handler(req,res,()=>assert.fail('Unexpected fallthrough'))
    })
  }
  assert.equal((await request('/api/corelith/health','evil.example')).status,403)
  assert.equal(JSON.parse((await request('/api/ruida/capabilities')).body).writesEnabled,true)
  assert.equal((await request('/package.json')).status,404)
  assert.equal((await request('/%2e%2e%2fpackage.json')).status,403)
})

test('desktop serves PDF worker modules with executable JavaScript MIME type', async () => {
  const folder=fs.mkdtempSync(path.join(tmpdir(),'corelith-worker-test-'))
  try {
    fs.writeFileSync(path.join(folder,'worker.mjs'),'export {}')
    const handler=createDesktopHandler({dist:folder})
    const response=await new Promise(resolve=>{
      const req=new EventEmitter();Object.assign(req,{url:'/worker.mjs',method:'HEAD',headers:{host:'127.0.0.1:5188'}})
      const res={headers:{},setHeader(k,v){this.headers[k]=v},writeHead(s){this.statusCode=s},end(){resolve(this)}}
      handler(req,res)
    })
    assert.equal(response.statusCode,undefined)
    assert.equal(response.headers['Content-Type'],'text/javascript')
    assert.equal(response.headers['X-Content-Type-Options'],'nosniff')
  } finally {fs.rmSync(folder,{recursive:true,force:true})}
})
