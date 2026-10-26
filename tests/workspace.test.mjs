import {test} from 'node:test'
import assert from 'node:assert/strict'
import {loadCore} from '../scripts/load-core.mjs'
const c=await loadCore()
const fixture=()=>{const doc=c.createBlankDocument();doc.layers[0].shapes=[c.createRectShape(20,25,30,15),c.createEllipseShape(80,60,10,12)];return doc}
test('workflow and theme transitions preserve RD bytes, selection and undo history',()=>{
  const store=new c.EditorStore();store.loadDocument(fixture());const s=store.getState(),shape=s.doc.layers[0].shapes[0]
  store.setSelection([shape.id]);const history=store.undoDepth
  const rd=c.buildJobRD(store.getState().doc)
  for(const workflow of ['laser','preview','design']) {
    store.setWorkflow(workflow);store.setTheme('dark')
    assert.equal(store.getState().workflow,workflow)
    assert.equal(store.getState().doc.production.preview,workflow==='preview')
    assert.deepEqual(store.getState().selection,[shape.id]);assert.equal(store.undoDepth,history)
    assert.deepEqual(c.buildJobRD(store.getState().doc),rd)
  }
})
test('workflow sections, pattern shortcuts and tools stay in the appropriate workspace',()=>{
  const store=new c.EditorStore();store.loadDocument(fixture());store.setWorkflow('preview');store.setProductionTab('machine')
  assert.equal(store.getState().workflow,'preview');assert.equal(store.getState().productionTab,'machine')
  store.setTool('node');assert.equal(store.getState().workflow,'design');assert.equal(store.getState().tool,'node')
  store.setWorkflow('laser');store.openPatterns('radial')
  assert.equal(store.getState().workflow,'design');assert.equal(store.getState().rightTab,'patterns');assert.equal(store.getState().patternTab,'radial')
  store.setWorkflow('preview');store.setRightTab('snap');assert.equal(store.getState().workflow,'design');assert.equal(store.getState().rightTab,'snap')
})
test('fit selection and all visible artwork centre bounds without editing geometry',()=>{
 const store=new c.EditorStore();store.loadDocument(fixture());store.setViewport(800,600)
 const shapes=store.getState().doc.layers[0].shapes;store.setSelection([shapes[0].id])
 const before=JSON.stringify(store.getState().doc),history=store.undoDepth
 for(const scope of ['selection','all']) {
   store.fitArtwork(scope);const v=store.getState().view,b=c.selectionBounds(scope==='selection'?[shapes[0]]:shapes)
   assert.ok(Math.abs((b.x+b.w/2)*v.zoom+v.panX-v.width/2)<1e-7)
   assert.ok(Math.abs((b.y+b.h/2)*v.zoom+v.panY-v.height/2)<1e-7)
   assert.ok(b.w*v.zoom<=v.width-95);assert.ok(b.h*v.zoom<=v.height-95)
 }
 assert.equal(JSON.stringify(store.getState().doc),before);assert.equal(store.undoDepth,history)
})
test('fit all includes locked visible artwork but excludes hidden artwork',()=>{
 const store=new c.EditorStore(),doc=fixture();doc.layers[0].shapes[1].locked=true
 const far=c.createRectShape(10000,10000,100,100);far.hidden=true;doc.layers[0].shapes.push(far)
 store.loadDocument(doc);store.setViewport(800,600);store.fitArtwork('all')
 assert.ok(store.getState().view.zoom>1)
 const v=store.getState().view,b=c.selectionBounds(doc.layers[0].shapes.slice(0,2))
 assert.ok(Math.abs((b.x+b.w/2)*v.zoom+v.panX-400)<1e-6)
})
test('workspace preferences tolerate malformed data and never restore selection or transient state',()=>{
 assert.deepEqual(c.loadWorkspace({getItem:()=>'{bad'}),{theme:'light',leftOpen:true,rightOpen:true})
 assert.deepEqual(c.loadWorkspace({getItem:()=>JSON.stringify({theme:'dark',leftOpen:false,rightOpen:true,selection:['stale'],transferId:'fake'})}),{theme:'dark',leftOpen:false,rightOpen:true})
 assert.equal(c.loadWorkspace({getItem:()=>'{"theme":"unknown","leftOpen":"false"}'}).leftOpen,true)
})
test('local autosave reports quota failure and retains the compatible project envelope',()=>{
 const doc=fixture();let payload,key
 const result=c.saveLocalDocument({setItem:(k,v)=>{key=k;payload=v}},doc,123)
 assert.deepEqual(result,{ok:true,savedAt:123});assert.equal(key,'corelith.autosave.v1')
 const envelope=JSON.parse(payload);assert.equal(envelope.savedAt,123)
 const normalized=c.normalizeDocument(envelope.doc);assert.equal(normalized.layers[0].shapes.length,2)
 assert.deepEqual(c.buildJobRD(normalized),c.buildJobRD(doc))
 assert.deepEqual(c.saveLocalDocument({setItem:()=>{throw Error('Quota exceeded')}},doc),{ok:false,error:'Quota exceeded'})
})
test('invalid process errors survive workflow changes and remain blocked from RD generation',()=>{
 const doc=fixture();doc.production.layers[doc.layers[0].id]={...c.defaultLayerOperation(),minPower:80,maxPower:12,power:12}
 const store=new c.EditorStore();store.loadDocument(doc)
 for(const workflow of ['laser','preview','design']){store.setWorkflow(workflow);assert.ok(c.prepareLaserJob(store.getState().doc,'BAD.RD').error)}
})
test('compact panels are mutually exclusive and automatic collapse does not persist desktop preferences',()=>{
 const store=new c.EditorStore();store.setCompactView(true)
 assert.equal(store.getState().leftOpen,false);assert.equal(store.getState().rightOpen,false)
 store.setLeftOpen(true);assert.equal(store.getState().leftOpen,true);assert.equal(store.getState().rightOpen,false)
 store.setRightOpen(true);assert.equal(store.getState().leftOpen,false);assert.equal(store.getState().rightOpen,true)
 store.setLeftOpen(true);store.setWorkflow('preview');assert.equal(store.getState().leftOpen,false);assert.equal(store.getState().rightOpen,true)
})
test('undo and redo preserve the current workflow display while restoring actual edits',()=>{
 const store=new c.EditorStore();store.loadDocument(fixture());const layer=store.getState().doc.layers[0]
 store.setWorkflow('preview');store.setLayerOperation(layer.id,{speed:99});store.setWorkflow('laser');store.undo()
 assert.equal(store.getState().workflow,'laser');assert.equal(store.getState().doc.production.preview,false)
 assert.notEqual(c.layerOperation(store.getState().doc.production,layer.id).speed,99)
 store.redo();assert.equal(c.layerOperation(store.getState().doc.production,layer.id).speed,99);assert.equal(store.getState().doc.production.preview,false)
})
test('transfer presentation distinguishes failed upload, mismatch, unavailable readback and matched bytes',()=>{
 assert.equal(c.transferOutcome({success:false,error:'timeout'}).tone,'error')
 assert.match(c.transferOutcome({success:false,verification:'mismatch',filename:'JOB.RD'}).title,/Upload completed; stored-file verification failed/)
 assert.equal(c.transferOutcome({success:true,verification:'unavailable',warning:'FTP unavailable'}).tone,'warning')
 const matched=c.transferOutcome({success:true,verification:'matched',filename:'JOB.RD',fileIndex:3,ip:'192.0.2.1',port:50201})
 assert.equal(matched.tone,'success');assert.match(matched.message,/file 3/);assert.match(matched.message,/Job not started/)
 assert.equal(c.transferOutcome({success:true,verification:'not-requested'}).tone,'warning')
})
test('transfer progress reflects acknowledged bytes and handles unavailable totals',()=>{
 assert.equal(c.transferProgress(5,20),25);assert.equal(c.transferProgress(25,20),100)
 assert.equal(c.transferProgress(5,0),0);assert.equal(c.transferProgress(NaN,100),0)
})
test('showcase reset and compact upload review keep canvas, workflow and panel state consistent',()=>{
 const store=new c.EditorStore();store.loadDocument(fixture());store.setWorkflow('preview');store.resetDemo()
 assert.equal(store.getState().workflow,store.getState().doc.production.preview?'preview':'design')
 store.setCompactView(true);store.setLeftOpen(true);store.setProductionTab('machine')
 assert.equal(store.getState().leftOpen,false);assert.equal(store.getState().rightOpen,true)
})

