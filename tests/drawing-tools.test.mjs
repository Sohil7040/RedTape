import assert from 'node:assert/strict'
import { test } from 'node:test'
import { loadCore } from '../scripts/load-core.mjs'
const c = await loadCore()
const near = (a,b,eps=.002) => assert.ok(Math.abs(a-b)<eps, `${a} vs ${b}`)
const knife = {mode:'line',autoClose:true,span:'normal',width:0,cutAll:true}
const area = shape => shape.subpaths.reduce((sum,sub)=>sum+Math.abs(c.polygonArea(c.flattenSubpath(sub))),0)

test('intersection snapping does not invent the closing edge of an open polyline', () => {
  const doc=c.createBlankDocument()
  const open=c.createRectShape(0,0,20,20)
  open.subpaths[0].closed=false
  const cross=c.createLineShape({x:-5,y:10},{x:5,y:10})
  doc.layers[0].shapes=[open,cross]
  const settings={...doc.snap,nodes:false,midpoints:false,centers:false,quadrants:false,grid:false,guides:false,perpendicular:false,tangent:false,intersections:true}
  assert.equal(c.collectStaticCandidates(doc,new Set(),{x:0,y:10},settings,1).length,0)
  open.subpaths[0].closed=true
  const hits=c.collectStaticCandidates(doc,new Set(),{x:0,y:10},settings,1)
  assert.equal(hits.length,1);near(hits[0].x,0);near(hits[0].y,10)
})

test('snapping ignores hidden and locked shapes and keeps a screen-space capture radius', () => {
  const doc=c.createBlankDocument(),shape=c.createRectShape(10,10,10,10)
  doc.layers[0].shapes=[shape]
  const settings={...doc.snap,nodes:true,midpoints:false,centers:false,quadrants:false,grid:false,guides:false,perpendicular:false,tangent:false,intersections:false}
  for(const property of ['hidden','locked']) {
    shape[property]=true
    assert.equal(c.collectStaticCandidates(doc,new Set(),{x:10,y:10},settings,1).length,0)
    assert.deepEqual(c.alignmentSnap({x:9.5,y:30,w:2,h:2},[shape],1,true).rays,[])
    shape[property]=false
  }
  doc.layers[0].visible=false
  assert.equal(c.collectStaticCandidates(doc,new Set(),{x:10,y:10},settings,1).length,0)
  doc.layers[0].visible=true
  for(const zoom of [.25,1,8]) {
    const candidates=c.collectStaticCandidates(doc,new Set(),{x:10,y:10},settings,zoom)
    const hit=c.snapPoint({x:10+5/zoom,y:10},candidates,6/zoom,zoom)
    assert.ok(hit);assert.ok(hit.screenDistance<=6)
    assert.equal(c.snapPoint({x:10,y:10},[{x:10+7/zoom,y:10,kind:'node'}],6/zoom,zoom),null)
  }
})

test('knife through two rectangle corners produces two closed halves without duplicate crossings', () => {
  const original=c.createRectShape(0,0,20,20)
  const snapshot=JSON.stringify(original)
  const result=c.cutShape(original,[{x:-5,y:-5},{x:25,y:25}],knife)
  assert.ok(result);assert.equal(result.cuts,2);assert.equal(result.pieces.length,2)
  near(result.pieces.reduce((sum,p)=>sum+area(p),0),400,.01)
  for(const piece of result.pieces) {assert.equal(piece.subpaths[0].closed,true);near(area(piece),200,.01)}
  assert.equal(JSON.stringify(original),snapshot)
})

test('knife touching only an open endpoint or a single closed corner leaves the source intact', () => {
  const line=c.createLineShape({x:0,y:0},{x:20,y:0})
  assert.equal(c.cutShape(line,[{x:0,y:-5},{x:0,y:5}],knife),null)
  const box=c.createRectShape(0,0,20,20)
  assert.equal(c.cutShape(box,[{x:-5,y:5},{x:5,y:-5}],knife),null)
  assert.equal(c.cutShape(box,[{x:10,y:10},{x:10,y:10}],knife),null)
})

