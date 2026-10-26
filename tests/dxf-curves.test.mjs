import assert from 'node:assert/strict'
import { test } from 'node:test'
import { loadCore } from '../scripts/load-core.mjs'
const c = await loadCore()
const near = (a,b,e=1e-6) => assert.ok(Math.abs(a-b)<=e,`${a} differs from ${b}`)
const dxf = (entities, units=4) => `0\nSECTION\n2\nHEADER\n9\n$INSUNITS\n70\n${units}\n0\nENDSEC\n0\nSECTION\n2\nENTITIES\n${entities}0\nENDSEC\n0\nEOF\n`
const parse = (entities,units) => c.parseVectorFile(dxf(entities,units),'arcs.dxf',c.createBlankDocument().page)
function maxRadialError(sub,center,radius) {
  let error=0
  for(const seg of c.segments(sub)) for(let i=0;i<=200;i++) {
    const p=c.cubicPoint(seg,i/200)
    error=Math.max(error,Math.abs(Math.hypot(p.x-center.x,p.y-center.y)-radius))
  }
  return error
}

test('DXF ARC keeps tangent cubic geometry with radius-independent source accuracy',()=>{
  for(const radius of [0.01,12.5,1000,1000000]) {
    const result=parse(`0\nARC\n10\n0\n20\n0\n40\n${radius}\n50\n0\n51\n90\n`)
    const sub=result.shapes[0].subpaths[0],first=sub.nodes[0],last=sub.nodes.at(-1)
    assert.equal(sub.closed,false)
    assert.ok(sub.nodes.length<1000)
    near(last.x,first.x-radius,1e-7);near(last.y,first.y-radius,1e-7)
    const center={x:first.x-radius,y:first.y}
    assert.ok(maxRadialError(sub,center,radius)<0.001,`Radius ${radius} exceeded 1µm source error`)
    assert.ok(c.segments(sub).every(s=>Math.hypot(s.p1.x-s.p0.x,s.p1.y-s.p0.y)>0))
    const segments=c.segments(sub)
    for(let i=1;i<segments.length;i++) {
      const a=segments[i-1],b=segments[i]
      const cross=(a.p3.x-a.p2.x)*(b.p1.y-b.p0.y)-(a.p3.y-a.p2.y)*(b.p1.x-b.p0.x)
      near(cross,0,Math.max(1e-9,radius*radius*1e-12))
    }
  }
})

test('DXF wrapped arcs preserve counterclockwise sweep and inch units',()=>{
  const sub=parse('0\nARC\n10\n0\n20\n0\n40\n1\n50\n270\n51\n90\n',1).shapes[0].subpaths[0]
  const first=sub.nodes[0],last=sub.nodes.at(-1),b=c.pathBounds([sub])
  near(first.x,last.x);near(first.y-last.y,50.8);near(b.w,25.4,0.001)
  assert.ok(sub.nodes.some(n=>n.x>first.x+25))
})

test('DXF lightweight bulges preserve both directions and closing-edge curves',()=>{
  for(const bulge of [1,-1]) {
    const sub=parse(`0\nLWPOLYLINE\n70\n0\n10\n0\n20\n0\n42\n${bulge}\n10\n10\n20\n0\n`).shapes[0].subpaths[0]
    const first=sub.nodes[0],last=sub.nodes.at(-1)
    near(last.x-first.x,10);near(last.y,first.y)
    const center={x:(first.x+last.x)/2,y:first.y}
    assert.ok(maxRadialError(sub,center,5)<0.001)
    assert.ok(c.segments(sub).some(seg=>(c.cubicPoint(seg,0.5).y-first.y)*bulge>4.9))
  }
  const closed=parse('0\nLWPOLYLINE\n70\n1\n10\n0\n20\n0\n10\n10\n20\n0\n42\n1\n').shapes[0].subpaths[0]
  assert.equal(closed.closed,true)
  assert.ok(closed.nodes.length>3)
  near(closed.nodes[1].x-closed.nodes[0].x,10)
  assert.ok(Math.hypot(closed.nodes[0].in.x-closed.nodes[0].x,closed.nodes[0].in.y-closed.nodes[0].y)>0)
  assert.equal(c.segments(closed).length,closed.nodes.length)
})

test('legacy DXF POLYLINE bulges use the same curved geometry and straight vertices survive',()=>{
  const result=parse('0\nPOLYLINE\n70\n0\n0\nVERTEX\n10\n0\n20\n0\n42\n1\n0\nVERTEX\n10\n10\n20\n0\n0\nVERTEX\n10\n20\n20\n0\n0\nSEQEND\n0\nLINE\n10\n0\n20\n10\n11\n20\n21\n10\n')
  assert.equal(result.shapes.length,2)
  const sub=result.shapes[0].subpaths[0],last=sub.nodes.at(-1),prev=sub.nodes.at(-2)
  assert.ok(sub.nodes.length>3);near(last.x-prev.x,10);near(last.y,prev.y)
  near(last.in.x,last.x);near(prev.out.x,prev.x)
  assert.equal(result.shapes[1].subpaths[0].nodes.length,2)
})
