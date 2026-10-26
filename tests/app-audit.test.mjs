import assert from 'node:assert/strict'
import { test } from 'node:test'
import { loadCore } from '../scripts/load-core.mjs'
const c = await loadCore()
globalThis.window ??= { setTimeout: () => 0 }
function docWith(shapes) {
  const doc=c.createBlankDocument({name:'AUDIT'})
  doc.layers[0].shapes=shapes
  doc.production.leadIn=0;doc.production.leadOut=0;doc.production.kerf=0
  doc.production.layers[doc.layers[0].id]={...c.defaultLayerOperation(),speed:10,power:50,minPower:20,maxPower:50,passes:1}
  return doc
}
const near=(a,b,e=1e-6)=>assert.ok(Math.abs(a-b)<=e,`${a} differs from ${b}`)

test('simulation includes every pass and traverses time rather than distance',()=>{
  const d=docWith([c.createLineShape({x:0,y:10},{x:100,y:10})]);d.production.startX=0;d.production.startY=10
  d.production.layers[d.layers[0].id].passes=2
  const j=c.buildProductionJob(d)
  near(j.totalLength,200);near(j.rapidLength,100);near(j.totalTime,20+100/300)
  const halfway=c.getSimulationStateAt(j,15/j.totalTime,{x:0,y:10})
  near(halfway.headPos.x,(15-10-100/300)*10,.01)
  assert.equal(halfway.laserOn,true)
  assert.equal(c.getSimulationStateAt(j,1).laserOn,false)
})
test('leads are included in bounds, rapid travel and exports',()=>{
  const d=docWith([c.createRectShape(20,20,10,10)]);d.production.leadMode='all';d.production.leadIn=5;d.production.leadOut=3
  const j=c.buildProductionJob(d),p=j.paths[0],points=c.toolpathPoints(p)
  near(p.length,48,.001)
  assert.ok(j.bounds.w>10 || j.bounds.h>10)
  const plt=c.buildJobPLT(d),imported=c.parseVectorFile(plt,'sample.plt',d.page)
  assert.equal(imported.shapes.length,1)
  const b=c.selectionBounds(imported.shapes)
  near(b.w,j.bounds.w,.03);near(b.h,j.bounds.h,.03)
  assert.ok(points.length>=7)
})
test('PLT pen-down begins at preceding pen-up point, including PA/PR coordinates',()=>{
  const result=c.parseVectorFile('IN;SP1;PU0,0;PD400,0;PR0,400;PU;','line.plt',c.createBlankDocument().page)
  assert.equal(result.shapes.length,1)
  const b=c.selectionBounds(result.shapes);near(b.w,10);near(b.h,10)
  const sub=result.shapes[0].subpaths[0]
  assert.equal(sub.nodes.length,3)
  assert.throws(()=>c.parseVectorFile('IN;CI100;','arc.plt',c.createBlankDocument().page),/not supported/)
})
test('oversized vector import preserves physical size and warns',()=>{
  const page=c.createBlankDocument({width:100,height:100}).page
  const result=c.parseVectorFile('IN;SP1;PU0,0;PD8000,0;PU;','large.plt',page)
  near(c.selectionBounds(result.shapes).w,200)
  assert.match(result.warnings.join(' '),/preserved/)
})
test('compound engraving respects even-odd and nonzero holes',()=>{
  const outer=[{x:0,y:0},{x:10,y:0},{x:10,y:10},{x:0,y:10}]
  const inner=[{x:3,y:3},{x:7,y:3},{x:7,y:7},{x:3,y:7}]
  for(const [rings,rule] of [[[outer,inner],'evenodd'],[[outer,[...inner].reverse()],'nonzero']]){
    const h=c.hatchPolygons(rings,1,rule)
    assert.ok(h.length)
    for(const [a,b] of h){
      if(a.y>3&&a.y<7)assert.ok(Math.max(a.x,b.x)<=3||Math.min(a.x,b.x)>=7)
    }
  }
  const filled=c.hatchPolygons([outer,inner],1,'nonzero')
  assert.ok(filled.some(([a,b])=>a.y>3&&a.y<7&&Math.min(a.x,b.x)===3&&Math.max(a.x,b.x)===7))
})
test('hatching limit and skipped/visually clipped artwork block machine export',()=>{
  const d=docWith([c.createRectShape(10,10,100,100)])
  d.layers[0].shapes[0].fill=c.makeFill({type:'solid'})
  d.production.layers[d.layers[0].id].mode='engrave'
  d.production.layers[d.layers[0].id].scanInterval=.02;d.production.hatchEngrave=true
  assert.ok(c.buildProductionJob(d).errors.some(e=>e.includes('limit')))
  assert.throws(()=>c.buildJobRD(d),/limit/)
  const text=docWith([c.createRectShape(20,20,20,20),c.createTextShape(20,20,'TEXT')])
  assert.throws(()=>c.buildJobRD(text),/text object/)
  const clip=docWith([c.createRectShape(20,20,20,20)])
  clip.layers[0].shapes[0].clip=c.rectSubpaths(20,20,5,5)
  assert.throws(()=>c.buildJobRD(clip),/clipping path/)
})
test('inside-out order remains enabled without nearest-neighbor optimization',()=>{
  const d=docWith([c.createRectShape(20,20,100,100,'Outer'),c.createRectShape(40,40,10,10,'Hole')])
  d.production.optimizeOrder=false;d.production.insideOut=true
  assert.equal(c.buildProductionJob(d).paths[0].shapeName,'Hole')
})
test('SVG path parser supports quadratic reflection, arcs, compact numbers and closure',()=>{
  const q=c.parseSvgPathD('M0 0 Q10 20 20 0 T40 0')[0]
  near(q.nodes[1].out.x,20+20/3);near(q.nodes[1].out.y,-40/3)
  const a=c.parseSvgPathD('M0 10 A10 10 0 0 1 20 10')[0]
  const b=c.pathBounds([a]);near(b.w,20);near(b.h,10,.001)
  const closed=c.parseSvgPathD('M0 0 C0 10 10 10 0 0z')[0]
  assert.equal(closed.nodes.length,1);near(closed.nodes[0].in.y,10)
  const compact=c.parseSvgPathD('M.5.5l1e1-2')[0];near(compact.nodes[1].x,10.5);near(compact.nodes[1].y,-1.5)
  assert.throws(()=>c.parseSvgPathD('M0 0 C1 2'),/Missing coordinates/)
  assert.throws(()=>c.parseSvgPathD('M0 0 R1 2'),/Unsupported/)
})
test('SVG viewport units and zero scale are preserved',()=>{
  near(c.svgLengthMm('1in'),25.4);near(c.svgLengthMm('96px'),25.4)
  const t=c.svgViewportTransform('100mm','50mm','0 0 200 100');near(t.a,.5);near(t.d,.5)
  const s=c.parseSvgTransform('scale(0)');near(s.a,0);near(s.d,0)
})
test('SVG export includes stroke and transparent unfilled geometry',()=>{
  const d=docWith([c.createLineShape({x:20,y:20},{x:40,y:40})]);d.layers[0].shapes[0].stroke.color='#e11d48'
  const svg=c.buildSVG({doc:d})
  assert.match(svg,/stroke="#e11d48"/)
  assert.match(svg,/fill="none"/)
})
test('independent sheets keep artwork through switch, deletion, undo and save/reload',()=>{
  const store=new c.EditorStore();store.newDocument({name:'Sheets'})
  store.addShape(c.createRectShape(20,20,10,10,'First'))
  const first=store.getState().doc.page.id
  store.addPage('Second');const second=store.getState().doc.page.id
  assert.equal(store.getState().doc.layers.flatMap(l=>l.shapes).length,0)
  store.addShape(c.createEllipseShape(30,30,10,10,'Second'))
  store.setActivePage(first)
  assert.equal(store.getState().doc.layers[0].shapes[0].name,'First')
  const saved=JSON.parse(JSON.stringify(store.getState().doc))
  const restored=new c.EditorStore();restored.loadDocument(saved);restored.setActivePage(second)
  assert.equal(restored.getState().doc.layers[0].shapes[0].name,'Second')
  restored.deletePage(first);assert.equal(restored.getState().doc.page.id,second)
  restored.undo();assert.equal(restored.getState().doc.pages.length,2)
})
test('partial/older project settings normalize without mutating the source; malformed projects fail',()=>{
  const d=docWith([]);d.production={layers:{}};delete d.snap
  const normalized=c.normalizeDocument(d)
  assert.equal(normalized.production.originCorner,'bottom-right')
  assert.equal(normalized.production.layers[d.layers[0].id].passes,1)
  assert.equal(d.production.originCorner,undefined)
  assert.throws(()=>c.normalizeDocument({...d,page:{...d.page,width:NaN}}),/dimensions/)
})
test('simulation state publishes a new snapshot; process changes are undoable',()=>{
  const store=new c.EditorStore();store.newDocument()
  const prev=store.getState();store.setSimulation({playing:true,progress:.5});assert.notEqual(store.getState(),prev)
  const id=store.getState().doc.activeLayerId,old=store.getState().doc.production.layers[id].speed
  store.setLayerOperation(id,{speed:42});store.undo()
  assert.equal(store.getState().doc.production.layers[id].speed,old)
})
test('duration rounding carries minutes and machine settings reject invalid ports',()=>{
  assert.equal(c.formatDuration(119.9),'2m 00s')
  assert.equal(c.validProfile({ip:'192.168.1.11',port:50201}),true)
  for(const p of [{ip:'999.1.2.3',port:50201},{ip:'192.168.1.11',port:NaN}])assert.equal(c.validProfile(p),false)
})
test('boolean operations preserve area for overlapping, touching and compound rectangles',()=>{
  const area=shape=>Math.abs(shape.subpaths.reduce((sum,s)=>sum+c.polygonArea(c.flattenSubpath(s)),0))
  const a=c.createRectShape(0,0,10,10),b=c.createRectShape(5,0,10,10)
  for(const [op,expected] of [['union',150],['subtract',50],['intersect',50],['exclude',100]])near(area(c.booleanTwoShapes(a,b,op)),expected,.01)
  near(area(c.booleanTwoShapes(a,c.createRectShape(10,0,10,10),'union')),200,.01)
  near(area(c.booleanTwoShapes(a,c.createRectShape(2,2,6,6),'subtract')),64,.01)
  assert.equal(c.booleanTwoShapes(a,a,'subtract').subpaths.length,0)
  assert.throws(()=>c.booleanTwoShapes(c.createLineShape({x:0,y:0},{x:10,y:10}),a,'union'),/closed/)
})
test('nesting skips oversized pieces without consuming a usable shelf',()=>{
  const shapes=[c.createRectShape(0,0,100,100,'Large'),c.createRectShape(0,0,500,1,'Too wide'),c.createRectShape(0,0,20,20,'Small')]
  const result=c.nestShapes(shapes,200,200,10,5,false)
  assert.equal(result.overflow,1)
  assert.equal(result.placements.find(p=>p.shape.name==='Small').y,10)
})
test('locked objects cannot be deleted by a stale selection',()=>{
  const store=new c.EditorStore();store.newDocument()
  const shape=c.createRectShape(20,20,10,10);store.addShape(shape);store.setShapeLocked(shape.id,true)
  store.setSelection([shape.id]);store.deleteSelection()
  assert.equal(store.getState().doc.layers[0].shapes.length,1)
})
test('boolean rectangle algebra holds across many overlap arrangements',()=>{
  const area=shape=>Math.abs(shape.subpaths.reduce((sum,s)=>sum+c.polygonArea(c.flattenSubpath(s)),0))
  for(let x=-12;x<=12;x+=3)for(let y=-12;y<=12;y+=3){
    const a=c.createRectShape(0,0,10,10),b=c.createRectShape(x,y,8,8)
    const overlap=Math.max(0,Math.min(10,x+8)-Math.max(0,x))*Math.max(0,Math.min(10,y+8)-Math.max(0,y))
    near(area(c.booleanTwoShapes(a,b,'union')),164-overlap,.01)
    near(area(c.booleanTwoShapes(a,b,'subtract')),100-overlap,.01)
    near(area(c.booleanTwoShapes(a,b,'intersect')),overlap,.01)
    near(area(c.booleanTwoShapes(a,b,'exclude')),164-2*overlap,.01)
  }
})
test('PowerClip extraction only affects selected content and is undoable',()=>{
  const store=new c.EditorStore();store.newDocument()
  const a=c.createRectShape(20,20,10,10),b=c.createRectShape(50,50,10,10)
  a.clip=c.rectSubpaths(20,20,5,5);b.clip=c.rectSubpaths(50,50,5,5)
  store.addShape(a);store.addShape(b);store.setSelection([a.id]);store.extractClip()
  assert.equal(c.getShape(store.getState().doc,a.id).clip,undefined)
  assert.ok(c.getShape(store.getState().doc,b.id).clip)
  store.undo();assert.ok(c.getShape(store.getState().doc,a.id).clip)
  const copy=c.cloneShape(c.getShape(store.getState().doc,a.id),10,10);near(c.pathBounds(copy.clip).x,30)
})
test('knife divides a rectangle into two closed pieces without changing total area',()=>{
  const shape=c.createRectShape(20,20,20,20)
  const result=c.cutShapes([shape],[{x:30,y:10},{x:30,y:50}],{mode:'line',autoClose:true,span:'normal',width:0,cutAll:true})
  assert.equal(result.result.length,1)
  assert.equal(result.result[0].pieces.length,2)
  const area=result.result[0].pieces.reduce((sum,shape)=>sum+Math.abs(shape.subpaths.reduce((sum,s)=>sum+c.polygonArea(c.flattenSubpath(s)),0)),0)
  near(area,400,.1)
})
test('job estimate breaks down layers, passes and travel without changing machine output',()=>{
  const d=docWith([c.createLineShape({x:0,y:10},{x:100,y:10})]);d.production.startX=0;d.production.startY=10
  d.production.layers[d.layers[0].id].passes=2
  const score=c.makeLayer('Scoring');score.shapes=[c.createLineShape({x:110,y:10},{x:160,y:10})];d.layers.push(score)
  d.production.layers[score.id]={...c.defaultLayerOperation('score'),speed:20,power:18,minPower:12,maxPower:18,passes:1}
  const j=c.buildProductionJob(d),estimate=c.estimateJobTime(j,25)
  assert.equal(estimate.available,true)
  near(estimate.burnSeconds,22.5)
  near(estimate.byLayer.find(l=>l.layerId===score.id).seconds,2.5)
  near(estimate.byLayer.find(l=>l.layerId===d.layers[0].id).seconds,20)
  near(estimate.estimatedSeconds,j.totalTime*1.25)
  const before=c.buildJobRD(d)
  const adjusted=structuredClone(d);adjusted.production.timeAllowancePct=25
  assert.deepEqual(c.buildJobRD(adjusted),before)
  const json=JSON.parse(c.buildJobJSON(adjusted));near(json.timeEstimate.estimatedSeconds,estimate.estimatedSeconds)
  assert.equal(c.estimateJobTime(c.buildProductionJob(c.createBlankDocument())).available,false)
})
test('engrave and score precede inner and outer cut contours',()=>{
  for(const optimizeOrder of [true,false]){
    const d=docWith([c.createRectShape(20,20,100,100,'Outer'),c.createRectShape(40,40,20,20,'Inner')])
    for(const [name,mode,y] of [['Score','score',150],['Engrave','engrave',160]]){
      const layer=c.makeLayer(name);layer.shapes=[c.createLineShape({x:20,y},{x:30,y})];d.layers.push(layer)
      d.production.layers[layer.id]=c.defaultLayerOperation(mode)
    }
    d.production.optimizeOrder=optimizeOrder;d.production.insideOut=true
    const paths=c.buildProductionJob(d).paths
    assert.deepEqual(paths.map(p=>p.operation),['engrave','score','cut','cut'])
    assert.equal(paths[2].shapeName,'Inner');assert.equal(paths[3].shapeName,'Outer')
  }
})
