'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),{EventEmitter}=require('node:events');
const {LiveSession}=require('../application/live-session.cjs');
const {FriendRuntime}=require('../application/friend-runtime.cjs');
const {options}=require('../tools/live.cjs');
const settle=()=>new Promise(resolve=>setImmediate(resolve));
function fixture(settings={}){
  const audio=new EventEmitter();Object.assign(audio,{playing:false,async start(){this.started=true;},playPcm(bytes){this.bytes=bytes;this.playing=true;this.emit('playback',true);},endTurn(){this.ended=true;},async stopPlayback(){this.playing=false;this.emit('playback',false);},async close(){this.closed=true;}});
  const client=new EventTarget();Object.assign(client,{sent:[],async connect(config){this.config=config;},text(value){this.greeting=value;},sendAudio(bytes){this.sent.push(bytes);},audioEnd(){this.ends=(this.ends||0)+1;},stop(){this.stopped=true;},emit(type,detail){const event=new Event(type);event.detail=detail;this.dispatchEvent(event);}});
  const movements=[],friend=new FriendRuntime({servo:settings.servo?{async perform(mode,options){movements.push({mode,options});return true;}}:null});
  const errors=[],session=new LiveSession({friend,audio,createClient:config=>{client.tool=config.onTool;return client;},onFailure:error=>errors.push(error),...settings});
  return {audio,client,friend,session,errors,movements};
}
test('native session uses shared semantic tools, truthful playback state and half-duplex echo protection',async()=>{
  const f=fixture();await f.session.start({apiKey:'never-print-this'});
  assert.equal(f.client.config.tools.some(tool=>tool.name==='move_body'),false);
  const bytes=new Uint8Array([1,2]);f.audio.emit('input',bytes);assert.equal(f.client.sent.length,1);
  f.client.emit('audio',{bytes,sampleRate:24000});assert.equal(f.friend.face.speaking,true);
  f.audio.emit('input',bytes);assert.equal(f.client.sent.length,1,'Do not feed the speaker back to Gemini');
  f.client.emit('turn-end');assert.equal(f.audio.ended,true);assert.equal(f.friend.face.speaking,true,'Mouth remains active until ALSA drains');
  f.client.emit('interrupted');await settle();assert.equal(f.friend.face.speaking,false);
  await new Promise(resolve=>setTimeout(resolve,260));f.audio.emit('input',bytes);assert.equal(f.client.sent.length,2);
  await f.client.tool({name:'change_emotion',args:{emotion:'happy'}},{signal:new AbortController().signal});assert.equal(f.friend.face.expressionId,'happy');
  await assert.rejects(f.client.tool({name:'move_body',args:{mode:'lie'}},{signal:new AbortController().signal}),/disabled/);
  f.session.setMuted(true);f.audio.emit('input',bytes);assert.equal(f.client.sent.length,2);
  f.session.setMuted(false);f.audio.emit('input',bytes);assert.equal(f.client.sent.length,3);
  await f.session.close();assert.equal(f.audio.closed,true);assert.equal(f.client.stopped,true);assert.equal(f.audio.listenerCount('input'),0);
});
test('explicit body mode updates confirmed starting pose and shutdown stops motion',async()=>{
  const f=fixture({servo:true,allowBody:true,from:'stand',duplex:true});await f.session.start({apiKey:'test'});
  for(const mode of ['lie','stand'])await f.client.tool({name:'move_body',args:{mode}},{signal:new AbortController().signal});
  assert.deepEqual(f.movements,[{mode:'lie',options:{from:'stand'}},{mode:'stand',options:{from:'lie'}}]);
  f.client.emit('audio',{bytes:new Uint8Array(2),sampleRate:24000});f.audio.emit('input',new Uint8Array(2));assert.equal(f.client.sent.length,1);
  f.audio.emit('failure',new Error('USB removed'));await settle();assert.equal(f.session.closed,true);assert.equal(f.movements.at(-1).mode,'stop');assert.equal(f.errors.length,1);
});
test('preflight options require explicit body enablement and initial pose',()=>{
  assert.equal(options(['start']).body,false);assert.equal(options(['start','--duplex']).duplex,true);
  for(const args of [['start','--body'],['start','--from','stand'],['start','--unknown'],['check','--duplex']])assert.throws(()=>options(args));
});

test('connection failure closes capture, and late audio cannot revive a stopped session',async()=>{
  const f=fixture();f.client.connect=async()=>{throw new Error('Connection unavailable');};
  await assert.rejects(f.session.start({apiKey:'not-logged'}),/unavailable/);
  assert.equal(f.audio.closed,true);assert.equal(f.client.stopped,true);assert.equal(f.friend.face.speaking,false);
  f.client.emit('audio',{bytes:new Uint8Array(2),sampleRate:24000});assert.equal(f.audio.bytes,undefined);
});