test('rectangular and circular patterns preserve source geometry and match preview positions', () => {
  const shape=c.createRectShape(10,10,10,20),snapshot=JSON.stringify(shape)
  const grid={columns:3,rows:2,mode:'spacing',dx:2,dy:3,directionX:-1,directionY:1}
  const copies=c.gridPattern(shape,grid)
  assert.equal(copies.length,c.gridPatternCount(grid));assert.equal(copies.length,5)
  assert.deepEqual(copies.map(p=>{const b=c.shapeBounds(p);return [b.x,b.y]}),[[-2,10],[-14,10],[10,33],[-2,33],[-14,33]])
  const radial={copies:3,pivotX:0,pivotY:0,radius:40,startAngle:0,span:360,rotateWithShape:true}
  const circular=c.radialPattern(shape,radial),preview=c.radialPreviewCenters(shape,radial)
  assert.equal(circular.length,3);assert.equal(c.radialStep(360,3),90)
  circular.forEach((copy,i)=>{const center=c.boundsCenter(c.shapeBounds(copy));near(center.x,preview[i].center.x);near(center.y,preview[i].center.y)})
  assert.equal(JSON.stringify(shape),snapshot)
})

test('tangent snapping finds tangent contacts instead of perpendicular feet', () => {
  const doc=c.createBlankDocument(),circle=c.createEllipseShape(0,0,10,10)
  doc.layers[0].shapes=[circle]
  const settings={...doc.snap,nodes:false,midpoints:false,centers:false,quadrants:false,grid:false,guides:false,perpendicular:false,tangent:true,intersections:false,radius:10}
  const hits=c.collectStaticCandidates(doc,new Set(),{x:20,y:0},settings,1)
  assert.ok(hits.length>=2)
  for(const hit of hits) {
    near(hit.x,5,.015);near(Math.abs(hit.y),Math.sqrt(75),.015)
    // Circle radius is perpendicular to the tangent from the external point.
    near(hit.x*(20-hit.x)-hit.y*hit.y,0,.3)
  }
  assert.equal(c.collectStaticCandidates(doc,new Set(),{x:0,y:0},settings,1).length,0)
  const line=c.createLineShape({x:0,y:0},{x:20,y:0});doc.layers[0].shapes=[line]
  assert.equal(c.collectStaticCandidates(doc,new Set(),{x:10,y:5},settings,1).length,0)
})

test('patterns keep a mixed-size selection together using common selection bounds', () => {
  const a=c.createRectShape(0,0,10,10),b=c.createRectShape(20,0,20,10)
  const bounds=c.selectionBounds([a,b])
  const grid={columns:2,rows:1,mode:'spacing',dx:5,dy:3,directionX:1,directionY:1}
  const ga=c.gridPattern(a,grid,bounds)[0],gb=c.gridPattern(b,grid,bounds)[0]
  near(c.shapeBounds(ga).x,45);near(c.shapeBounds(gb).x,65)
  const radial={copies:3,pivotX:0,pivotY:0,radius:80,startAngle:0,span:360,rotateWithShape:true}
  const ra=c.radialPattern(a,radial,bounds),rb=c.radialPattern(b,radial,bounds)
  const preview=c.radialPreviewCenters(a,radial,bounds)
  for(let i=0;i<ra.length;i++) {
    const ac=c.boundsCenter(c.shapeBounds(ra[i])),bc=c.boundsCenter(c.shapeBounds(rb[i]))
    near(c.dist(ac,bc),25)
    const assembledCenter=c.boundsCenter(c.selectionBounds([ra[i],rb[i]]))
    near(assembledCenter.x,preview[i].center.x);near(assembledCenter.y,preview[i].center.y)
  }
  radial.rotateWithShape=false
  const uprightA=c.radialPattern(a,radial,bounds)[0],uprightB=c.radialPattern(b,radial,bounds)[0]
  near(c.shapeBounds(uprightB).x-c.shapeBounds(uprightA).x,20)
})
