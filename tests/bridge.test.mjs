import assert from 'node:assert/strict'
import { test } from 'node:test'
import { EventEmitter } from 'node:events'
import { createRuidaMiddleware } from '../server/ruidaBridge.mjs'

function request(handler,path,body,extra={}){
  const req=new EventEmitter();Object.assign(req,{url:path,method:'POST',headers:{'content-type':'application/json'},...extra})
  let result
  const res={writableEnded:false,setHeader(){},end(s){this.writableEnded=true;result={status:this.statusCode,body:JSON.parse(s)}}}
  handler(req,res,()=>assert.fail('Unexpected middleware fallthrough'))
  if(body!==undefined){req.emit('data',Buffer.from(JSON.stringify(body)));req.emit('end')}
  return()=>result
}
const payload={filename:'SQUARE.RD',fileBase64:Buffer.from('fixture').toString('base64'),requestId:'request-id-12345'}
test('bridge uses explicit UDP probe on configured port and rejects cross-origin requests',()=>{
  let args
  const handler=createRuidaMiddleware({exec:(exe,a,opts,cb)=>{args=a;cb(null,JSON.stringify({online:true,transport:'UDP',port:50201}))}})
  const result=request(handler,'/api/ruida/status?ip=192.0.2.1&port=50201')()
  assert.equal(result.body.online,true);assert.ok(args.includes('--probe'));assert.ok(args.includes('50201'))
  assert.equal(request(handler,'/api/ruida/status',undefined,{headers:{origin:'http://evil.example',host:'localhost:5178'}})().status,403)
})
test('uploads are serialized, progress is observable and duplicate requests are idempotent',()=>{
  let launches=0,child
  const handler=createRuidaMiddleware({writesEnabled:true,launch:()=>{
    launches++;child=new EventEmitter();child.stdout=new EventEmitter();child.stderr=new EventEmitter();child.kill=()=>{};return child
  }})
  const first=request(handler,'/api/ruida/upload-to-storage',payload)()
  assert.equal(first.status,202);const id=first.body.transferId
  const duplicate=request(handler,'/api/ruida/upload-to-storage',payload)()
  assert.equal(duplicate.body.transferId,id);assert.equal(launches,1)
  assert.equal(request(handler,`/api/ruida/transfers/${payload.requestId}`)().body.id,id)
  assert.equal(request(handler,'/api/ruida/upload-to-storage',{...payload,filename:'OTHER.RD'})().status,409)
  const busy=request(handler,'/api/ruida/upload-to-storage',{...payload,requestId:'another-request-id'})()
  assert.equal(busy.status,409)
  child.stdout.emit('data',Buffer.from('{"event":"progress","bytesSent":3,"totalBytes":7}\n'))
  assert.equal(request(handler,`/api/ruida/transfers/${id}`)().body.bytesSent,3)
  child.stdout.emit('data',Buffer.from('{"success":true,"filename":"SQUARE.RD","bytesSent":7,"verification":"matched"}\n'))
  child.emit('close',0)
  const final=request(handler,`/api/ruida/transfers/${id}`)().body
  assert.equal(final.state,'complete');assert.equal(final.verification,'matched')
})
test('invalid payloads and unexpected child failures cannot report success',()=>{
  let child
  const handler=createRuidaMiddleware({writesEnabled:true,launch:()=>{
    child=new EventEmitter();child.stdout=new EventEmitter();child.stderr=new EventEmitter();child.kill=()=>{};return child
  }})
  for(const bad of [{...payload,filename:'../X.RD'},{...payload,fileBase64:'@@@'},{...payload,requestId:''}]){
    assert.equal(request(handler,'/api/ruida/upload-to-storage',bad)().status,400)
  }
  const started=request(handler,'/api/ruida/upload-to-storage',payload)()
  child.stderr.emit('data',Buffer.from('Transport unavailable'));child.emit('close',1)
  const result=request(handler,`/api/ruida/transfers/${started.body.transferId}`)().body
  assert.equal(result.success,false);assert.equal(result.state,'failed')
})
