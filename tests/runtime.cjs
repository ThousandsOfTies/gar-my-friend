'use strict';
const {test}=require('node:test');
const assert=require('node:assert/strict');
const http=require('node:http');
const {once}=require('node:events');
const {FaceRuntime}=require('../application/face-runtime.cjs');
const {expressions}=require('../shared/expressions.json');
const {createSimulatorServer}=require('../simulation/server.cjs');

test('face application cycles in both directions and preserves interrupted transitions',()=>{
  const face=new FaceRuntime(),before=face.frame().pose;
  face.input({action:'rotate',direction:1});assert.deepEqual(face.frame().pose,before);
  face.advance(200);const middle=face.frame().pose;
  face.input({action:'rotate',direction:1});assert.deepEqual(face.frame().pose,middle);
  face.advance(450);assert.deepEqual(face.frame().pose,expressions[2].pose);
  for(let i=0;i<8;i++)face.input({action:'rotate',direction:1});
  face.advance(450);assert.deepEqual(face.frame().pose,expressions[2].pose);
  face.input({action:'rotate',direction:-1});face.advance(450);
  assert.deepEqual(face.frame().pose,expressions[1].pose);
  const saved=face.frame();assert.throws(()=>face.input({action:'rotate',direction:0}));assert.deepEqual(face.frame(),saved);
});
test('blink timing is owned by the application',()=>{
  const face=new FaceRuntime();face.input({action:'press'});face.advance(90);
  assert.equal(face.frame().effects.blink,1);face.advance(100);assert.equal(face.frame().effects.blink,0);
  face.advance(2900);assert.equal(face.frame().effects.blink,1);
});
function request(port,route,{method='GET',body,headers={}}={}){
  return new Promise((resolve,reject)=>{
    const req=http.request({host:'127.0.0.1',port,path:route,method,headers},res=>{
      const chunks=[];res.on('data',chunk=>chunks.push(chunk));res.on('end',()=>resolve({status:res.statusCode,body:Buffer.concat(chunks)}));
    });req.on('error',reject);if(body!==undefined)req.write(body);req.end();
  });
}
test('panel relays only driver frames and raw rotary actions, without application state',async t=>{
  const calls=[],frame=Buffer.alloc(115200,0x5a);
  const bridge={frame,frameId:'fixture',counter:0,status(){return {displayReady:true,frameId:this.frameId};},state(){return {io:this.status(),rotary:{ready:true,counter:this.counter}};},async inject(value){calls.push(value);if(value.action==='rotate')this.counter+=value.direction;},close(){}};
  const server=createSimulatorServer({deviceBridge:bridge});server.listen(0,'127.0.0.1');await once(server,'listening');
  t.after(()=>new Promise(resolve=>server.close(resolve)));const port=server.address().port;
  const post=(route,value,headers={})=>request(port,route,{method:'POST',body:JSON.stringify(value),headers:{'Content-Type':'application/json',...headers}});
  assert.deepEqual((await request(port,'/api/io/frame')).body,frame);
  assert.equal((await post('/api/rotary',{action:'rotate',direction:1})).status,200);
  assert.equal((await post('/api/rotary',{action:'press'})).status,200);
  assert.deepEqual(calls,[{action:'rotate',direction:1},{action:'press'}]);
  assert.deepEqual((await request(port,'/api/io/frame')).body,frame,'The bridge must never draw a face in response to a knob event');
  const state=JSON.parse((await request(port,'/api/state')).body);
  assert.deepEqual(Object.keys(state).sort(),['io','rotary']);assert.equal(state.rotary.counter,1);
  for(const route of ['/api/command','/api/scenarios','/api/recording'])assert.equal((await post(route,{type:'expression',value:'happy'})).status,404);
  for(const input of [null,[],{action:'rotate',direction:0},{action:'press',direction:1},{action:'expression',value:'happy'}])assert.equal((await post('/api/rotary',input)).status,400);
  assert.equal(calls.length,2);
  assert.equal((await post('/api/rotary',{action:'press'},{Origin:'https://untrusted.example'})).status,403);
  assert.equal((await request(port,'/health',{headers:{Host:'untrusted.example'}})).status,403);
  for(const route of ['/simulator/%2e%2e/shared/expressions.json','/simulator/%5c..%5capplication/face.cjs'])assert.equal((await request(port,route)).status,403);
  for(const route of ['/application/face.cjs','/preview/face.js','/gar-components/pca9685.js'])assert.equal((await request(port,route)).status,404);
});