test('startup opens one empty sheet without restoring or overwriting the previous autosave',()=>{
 const previous=globalThis.localStorage,doc=fixture(),raw=JSON.stringify({doc,savedAt:123}),writes=[]
 globalThis.localStorage={getItem:key=>key===c.AUTOSAVE_KEY?raw:null,setItem:(...args)=>writes.push(args)}
 try {
  const store=new c.EditorStore(),state=store.getState()
  assert.equal(state.doc.layers.flatMap(l=>l.shapes).length,0)
  assert.equal(state.doc.pages.length,1);assert.deepEqual(state.selection,[])
  assert.equal(state.workflow,'design');assert.equal(state.draft,null)
  assert.deepEqual(writes,[])
  assert.equal(store.restoreAutosave(),true)
  assert.equal(store.getState().doc.id,doc.id)
  assert.equal(store.getState().doc.layers[0].shapes.length,2)
  store.undo();assert.equal(store.getState().doc.layers.flatMap(l=>l.shapes).length,0)
 } finally {if(previous===undefined)delete globalThis.localStorage;else globalThis.localStorage=previous}
})

test('rotated ellipse becomes a true circle at its current centre with style and undo preserved',()=>{
 const store=new c.EditorStore(),doc=c.createBlankDocument(),ellipse=c.createEllipseShape(100,120,20,10)
 ellipse.subpaths=c.rotateSubpaths(ellipse.subpaths,{x:100,y:120},.6)
 ellipse.stroke.color='#128abc';doc.layers[0].shapes=[ellipse];store.loadDocument(doc);store.setSelection([ellipse.id])
 const before=JSON.stringify(store.getState().doc),original=store.getSelectedShapes()[0],b=c.shapeBounds(original)
 store.makeSelectionCircle();const circle=store.getSelectedShapes()[0],after=c.shapeBounds(circle)
 assert.ok(Math.abs(after.w-b.w)<1e-8);assert.ok(Math.abs(after.w-after.h)<1e-8)
 assert.ok(Math.abs(after.x+after.w/2-100)<1e-8);assert.ok(Math.abs(after.y+after.h/2-120)<1e-8)
 assert.equal(circle.id,ellipse.id);assert.deepEqual(circle.stroke,original.stroke)
 // Equal bounding dimensions alone would not make a rotated ellipse circular.
 for(const node of circle.subpaths[0].nodes)assert.ok(Math.abs(Math.hypot(node.x-100,node.y-120)-after.w/2)<1e-8)
 store.undo();assert.equal(JSON.stringify(store.getState().doc),before)
})
test('independent ellipse width and height resizing reaches equal dimensions without moving its top-left',()=>{
 const store=new c.EditorStore(),doc=c.createBlankDocument(),ellipse=c.createEllipseShape(100,120,20,10)
 doc.layers[0].shapes=[ellipse];store.loadDocument(doc);store.setSelection([ellipse.id])
 const b=c.shapeBounds(store.getSelectedShapes()[0])
 store.setSelectionSize(35,b.h);store.setSelectionSize(35,35)
 const after=c.shapeBounds(store.getSelectedShapes()[0])
 assert.ok(Math.abs(after.w-35)<1e-8);assert.ok(Math.abs(after.h-35)<1e-8)
 assert.ok(Math.abs(after.x-b.x)<1e-8);assert.ok(Math.abs(after.y-b.y)<1e-8)
})
