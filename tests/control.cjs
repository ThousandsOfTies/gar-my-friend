'use strict';
const {test}=require('node:test');
const assert=require('node:assert/strict');
const {FriendRuntime}=require('../application/friend-runtime.cjs');
const {execute,startControl,requestControl,config}=require('../application/friend-control.cjs');
const {expressions}=require('../shared/expressions.json');

test('Live expression tools use canonical faces and preserve transitions',async()=>{
  const friend=new FriendRuntime();const before=friend.frame();
  assert.deepEqual(config.tools[0].parameters.properties.emotion.enum,expressions.map(e=>e.id));
  assert.deepEqual(await execute(friend,{type:'tool',name:'change_emotion',args:{emotion:'happy'}}),{status:'ok',expression:'happy'});
  assert.deepEqual(friend.frame(),before);friend.advance(450);assert.deepEqual(friend.frame().pose,expressions[1].pose);
  await assert.rejects(execute(friend,{type:'tool',name:'change_emotion',args:{emotion:'anything'}}),/Unknown expression/);
  await assert.rejects(execute(friend,{type:'tool',name:'change_emotion',args:{emotion:'sad',extra:1}}),/invalid arguments/);
  assert.equal(friend.face.expressionId,'happy');
});
test('tool motion waits for real completion and does not invent a starting pose',async()=>{
  let finish;const calls=[];
  const friend=new FriendRuntime({servo:{perform(mode,options){calls.push({mode,options});return new Promise(resolve=>{finish=()=>resolve(true);});}}});
  await assert.rejects(execute(friend,{type:'tool',name:'move_body',args:{mode:'lie'}}),/starting pose/);assert.equal(calls.length,0);
  let complete=false;const work=execute(friend,{type:'tool',name:'move_body',args:{mode:'lie'},from:'stand'}).then(value=>{complete=true;return value;});
  await Promise.resolve();assert.equal(complete,false);assert.deepEqual(calls,[{mode:'lie',options:{from:'stand'}}]);finish();
  assert.deepEqual(await work,{status:'completed',mode:'lie',pwm:'off'});
  await assert.rejects(execute(friend,{type:'tool',name:'run_shell',args:{command:'anything'}}),/Unknown tool/);
});
test('local socket routes state, emotion and playback, and closes mouth on shutdown',{skip:process.platform!=='linux'},async t=>{
  const fs=require('node:fs/promises'),os=require('node:os'),path=require('node:path');
  const directory=await fs.mkdtemp(path.join(os.tmpdir(),'friend-ipc-')),socket=path.join(directory,'friend.sock');
  const friend=new FriendRuntime(),control=await startControl(socket,friend);
  t.after(async()=>{await control.close();await fs.rm(directory,{recursive:true,force:true});});
  assert.equal((await requestControl(socket,{type:'state'})).expression,'neutral');
  await requestControl(socket,{type:'speaking',value:true});assert.equal(friend.face.speaking,true);
  await requestControl(socket,{type:'tool',name:'change_emotion',args:{emotion:'wink'}});friend.advance(450);assert.equal(friend.face.expressionId,'wink');
  await assert.rejects(requestControl(socket,{type:'tool',name:'move_body',args:{mode:'forward'},from:'stand'}),/disabled/);
  await assert.rejects(startControl(socket,friend),/already active/);
  await control.close();assert.equal(friend.face.speaking,false);
});
