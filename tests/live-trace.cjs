'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),{EventEmitter}=require('node:events');
const observe=require('../tools/live-trace.cjs');

test('live observation separates model turns from new input and restores handlers without saving payloads',async()=>{
  const audio=new EventEmitter();audio.playing=false;
  const client={ready:true,send(){return true;},emit(){}};
  const originalSend=client.send,originalEmit=client.emit;
  const session={started:true,closed:false,duplex:false,client,audio};
  const pending=observe.call([session],20,false);
  client.send({realtimeInput:{audio:{data:'PRIVATE_PCM'}}});
  for(let i=0;i<2;i++){
    client.emit('audio',{});
    client.emit('transcript',{role:'model',text:'PRIVATE_TEXT_REPEAT'});
    client.send({realtimeInput:{audioStreamEnd:true}});
    client.emit('turn-end',{});
  }
  client.emit('transcript',{role:'user',text:'PRIVATE_TEXT_REPEAT'});
  const result=await pending;
  assert.equal(result.trace.activeSessions,1);
  assert.equal(result.trace.counts.modelTurns,2);
  assert.equal(result.trace.counts.pcmPacketsSent,1);
  assert.ok(result.trace.events.some(event=>event.type==='input-transcript'&&event.echoCandidate));
  assert.ok(!JSON.stringify(result).includes('PRIVATE_'));
  assert.equal(client.send,originalSend);assert.equal(client.emit,originalEmit);
  assert.equal(audio.listenerCount('playback'),0);
});

test('no-ready and multiple-session observations do not alter sessions',()=>{
  for(const sessions of [[],[{started:true,client:{ready:false}}],[{started:true,client:{ready:true}},{started:true,client:{ready:true}}]]){
    const result=observe.call(sessions,20,false);
    assert.equal(result.trace.reason,'expected_one_active_session');
    assert.equal(result.trace.restored,true);
  }
});
