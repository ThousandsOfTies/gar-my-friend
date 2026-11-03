'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {ManagedLive}=require('../application/managed-live.cjs');
const settle=()=>new Promise(resolve=>setImmediate(resolve));
async function until(predicate){for(let i=0;i<50&&!predicate();i++)await settle();assert.ok(predicate(),'Expected managed session state');}
const credentials=i=>({ephemeralToken:`auth_tokens/test-${i}`,model:'gemini-3.8-live',apiVersion:'v1alpha',expiresAt:new Date(Date.now()+30*60_000).toISOString()});
function factory(sessions,order=[]){return callbacks=>{
  order.push('create');
  const session={...callbacks,muted:false,setMuted(value){this.muted=value;},
    async start(value){this.credentials=value;order.push('start');},async close(){this.closed=true;}};
  sessions.push(session);return session;
};}

test('a fresh device token precedes audio and reconnects preserve microphone mute state',async()=>{
  let count=0;const sessions=[],order=[];
  const managed=new ManagedLive({initialMuted:true,credentials:async()=>{order.push('token');return credentials(++count);},
    createSession:factory(sessions,order),wait:async()=>{}}).start();
  await until(()=>sessions[0]?.credentials);
  assert.deepEqual(order,['token','create','start']);assert.equal(sessions[0].muted,true);
  managed.setMuted(false);sessions[0].onFailure(new Error('Expired'));
  await until(()=>sessions[1]?.credentials);
  assert.notEqual(sessions[0].credentials.ephemeralToken,sessions[1].credentials.ephemeralToken);
  assert.equal(sessions[0].closed,true);assert.equal(sessions[1].muted,false);
  await managed.close();assert.equal(sessions[1].closed,true);assert.equal(count,2);
});

test('offline authentication backs off without constructing an audio session or logging credentials',async()=>{
  let count=0;const sessions=[],delays=[],status=[];
  const managed=new ManagedLive({credentials:async()=>{if(++count<4)throw new Error('DEVICE-SECRET');return credentials(count);},
    createSession:factory(sessions),wait:async milliseconds=>{delays.push(milliseconds);},onStatus:value=>status.push(value)}).start();
  await until(()=>sessions[0]?.credentials);
  assert.deepEqual(delays,[1000,2000,4000]);assert.equal(sessions.length,1);
  assert.ok(!status.join(' ').includes('DEVICE-SECRET'));await managed.close();
});

test('shutdown aborts token acquisition and a late token cannot begin microphone capture',async()=>{
  const sessions=[];let seenSignal;
  const managed=new ManagedLive({credentials:signal=>new Promise(resolve=>{
    seenSignal=signal;signal.addEventListener('abort',()=>resolve(credentials(1)),{once:true});
  }),createSession:factory(sessions)}).start();
  await until(()=>seenSignal);await managed.close();
  assert.equal(seenSignal.aborted,true);assert.equal(sessions.length,0);
});

test('a body-enabled session must be explicitly restarted after disconnection',async()=>{
  const sessions=[],failures=[];let count=0;
  const managed=new ManagedLive({retry:false,credentials:async()=>credentials(++count),createSession:factory(sessions),
    onFailure:error=>failures.push(error.message)}).start();
  await until(()=>sessions[0]?.credentials);sessions[0].onFailure(new Error('Connection gone'));
  await until(()=>failures.length===1);assert.equal(count,1);assert.equal(sessions[0].closed,true);
  assert.match(failures[0],/confirm the body pose/);await managed.close();
});
