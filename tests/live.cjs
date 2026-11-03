'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),{EventEmitter}=require('node:events');
const {LiveSession}=require('../application/live-session.cjs');
const {FriendRuntime}=require('../application/friend-runtime.cjs');
const {options}=require('../tools/live.cjs');
const {bodyOptions}=require('../application/live-runtime.cjs');
const {reportedPose}=require('../application/body-pose.cjs');
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
  assert.equal(options(['start','--body','--ask-pose']).askPose,true);
  for(const args of [['start','--ask-pose'],['start','--body','--ask-pose','--from','stand']])assert.throws(()=>options(args));
  assert.deepEqual(bodyOptions({GAR_FRIEND_LIVE_BODY:'1',GAR_FRIEND_START_POSE:'ask'}),{allowBody:true,askPose:true,from:null});
  assert.throws(()=>bodyOptions({GAR_FRIEND_LIVE_BODY:'1'}));
  for(const args of [['start','--body'],['start','--from','stand'],['start','--unknown'],['check','--duplex']])assert.throws(()=>options(args));
});

test('voice confirmation records the current pose without moving and gates body commands',async()=>{
  const f=fixture({servo:true,allowBody:true,askPose:true});await f.session.start({apiKey:'test'});
  const call=(name,args={})=>f.client.tool({name,args},{signal:new AbortController().signal});
  assert.equal(f.client.config.tools.some(tool=>tool.name==='confirm_body_pose'),true);
  assert.equal((await call('get_friend_state')).body.poseConfirmationRequired,true);
  assert.equal((await call('move_body',{mode:'forward'})).reason,'pose_confirmation_required');
  assert.deepEqual(f.movements,[]);
  for(const args of [{pose:'unknown'},{pose:'lie',extra:true},[]])await assert.rejects(call('confirm_body_pose',args));
  f.client.emit('transcript',{role:'user',text:'伏せて'});
  assert.equal((await call('confirm_body_pose',{pose:'lie'})).reason,'explicit_current_pose_required');
  f.client.emit('transcript',{role:'user',text:'今は伏せています'});
  const confirmation=await call('confirm_body_pose',{pose:'lie'});
  assert.equal(confirmation.motionExecuted,false);assert.deepEqual(f.movements,[]);
  assert.equal((await call('get_friend_state')).body.poseSource,'user-confirmed');
  assert.equal((await call('move_body',{mode:'stand'})).reason,'new_motion_request_required');
  f.client.emit('transcript',{role:'user',text:'立って'});
  await call('move_body',{mode:'stand'});
  assert.deepEqual(f.movements,[{mode:'stand',options:{from:'lie'}}]);
  assert.equal((await call('get_friend_state')).body.poseSource,'command-result');
  await call('move_body',{mode:'stop'});
  assert.equal((await call('get_friend_state')).body.pose,null);
  assert.equal((await call('move_body',{mode:'lie'})).status,'blocked');
  await f.session.close();
});

test('failed motion invalidates the assumed pose and requires fresh user confirmation',async()=>{
  const f=fixture({servo:true,allowBody:true,askPose:true});await f.session.start({apiKey:'test'});
  const call=(name,args={})=>f.client.tool({name,args},{signal:new AbortController().signal});
  f.client.emit('transcript',{role:'user',text:'今は立っています'});await call('confirm_body_pose',{pose:'stand'});
  f.client.emit('transcript',{role:'user',text:'伏せて'});
  f.friend.servo.perform=async mode=>{if(mode!=='stop')throw new Error('Controller disconnected');return true;};
  await assert.rejects(call('move_body',{mode:'lie'}),/disconnected/);
  const state=await call('get_friend_state');assert.equal(state.body.pose,null);assert.equal(state.body.poseConfirmationRequired,true);
  assert.equal((await call('move_body',{mode:'forward'})).status,'blocked');
  await f.session.close();
});

test('stop or cancellation during a pending motion cannot restore a stale pose',async()=>{
  const f=fixture({servo:true,allowBody:true,askPose:true});await f.session.start({apiKey:'test'});
  const call=(name,args={})=>f.client.tool({name,args},{signal:new AbortController().signal});
  let finish;
  f.friend.servo.perform=mode=>mode==='stop'?Promise.resolve(true):new Promise(resolve=>{finish=()=>resolve(true);});
  for(const stop of [()=>call('move_body',{mode:'stop'}),async()=>{f.client.emit('cancel');await settle();}]){
    f.client.emit('transcript',{role:'user',text:'今は立っています'});await call('confirm_body_pose',{pose:'stand'});
    f.client.emit('transcript',{role:'user',text:'伏せて'});
    const motion=call('move_body',{mode:'lie'});
    await assert.rejects(call('confirm_body_pose',{pose:'lie'}),/during motion/);
    await assert.rejects(call('move_body',{mode:'forward'}),/already running/);
    await stop();finish();await motion;
    assert.equal((await call('get_friend_state')).body.pose,null);
  }
  await f.session.close();
});

test('reported current poses exclude commands, questions, uncertainty and ambiguous states',()=>{
  for(const text of ['今は立っています','立ってるよ','立ち姿勢です'])assert.equal(reportedPose(text),'stand');
  for(const text of ['今は伏せています','ふせてる','伏せ姿勢だよ'])assert.equal(reportedPose(text),'lie');
  for(const text of ['はい','伏せて','立って','立っていますか','伏せてる？','多分立ってる','立っていない','さっきは立っていた','立ってるか伏せてるか不明'])assert.equal(reportedPose(text),null);
});

test('connection failure closes capture, and late audio cannot revive a stopped session',async()=>{
  const f=fixture();f.client.connect=async()=>{throw new Error('Connection unavailable');};
  await assert.rejects(f.session.start({apiKey:'not-logged'}),/unavailable/);
  assert.equal(f.audio.closed,true);assert.equal(f.client.stopped,true);assert.equal(f.friend.face.speaking,false);
  f.client.emit('audio',{bytes:new Uint8Array(2),sampleRate:24000});assert.equal(f.audio.bytes,undefined);
});
