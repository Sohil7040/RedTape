import assert from 'node:assert/strict'
import {test} from 'node:test'
import fs from 'node:fs'
import {loadCore} from '../scripts/load-core.mjs'
const c=await loadCore()
const distance=(p,a,b)=>{
  const dx=b.x-a.x,dy=b.y-a.y,t=Math.max(0,Math.min(1,((p.x-a.x)*dx+(p.y-a.y)*dy)/(dx*dx+dy*dy||1)))
  return Math.hypot(p.x-a.x-t*dx,p.y-a.y-t*dy)
}
const bernstein=(p0,p1,p2,p3,t)=>(1-t)**3*p0+3*(1-t)**2*t*p1+3*(1-t)*t*t*p2+t**3*p3

test('recovered Corel cubic arithmetic agrees with independent Bernstein and de Casteljau evaluation',()=>{
  for(let i=0;i<80;i++) {
    const p=[Math.sin(i)*1000,Math.cos(i*2)*400,Math.sin(i*3)*600,Math.cos(i*4)*900]
    for(const t of [0,.001,.1,.37,.5,.81,.999,1]) {
      const actual=c.corelCubicCoordinate(...p,t),linear=(a,b)=>a+(b-a)*t
      const q=[linear(p[0],p[1]),linear(p[1],p[2]),linear(p[2],p[3])]
      const casteljau=linear(linear(q[0],q[1]),linear(q[1],q[2]))
      assert.ok(Math.abs(actual-bernstein(...p,t))<1e-9)
      assert.ok(Math.abs(actual-casteljau)<1e-9)
    }
  }
})

test('recovered RDWorks ellipse yields the native CIR micrometre endpoints at 28 samples per quarter',()=>{
  const native=c.parseRD(fs.readFileSync(new URL('fixtures/controller/CIR.RD',import.meta.url))).shapes[0]
  const generated=c.ellipseSubpaths(12.5,12.5,12.5,12.5)[0]
  const key=p=>`${Math.round(p.x*1000)},${Math.round(p.y*1000)}`
  const expected=new Set(native.subpaths[0].nodes.map(key)),actual=new Set()
  for(const segment of c.segments(generated))for(let i=0;i<28;i++)actual.add(key(c.cubicPoint(segment,i/28)))
  assert.equal(expected.size,112)
  assert.deepEqual(actual,expected)
})

test('machining circle matches or exceeds native fixture geometric fidelity without lead cuts',()=>{
  const doc=c.createBlankDocument(),shape=c.createEllipseShape(40,40,12.5,12.5)
  doc.layers[0].shapes=[shape];doc.production.kerf=0
  const bytes=c.buildJobRD(doc),readback=c.parseRD(bytes).shapes[0].subpaths[0]
  const points=readback.nodes
  assert.ok(points.length>=112&&points.length<=224)
  let worst=0,maxTurn=0
  for(let i=0;i<points.length;i++) {
    const a=points[i],b=points[(i+1)%points.length],previous=points[(i+points.length-1)%points.length]
    for(let j=0;j<=100;j++) {
      const t=j/100,x=a.x+(b.x-a.x)*t,y=a.y+(b.y-a.y)*t
      worst=Math.max(worst,Math.abs(Math.hypot(x-12.5,y-12.5)-12.5))
    }
    const ux=a.x-previous.x,uy=a.y-previous.y,vx=b.x-a.x,vy=b.y-a.y
    maxTurn=Math.max(maxTurn,Math.abs(Math.atan2(ux*vy-uy*vx,ux*vx+uy*vy))*180/Math.PI)
  }
  assert.ok(worst<.0052,`Circle deviation ${worst}`)
  assert.ok(maxTurn<3.5,`Curve turn ${maxTurn}`)
  assert.equal(readback.closed,true)
})

test('machining subdivision bounds S-curves, handles degenerate chords and retains endpoints',()=>{
  const curves=[{p0:{x:0,y:0},p1:{x:40,y:80},p2:{x:60,y:-80},p3:{x:100,y:0}},
    {p0:{x:0,y:0},p1:{x:40,y:50},p2:{x:-40,y:50},p3:{x:0,y:0}}]
  for(const curve of curves) {
    const a=c.makeNode(curve.p0.x,curve.p0.y),b=c.makeNode(curve.p3.x,curve.p3.y)
    a.out=curve.p1;b.in=curve.p2
    const points=c.flattenMachiningSubpath({id:'c',closed:false,nodes:[a,b]})
    assert.deepEqual(points[0],curve.p0);assert.deepEqual(points.at(-1),curve.p3)
    for(let i=0;i<=2000;i++) {
      const t=i/2000,p={x:bernstein(curve.p0.x,curve.p1.x,curve.p2.x,curve.p3.x,t),y:bernstein(curve.p0.y,curve.p1.y,curve.p2.y,curve.p3.y,t)}
      let error=Infinity
      for(let j=1;j<points.length;j++)error=Math.min(error,distance(p,points[j-1],points[j]))
      assert.ok(error<=.00501,`Curve error ${error}`)
    }
  }
})

test('short intentional corners and closing edges are retained; straight lines stay straight',()=>{
  const doc=c.createBlankDocument(),vertices=[{x:20,y:20},{x:30,y:20},{x:30,y:30},{x:20.003,y:20.004}]
  doc.layers[0].shapes=[c.makeShape('path',[{id:'notch',closed:true,nodes:vertices.map(p=>c.makeNode(p.x,p.y))}])]
  doc.production.kerf=0;doc.production.optimizeOrder=false
  const points=c.getProductionJob(doc).paths[0].points
  assert.deepEqual(points,vertices)
  assert.equal(c.flattenMachiningSubpath(c.createRectShape(20,20,40,30).subpaths[0]).length,4)
})

test('pattern shortcuts open the chosen mode and store patterns keep a selected assembly together with undo',()=>{
  const store=new c.EditorStore(),doc=c.createBlankDocument()
  doc.layers[0].shapes=[c.createRectShape(10,10,10,10),c.createRectShape(30,10,20,10)]
  store.loadDocument(doc);store.setSelection(doc.layers[0].shapes.map(s=>s.id))
  store.openPatterns('radial');assert.equal(store.getState().patternTab,'radial');assert.equal(store.getState().rightTab,'patterns')
  store.openPatterns('grid');store.setGridPattern({columns:2,rows:1,mode:'spacing',dx:5})
  assert.equal(store.applyGridPattern(),2)
  const shapes=store.getState().doc.layers[0].shapes
  assert.equal(c.shapeBounds(shapes[2]).x-c.shapeBounds(shapes[0]).x,45)
  assert.equal(c.shapeBounds(shapes[3]).x-c.shapeBounds(shapes[1]).x,45)
  store.undo();assert.equal(store.getState().doc.layers[0].shapes.length,2)
})
