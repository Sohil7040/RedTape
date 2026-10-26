import {test} from 'node:test'
import assert from 'node:assert/strict'
import {loadCore} from '../scripts/load-core.mjs'
const c=await loadCore()
const near=(a,b,e=1e-6)=>assert.ok(Math.abs(a-b)<e,`${a} vs ${b}`)
function setup(size=20){const store=new c.EditorStore(),doc=c.createBlankDocument();doc.layers[0].shapes=[c.createRectShape(0,0,size,size)];store.loadDocument(doc);store.setSelection([doc.layers[0].shapes[0].id]);store.setKnife({cutAll:false});return store}
const settings={copies:3,pivotX:0,pivotY:0,radius:0,startAngle:0,span:360,rotateWithShape:true}
test('Knife click-click retains its first endpoint and creates an undoable split',()=>{
 const store=setup(),before=JSON.stringify(store.getState().doc)
 store.beginKnifeLine({x:-5,y:10});assert.equal(store.finishKnifeLine({x:-5,y:10}),0)
 assert.equal(store.getState().draft.anchors.length,1);assert.equal(store.commitKnifeDraft(),0)
 store.beginKnifeLine({x:25,y:10});assert.ok(store.finishKnifeLine({x:25,y:10})>0)
 assert.equal(store.getState().doc.layers[0].shapes.length,2);assert.equal(store.getState().draft,null)
 store.undo();assert.equal(JSON.stringify(store.getState().doc),before)
})
test('Knife uses pointer-up endpoint and permits sub-millimetre drags when zoomed in',()=>{
 const store=setup(.3);store.setZoomAt(20,{x:0,y:0})
 store.beginKnifeLine({x:-.1,y:.15});assert.ok(store.finishKnifeLine({x:.4,y:.15})>0)
 assert.equal(store.getState().doc.layers[0].shapes.length,2)
})
test('Knife mode changes cancel an unfinished line without editing artwork',()=>{
 const store=setup(),before=JSON.stringify(store.getState().doc)
 store.beginKnifeLine({x:-5,y:10});store.finishKnifeLine({x:-5,y:10});store.setKnife({mode:'bezier'})
 assert.equal(store.getState().draft,null);assert.equal(JSON.stringify(store.getState().doc),before)
})
test('curved Knife intersections lie on the actual knife line',()=>{
 const ellipse=c.createEllipseShape(0,0,20,10),y=3.7
 const result=c.cutShape(ellipse,[{x:-30,y},{x:30,y}],{mode:'line',autoClose:true,span:'normal',width:0,cutAll:true})
 assert.equal(result.pieces.length,2)
 for(const piece of result.pieces){const nodes=piece.subpaths[0].nodes;assert.ok(nodes.filter(n=>Math.abs(n.y-y)<1e-8).length>=2)}
})
test('full circular layouts reserve a slot only when the source occupies that ring',()=>{
 const b={x:25,y:-5,w:10,h:10}
 let layout=c.radialLayout(b,settings);assert.equal(layout.reservesSource,true);near(layout.step,90)
 assert.deepEqual(layout.placements.map(p=>Math.round(p.center.x)||0),[0,-30,0])
 layout=c.radialLayout(b,{...settings,radius:60});assert.equal(layout.reservesSource,false);near(layout.step,120)
 assert.deepEqual(layout.placements.map(p=>Math.round(p.center.x)||0),[60,-30,-30])
 layout=c.radialLayout(b,{...settings,startAngle:30});near(layout.step,120)
 layout=c.radialLayout(b,{...settings,span:-360});near(layout.step,-90)
 layout=c.radialLayout(b,{...settings,span:180});near(layout.step,60);near(layout.placements[2].center.x,-30)
})
test('circular source changes reset stale pivot; repeated apply keeps only the source selected and preserves style',()=>{
 const store=setup(),source=store.getState().doc.layers[0].shapes[0],id=source.id
 source.stroke.color='#123abc';source.fill={...source.fill,color:'#abcdef'}
 store.openPatterns('radial');store.setRadialPattern({copies:3,pivotX:-40,radius:60})
 store.openPatterns('radial');assert.equal(store.getState().radialPattern.pivotX,-40)
 const before=JSON.stringify(source)
 assert.equal(store.applyRadialPattern(),3);assert.deepEqual(store.getState().selection,[id])
 assert.equal(store.applyRadialPattern(),3);assert.equal(store.getState().doc.layers[0].shapes.length,7)
 for(const copy of store.getState().doc.layers[0].shapes){assert.deepEqual(copy.stroke,source.stroke);assert.deepEqual(copy.fill,source.fill)}
 assert.equal(JSON.stringify(source),before)
 const other=store.getState().doc.layers[0].shapes[1];store.setSelection([other.id]);store.openPatterns('radial')
 assert.equal(store.getState().radialPattern.radius,0);assert.notEqual(store.getState().radialPattern.pivotX,-40)
 store.undo();store.undo();assert.equal(store.getState().doc.layers[0].shapes.length,1)
})
