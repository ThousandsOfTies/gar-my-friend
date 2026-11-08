'use strict';
/** App-owned, payload-free observation; runs only when requested by a Product diagnostic. */
function installTrace(durationMs,closeInspector){
  // `this` is the inspector's array of actual LiveSession instances.
  const sessions=Array.from(this).filter(s=>s.started&&!s.closed&&s.client?.ready);
  if(sessions.length!==1)return {ok:true,trace:{reason:'expected_one_active_session',activeSessions:sessions.length,counts:{},events:[],restored:true,durationMs:0}};
  const session=sessions[0],client=session.client,audio=session.audio;
  const now=()=>performance.now(),started=now(),events=[],counts={pcmPacketsSent:0,audioEnds:0,modelTurns:0,userTranscriptChunks:0,modelTranscriptChunks:0};
  let active=false,lastModel='',previousRole='',closed=false;
  const add=(type,data={})=>{if(events.length<1200)events.push({ms:Math.round(now()-started),type,...data});};
  const normalize=text=>text.normalize('NFKC').replace(/[\s\p{P}\p{S}]/gu,'');
  const originalSend=client.send,originalEmit=client.emit;
  client.send=function(value){
    const result=originalSend.call(this,value);
    if(result){
      if(value.realtimeInput?.audio)++counts.pcmPacketsSent;
      if(value.realtimeInput?.audioStreamEnd){++counts.audioEnds;add('audio-stream-end',{modelGenerating:active,pcmSent:counts.pcmPacketsSent});}
      if(value.toolResponse)add('tool-response',{names:(value.toolResponse.functionResponses||[]).map(c=>c.name)});
      if(value.clientContent)add('text-input');
    }
    return result;
  };
  client.emit=function(type,detail){
    if(type==='audio'&&!active){active=true;++counts.modelTurns;add('model-turn-start',{turn:counts.modelTurns,pcmSent:counts.pcmPacketsSent});}
    if(type==='turn-end'){add('model-turn-end',{turn:counts.modelTurns,pcmSent:counts.pcmPacketsSent});active=false;}
    if(type==='transcript'){
      const role=detail.role,text=normalize(detail.text||'');
      if(role==='model'){
        ++counts.modelTranscriptChunks;
        if(previousRole!=='model')lastModel='';
        lastModel=(lastModel+text).slice(-4000);
      }else{
        ++counts.userTranscriptChunks;
        add('input-transcript',{chars:text.length,modelGenerating:active,playing:audio.playing,echoCandidate:text.length>=5&&lastModel.includes(text)});
      }
      previousRole=role;
    }
    if(type==='cancel'||type==='interrupted'||type==='error')add(type);
    return originalEmit.call(this,type,detail);
  };
  const playback=playing=>add('playback',{playing,modelGenerating:active,pcmSent:counts.pcmPacketsSent});
  audio.on('playback',playback);
  add('attached',{activeSessions:1,playing:audio.playing,duplex:session.duplex});
  return new Promise(resolve=>setTimeout(()=>{
    if(closed)return;closed=true;
    client.send=originalSend;client.emit=originalEmit;audio.off('playback',playback);lastModel='';
    add('detached');
    resolve({ok:true,trace:{activeSessions:1,counts,events,restored:true,durationMs}});
    if(closeInspector)setTimeout(()=>process.getBuiltinModule('inspector').close(),300);
  },durationMs));
}
module.exports=installTrace;
