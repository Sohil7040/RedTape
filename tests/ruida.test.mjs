import assert from 'node:assert/strict'
import { test } from 'node:test'
import fs from 'node:fs'
import { fileURLToPath } from 'node:url'
import { loadCore } from '../scripts/load-core.mjs'
const c = await loadCore()
// Independent decoder: do not use production LUTs or coordinate encoders.
function raw(bytes) {
  return [...bytes].map(b => { const v = (((b - 1) & 255) ^ 0x88); return (v & 126) | ((v & 1) << 7) | (v >> 7) })
}
const number = bytes => bytes.reduce((n, b) => n * 128 + b, 0)
function commands(bytes) {
  const data = raw(bytes), starts = data.flatMap((b, i) => b >= 128 ? [i] : [])
  return starts.map((start, i) => data.slice(start, starts[i + 1] ?? data.length))
}
function find(cmds, a, b) { return cmds.find(cmd => cmd[0] === a && cmd[1] === b) }
function square() {
  const doc = c.createBlankDocument({ name: 'SQUARE' })
  doc.layers[0].shapes = [c.createRectShape(20, 30, 20, 20)]
  doc.production.leadIn = 0; doc.production.leadOut = 0; doc.production.kerf = 0
  doc.production.layers[doc.layers[0].id] = { ...c.defaultLayerOperation(), speed: 30, minPower: 20, maxPower: 50, power: 50 }
  return doc
}
const fixture = name => fs.readFileSync(new URL(`fixtures/controller/${name}`, import.meta.url))

// Decode absolute and signed relative motion independently of the app parser.
function motionSegments(bytes) {
  let cursor = null
  const burn = [], travel = []
  const relative = data => { const n = number(data); return n > 8191 ? n - 16384 : n }
  for (const cmd of commands(bytes)) {
    const op = cmd[0]
    if (![0x88,0x89,0x8a,0x8b,0xa8,0xa9,0xaa,0xab].includes(op)) continue
    const form = op & 3
    const required = form === 0 ? 11 : form === 1 ? 5 : 3
    assert.ok(cmd.length >= required, 'Complete motion record')
    if (form !== 0) assert.ok(cursor, 'Relative motion requires a known position')
    const next = form === 0 ? [number(cmd.slice(1,6)), number(cmd.slice(6,11))]
      : form === 1 ? [cursor[0] + relative(cmd.slice(1,3)), cursor[1] + relative(cmd.slice(3,5))]
      : form === 2 ? [cursor[0] + relative(cmd.slice(1,3)), cursor[1]]
      : [cursor[0], cursor[1] + relative(cmd.slice(1,3))]
    if (op >= 0xa0) { assert.ok(cursor, 'Burn requires a known start'); burn.push([cursor, next]) }
    else travel.push([cursor, next])
    cursor = next
  }
  return { burn, travel }
}
const segmentKey = segment => segment.map(p => p.join(',')).sort().join('|')
function assertEdgeCoverage(segments, edges, passes = 1) {
  const intervals = edges.map(() => [])
  for (const [a,b] of segments) {
    if (a[0] === b[0] && a[1] === b[1]) continue
    const i = edges.findIndex(([p,q]) => {
      const axis = p[0] === q[0] ? 1 : 0, fixed = 1-axis
      return a[fixed] === p[fixed] && b[fixed] === p[fixed] &&
        Math.min(a[axis],b[axis]) >= Math.min(p[axis],q[axis]) &&
        Math.max(a[axis],b[axis]) <= Math.max(p[axis],q[axis])
    })
    assert.ok(i >= 0, `Unexpected burn segment ${segmentKey([a,b])}`)
    const axis = edges[i][0][0] === edges[i][1][0] ? 1 : 0
    intervals[i].push([Math.min(a[axis],b[axis]), Math.max(a[axis],b[axis])])
  }
  edges.forEach(([p,q],i) => {
    const axis = p[0] === q[0] ? 1 : 0, lo = Math.min(p[axis],q[axis]), hi = Math.max(p[axis],q[axis])
    const stops = [...new Set([lo,hi,...intervals[i].flat()])].sort((a,b)=>a-b)
    for (let j=1;j<stops.length;j++) {
      const mid = (stops[j-1]+stops[j])/2
      assert.equal(intervals[i].filter(([a,b]) => a < mid && mid < b).length, passes,
        `Edge ${i}, interval ${stops[j-1]}..${stops[j]}`)
    }
  })
}

