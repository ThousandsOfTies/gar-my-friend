'use strict';
const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs/promises');
const os=require('node:os');
const path=require('node:path');
const {FriendRuntime}=require('../application/friend-runtime.cjs');
const {FaceRuntime}=require('../application/face-runtime.cjs');
const {ServoOutput}=require('../application/servo-output.cjs');
const {SpeechOutput}=require('../application/speech-output.cjs');
const {loadEffects}=require('../application/effect-config.cjs');
const {processJob}=require('../application/process-job.cjs');

test('application coordinates face, voice and bounded neutral only on press',async()=>{
  const calls=[],face=new FaceRuntime();
  const friend=new FriendRuntime({face,servo:{async neutral(){calls.push('neutral');},async close(){calls.push('servo off');}},speech:{async say(text){calls.push(text);},async close(){calls.push('voice off');}}});
  friend.input({action:'rotate',direction:1});assert.equal(face.expressionId,'happy');assert.equal(calls.length,0);
  friend.input({action:'press'});assert.equal(calls[0],'neutral');assert.match(calls[1],/うれしい/);
  await friend.close();assert.deepEqual(calls.slice(-2),['servo off','voice off']);
  const before=calls.length;friend.input({action:'press'});assert.equal(calls.length,before);
});

test('lip animation stops with playback and preserves blink behavior',()=>{
  const face=new FaceRuntime();face.setSpeaking(true);face.input({action:'press'});face.advance(90);
  assert.equal(face.frame().effects.blink,1);assert.ok(face.frame().effects.talk>0);
  face.setSpeaking(false);assert.equal(face.frame().effects.talk,0);
});

test('missing or disabled outputs preserve older face-only Products',async()=>{
  const directory=await fs.mkdtemp(path.join(os.tmpdir(),'friend-config-'));
  try{
    assert.deepEqual(loadEffects(directory),{servo:null,speech:null});
    await fs.writeFile(path.join(directory,'effects.csv'),'kind,enabled\nservo,0\nspeech,0\n');
    assert.deepEqual(loadEffects(directory),{servo:null,speech:null});
    await fs.writeFile(path.join(directory,'effects.csv'),'kind,enabled\nservo,1\n');
    assert.throws(()=>loadEffects(directory),/Missing servo config/);
  }finally{await fs.rm(directory,{recursive:true,force:true});}
});

test('native servo shutdown waits for cancellation then sends explicit off with the same stop marker',async()=>{
  const calls=[];let cancel;
  const servo=new ServoOutput({i2c:'/config/i2c.csv',calibration:'/config/servo.csv',holdMs:250,stopFile:'/run/friend/servo.stop'},{binary:'/bin/gar-servoctl',job(binary,args,options){
    calls.push({binary,args,options});
    if(args.includes('neutral'))return {promise:new Promise((resolve,reject)=>{cancel=()=>reject(new Error('cancelled'));}),cancel(){cancel();}};
    return {promise:Promise.resolve(),cancel(){}};
  }});
  assert.equal(calls.length,0);
  const active=servo.neutral();active.catch(()=>{});assert.equal(await servo.neutral(),false);
  await servo.close();await assert.rejects(active,/cancelled/);
  assert.ok(calls[0].args.includes('--ack-all'));assert.deepEqual(calls[1].args.slice(-2),['off','all']);
  assert.ok(calls.every(call=>call.options.env.GAR_SERVO_STOP_FILE==='/run/friend/servo.stop'));
});

test('speech pipes Japanese text to TTS and uses ALSA only after WAV generation',async()=>{
  const calls=[],speaking=[];let wave;
  const voice=new SpeechOutput({dictionary:'/dictionary',voice:'/voice.htsvoice',speed:1,device:'plughw:CARD=USB,DEV=0'},{onSpeaking:value=>speaking.push(value),job(command,args,options){
    calls.push({command,args,options});
    return {promise:(async()=>{if(command==='open_jtalk'){wave=args[args.indexOf('-ow')+1];const header=Buffer.alloc(44);header.write('RIFF');header.write('WAVE',8);await fs.writeFile(wave,header);}})(),cancel(){}};
  }});
  assert.equal(await voice.say('こんにちは。「$()」も文字です。'),true);
  assert.equal(calls[0].command,'open_jtalk');assert.equal(calls[0].options.input,'こんにちは。「$()」も文字です。\n');
  assert.deepEqual(calls[1].args.slice(0,3),['-q','-D','plughw:CARD=USB,DEV=0']);
  assert.deepEqual(speaking,[true,false]);await assert.rejects(fs.stat(wave),{code:'ENOENT'});
});

test('bad TTS output never starts playback or leaves the mouth talking',async()=>{
  const calls=[],speaking=[];
  const voice=new SpeechOutput({dictionary:'/dictionary',voice:'/voice',speed:1,device:'default'},{onSpeaking:value=>speaking.push(value),job(command,args){calls.push(command);return {promise:fs.writeFile(args[args.indexOf('-ow')+1],'broken'),cancel(){}};}});
  await assert.rejects(voice.say('テスト'),/bounded WAV/);assert.deepEqual(calls,['open_jtalk']);assert.deepEqual(speaking,[false]);
  await assert.rejects(voice.say('x'.repeat(301)),/1..300/);
});

test('closing during synthesis cancels the child without starting audio',async()=>{
  let cancel,started;const ready=new Promise(resolve=>{started=resolve;}),calls=[];
  const voice=new SpeechOutput({dictionary:'/dictionary',voice:'/voice',speed:1,device:'default'},{job(command){calls.push(command);started();return {promise:new Promise((resolve,reject)=>{cancel=()=>reject(new Error('cancelled'));}),cancel(){cancel();}};}});
  const pending=voice.say('こんにちは');pending.catch(()=>{});await ready;
  assert.equal(await voice.say('重ねない'),false);await voice.close();await assert.rejects(pending,/cancelled/);assert.deepEqual(calls,['open_jtalk']);
});

test('process timeout remains failure even if the cancelled child exits zero',async()=>{
  const {EventEmitter}=require('node:events');const child=new EventEmitter();
  child.stderr=new EventEmitter();child.stdin=new EventEmitter();child.stdin.end=()=>{};
  child.kill=()=>{queueMicrotask(()=>child.emit('close',0,null));};
  const task=processJob('fixture',[],{timeoutMs:10,spawnProcess(command,args,options){assert.equal(options.shell,false);return child;}});
  await assert.rejects(task.promise,/timed out/);
});
