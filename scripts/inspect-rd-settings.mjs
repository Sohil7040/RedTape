import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

// Independent read-only inspector: no controller access or production encoder imports.
export function inspectRDSettings(bytes) {
  const decoded = [...bytes].map(b => { const n = ((b - 1) & 255) ^ 0x88; return (n & 126) | ((n & 1) << 7) | (n >> 7) })
  const starts = decoded.flatMap((b,i) => b >= 128 ? [i] : [])
  const number = data => data.reduce((n,b) => n * 128 + b, 0)
  const headers = new Map(), runtime = [], inline = new Map()
  let layer = null, current = {}
  for (let i=0;i<starts.length;i++) {
    const c=decoded.slice(starts[i],starts[i+1] ?? decoded.length)
    const header=(id)=>{if(!headers.has(id))headers.set(id,{layer:id});return headers.get(id)}
    if(c[0]===0xc9 && c[1]===4 && c.length===8)header(c[2]).speed=number(c.slice(3))/1000
    if(c[0]===0xc6 && [0x31,0x32].includes(c[1]) && c.length===5)header(c[2])[c[1]===0x31?'minPower':'maxPower']=number(c.slice(3))/16383*100
    if(c[0]===0xca && c[1]===2 && c.length===3){layer=c[2];current={layer}}
    if(c[0]===0xc9 && c[1]===2 && c.length===7)current.speed=number(c.slice(2))/1000
    if(c[0]===0xc6 && [1,2].includes(c[1]) && c.length===4)current[c[1]===1?'minPower':'maxPower']=number(c.slice(2))/16383*100
    if(c[0]===0xca && c[1]===1 && [0x12,0x13].includes(c[2]))current.airAssist=c[2]===0x13
    if([0xc7,0xc8].includes(c[0]) && c.length===3) {
      const power=number(c.slice(1))/16383*100,key=`${layer}:${c[0]}`
      const item=inline.get(key) ?? {layer,command:c[0].toString(16).toUpperCase(),count:0,minPower:power,maxPower:power}
      item.count++;item.minPower=Math.min(item.minPower,power);item.maxPower=Math.max(item.maxPower,power);inline.set(key,item)
    }
    if(c[0]===0xca && c[1]===0x10)runtime.push({...current})
  }
  return {headers:[...headers.values()],runtime,inlinePowerOverrides:[...inline.values()]}
}
if(process.argv[1] && path.resolve(process.argv[1])===fileURLToPath(import.meta.url)) {
  if(process.argv.length<3)throw new Error('Usage: node scripts/inspect-rd-settings.mjs file.rd [other.rd]')
  for(const file of process.argv.slice(2))console.log(JSON.stringify({file,...inspectRDSettings(fs.readFileSync(file))},null,2))
}