test('native RDWorks square burns exactly its four design edges', () => {
  const native = motionSegments(fixture('20MMSQR.RD'))
  const edges = [[[0,0],[20000,0]], [[20000,0],[20000,20000]],
    [[20000,20000],[0,20000]], [[0,20000],[0,0]]]
  assert.equal(native.travel.length, 1)
  assertEdgeCoverage(native.burn, edges)
  assertEdgeCoverage(motionSegments(c.buildJobRD(square())).burn, edges)
})

test('nested cuts and separate score burn only design edges at every origin and pass', () => {
  const outlines = [[[20,20],[80,20],[80,60],[20,60]], [[35,30],[45,30],[45,40],[35,40]]]
  for (const origin of ['top-left','top-right','bottom-left','bottom-right']) {
    const doc = square(), score = c.makeLayer('Score', '#ff0000')
    doc.layers[0].shapes = [c.createRectShape(20,20,60,40), c.createRectShape(35,30,10,10)]
    score.shapes = [c.createLineShape({x:45,y:45},{x:60,y:45})]
    doc.layers.push(score)
    doc.production.layers[doc.layers[0].id].passes = 2
    doc.production.layers[score.id] = {...c.defaultLayerOperation('score'), passes:2}
    doc.production.originCorner = origin
    doc.production.leadMode = 'contour-only'
    doc.production.leadIn = 5; doc.production.leadOut = 5
    const map = ([x,y]) => [(origin.endsWith('right') ? 80-x : x-20)*1000,
      (origin.startsWith('bottom') ? 60-y : y-20)*1000]
    const edges = outlines.flatMap(points => points.map((p,i) => [map(p),map(points[(i+1)%4])]))
    edges.push([map([45,45]),map([60,45])])
    const actual = motionSegments(c.buildJobRD(doc))
    assert.equal(actual.travel.length, 6, origin)
    assertEdgeCoverage(actual.burn, edges, 2)
  }
})

test('commands match lengths observed in working controller files', () => {
  const lengths = new Map()
  for (const name of ['20MMSQR.RD', 'CIR.RD']) for (const cmd of commands(fixture(name))) {
    if ([0x88, 0xa8, 0xa9].includes(cmd[0]) || cmd[0] === 0xe7 && cmd[1] === 1) continue
    lengths.set(cmd.slice(0, 2).join(','), cmd.length)
  }
  for (const cmd of commands(c.buildJobRD(square()))) {
    if (cmd[0] === 0xa9) { assert.ok(cmd.length === 5 || cmd.length === 6 && cmd[5] === 0); continue }
    if ([0x88, 0xa8].includes(cmd[0])) { assert.ok([11, 12].includes(cmd.length)); continue }
    if (cmd[0] === 0xe7 && cmd[1] === 1) continue
    const expected = lengths.get(cmd.slice(0, 2).join(','))
    assert.equal(cmd.length, expected, cmd.slice(0, 2).map(b => b.toString(16)).join(' '))
  }
})
test('tight 20mm frame and LCD scope agree with known-good RDWorks square', () => {
  const actual = commands(c.buildJobRD(square())), good = commands(fixture('20MMSQR.RD'))
  for (const [a, b] of [[0xe7,3],[0xe7,7],[0xe7,0x50],[0xe7,0x51],[0xf2,4],[0xf2,5],[0xf2,8],[0xe7,0x17],[0xe7,0x37],[0xe7,8]]) {
    assert.deepEqual(find(actual,a,b),find(good,a,b))
  }
  const moves = actual.filter(cmd => [0x88,0xa8].includes(cmd[0]))
  assert.equal(moves.filter(m=>m[0]===0x88).length, 1)
  let length = 0
  moves.forEach((m,i) => {
    const x=number(m.slice(1,6)), y=number(m.slice(6,11))
    assert.ok(x>=0 && x<=20000 && y>=0 && y<=20000)
    assert.ok([0,20000].includes(x) || [0,20000].includes(y))
    if(i) length+=Math.hypot(x-number(moves[i-1].slice(1,6)), y-number(moves[i-1].slice(6,11)))
  })
  assert.equal(length,80000)
})
test('laser 1 settings, second laser off, exact speeds, passes and lead geometry', () => {
  const doc = square(), layer2 = c.makeLayer('Score', '#ff0000')
  layer2.shapes = [c.createLineShape({x:60,y:40},{x:70,y:40})]
  doc.layers.push(layer2)
  doc.production.layers[layer2.id] = { ...c.defaultLayerOperation('score'), speed: 85, power: 18, minPower: 12, maxPower: 18, passes: 2 }
  doc.production.leadMode = 'all'; doc.production.leadIn = 2; doc.production.leadOut = 3
  const cmds = commands(c.buildJobRD(doc))
  assert.deepEqual(cmds.filter(x=>x[0]===0xc9&&x[1]===2).map(x=>number(x.slice(2))),[85000,30000])
  assert.deepEqual(cmds.filter(x=>x[0]===0xc6&&x[1]===2).map(x=>number(x.slice(2))),[Math.round(.18*16383),8192])
  assert.ok(cmds.filter(x=>x[0]===0xc6&&[0x21,0x22].includes(x[1])).every(x=>number(x.slice(2))===0))
  assert.equal(cmds.filter(x=>x[0]===0x88).length,3)
  assert.equal(cmds.filter(x=>x[0]===0xe7&&x[1]===0).length,1)
  const cut = cmds.filter(x=>[0xa8,0xa9].includes(x[0]))
  assert.ok(cut.length >= 8)
})
test('relative Ruida coordinates cover the signed range and preserve exact rounded positions', () => {
  for (const delta of [-8192,-8191,-1,0,1,8191]) {
    const n=number(c.encodeRuidaDelta2(delta))
    assert.equal(n>8191?n-16384:n,delta)
  }
  for(const delta of [-8193,8192,NaN,1.5])assert.throws(()=>c.encodeRuidaDelta2(delta))
  for(const origin of ['top-left','top-right','bottom-left','bottom-right']) {
    const doc=square(), pts=Array.from({length:500},(_,i)=>({x:30+i*.01337,y:40+i*.00777}))
    doc.layers[0].shapes=[c.makeShape('path',[{id:'fine',closed:false,nodes:pts.map(p=>c.makeNode(p.x,p.y))}])]
    doc.production.originCorner=origin
    const bytes=c.buildJobRD(doc), motion=motionSegments(bytes)
    assert.ok(commands(bytes).some(cmd=>cmd[0]===0xa9))
    const map=p=>[Math.round((origin.endsWith('right')?pts.at(-1).x-p.x:p.x-pts[0].x)*1000),
      Math.round((origin.startsWith('bottom')?pts.at(-1).y-p.y:p.y-pts[0].y)*1000)]
    assert.deepEqual(motion.burn.at(-1)[1],map(pts.at(-1)))
    // The full sequence is checked after production filtering; no drift may
    // occur regardless of how many short vectors were retained.
    const path=c.getProductionJob(doc).paths[0]
    assert.deepEqual(motion.burn.map(segment=>segment[1]),c.toolpathPoints(path).slice(1).map(map))
  }
})
test('reject invalid geometry/settings instead of clamping silently', () => {
  assert.throws(()=>c.buildJobRD(c.createBlankDocument()),/No machinable/)
  for (const change of [d=>d.layers[0].shapes=[c.createRectShape(-5,10,20,20)],
    d=>d.production.layers[d.layers[0].id].speed=NaN,
    d=>d.production.layers[d.layers[0].id].passes=1.5,
    d=>d.production.layers[d.layers[0].id].minPower=80,
    d=>d.production.layers[d.layers[0].id].maxPower=100]) {
    const doc=square();change(doc);assert.throws(()=>c.buildJobRD(doc))
  }
  assert.throws(()=>c.buildJobRLD(square()),/not implemented/)
})
test('every origin yields the same tight frame and one closed contour', () => {
  for (const origin of ['top-left','top-right','bottom-left','bottom-right']) {
    const doc=square();doc.production.originCorner=origin
    const cmds=commands(c.buildJobRD(doc))
    assert.equal(number(find(cmds,0xe7,7).slice(2,7)),20000)
    const moves=cmds.filter(x=>[0x88,0xa8].includes(x[0]))
    assert.deepEqual(moves[0].slice(1,11),moves.at(-1).slice(1,11))
  }
})
test('original failing file demonstrates malformed bounding box records', () => {
  const old=commands(fixture('GENETIC.RD'))
  assert.equal(find(old,0xe7,7).length,22)
  assert.equal(find(old,0xe7,0x51).length,22)
  assert.equal(find(old,0xe7,0x52).length,12)
  assert.equal(find(old,0xe7,0x53).length,15)
})
test('read back native RD absolute and relative square/circle geometry', () => {
  for (const name of ['20MMSQR.RD','CIR.RD']) {
    const result=c.parseRD(fixture(name))
    assert.equal(result.shapes.length,1)
    const b=c.selectionBounds(result.shapes)
    assert.ok(b.w>=19.99 && b.w<=25.01)
    assert.ok(b.h>=19.99 && b.h<=25.01)
    assert.ok(result.shapes[0].subpaths[0].closed)
    const imported=c.parseVectorFile('',name,c.createBlankDocument().page,fixture(name))
    assert.equal(imported.format,'RD')
    assert.equal(imported.shapes.length,1)
  }
})
test('bridge rejects storage writes by default before touching the controller', async () => {
  const { loadConfigFromFile } = await import('vite')
  const saved=process.env.RUIDA_ALLOW_WRITES
  delete process.env.RUIDA_ALLOW_WRITES
  try {
    const result=await loadConfigFromFile({command:'serve',mode:'test'},fileURLToPath(new URL('../vite.config.ts',import.meta.url)))
    const bridge=result.config.plugins.flat().find(p=>p.name==='ruida-laser-bridge')
    let handler
    bridge.configureServer({middlewares:{use:h=>handler=h}})
    for(const endpoint of ['upload-to-storage','send']) {
      let body
      const res={writableEnded:false,setHeader(){},end(s){body=JSON.parse(s);this.writableEnded=true}}
      handler({url:`/api/ruida/${endpoint}`,method:'POST',headers:{}},res,()=>assert.fail('Unexpected next'))
      assert.equal(res.statusCode,403)
      assert.equal(body.success,false)
      assert.match(body.error,/Read-only/)
    }
  } finally {
    if(saved===undefined)delete process.env.RUIDA_ALLOW_WRITES
    else process.env.RUIDA_ALLOW_WRITES=saved
  }
})
test('offline SVG CLI shares valid RD records and requires physical sizing', async () => {
  const { mkdtempSync, rmSync, writeFileSync, readFileSync } = await import('node:fs')
  const { tmpdir } = await import('node:os')
  const { join } = await import('node:path')
  const { convertSvgToRuida } = await import('../scripts/convert_svg.mjs')
  const dir=mkdtempSync(join(tmpdir(),'corelith-test-'))
  try {
    const input=join(dir,'square.svg'), output=join(dir,'SQUARE')
    writeFileSync(input,'<svg><rect width="20" height="20" y="0" x="0"/></svg>')
    await assert.rejects(convertSvgToRuida(input,output),/width-mm/)
    const result=await convertSvgToRuida(input,output,{widthMm:20,speed:30,power:50,minPower:20})
    const cmds=commands(readFileSync(result.rdFile))
    assert.deepEqual(find(cmds,0xe7,7),find(commands(fixture('20MMSQR.RD')),0xe7,7))
    assert.equal(number(find(cmds,0xc9,2).slice(2)),30000)
    assert.ok(readFileSync(result.dxfFile,'utf8').includes('ENTITIES'))
    writeFileSync(input,'<svg><g transform="scale(2)"><path d="M0 0L20 20"/></g></svg>')
    await assert.rejects(convertSvgToRuida(input,output,{widthMm:20}),/untransformed/)
  } finally { rmSync(dir,{recursive:true,force:true}) }
})
