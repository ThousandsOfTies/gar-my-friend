'use strict';
const {config,execute}=require('./friend-control.cjs');

/** Same semantic tools as the WebPanel; audio and provider are replaceable I/O. */
class LiveSession{
  constructor({friend,audio,createClient,allowBody=false,from=null,duplex=false,onStatus=()=>{},onFailure=()=>{}}){
    if(allowBody&&!['stand','lie'].includes(from))throw new Error('Confirm the starting pose for body tools');
    this.friend=friend;this.audio=audio;this.allowBody=allowBody;this.from=from;this.duplex=duplex;this.onStatus=onStatus;this.onFailure=onFailure;
    this.closed=false;this.started=false;this.muted=false;this.tailUntil=0;this.listeners=[];
    this.client=createClient({onTool:async(call,{signal})=>{
      if(this.closed||signal.aborted)throw new Error('Conversation ended');
      if(call.name==='move_body'&&!this.allowBody)throw new Error('Body tools are disabled');
      const result=await execute(friend,{type:'tool',name:call.name,args:call.args,from:this.from});
      if(!this.closed&&!signal.aborted&&call.name==='move_body'&&call.args.mode!=='stop')this.from=call.args.mode==='lie'?'lie':'stand';
      return result;
    }});
    const listen=(source,event,handler)=>{
      if(source.addEventListener){source.addEventListener(event,handler);this.listeners.push(()=>source.removeEventListener(event,handler));}
      else{source.on(event,handler);this.listeners.push(()=>source.off(event,handler));}
    };
    listen(audio,'input',bytes=>{
      if(!this.closed&&!this.muted&&(this.duplex||!audio.playing&&Date.now()>=this.tailUntil))try{this.client.sendAudio(bytes);}catch(error){this.fail(error);}
    });
    listen(audio,'playback',playing=>{
      if(this.closed)return;friend.face.setSpeaking(playing);
      if(playing&&!this.duplex)this.client.audioEnd();
      if(!playing)this.tailUntil=Date.now()+250;
      this.onStatus(playing?'speaking':this.muted?'muted':'listening');
    });
    listen(audio,'failure',error=>this.fail(error));
    listen(this.client,'audio',({detail})=>{if(!this.closed)try{audio.playPcm(detail.bytes,{sampleRate:detail.sampleRate});}catch(error){this.fail(error);}});
    listen(this.client,'turn-end',()=>{if(!this.closed)audio.endTurn();});
    listen(this.client,'interrupted',()=>{if(!this.closed)audio.stopPlayback().catch(error=>this.fail(error));});
    listen(this.client,'cancel',()=>{if(!this.closed&&friend.servo)friend.command('stop').catch(error=>this.fail(error));});
    listen(this.client,'error',({detail})=>this.fail(new Error(detail)));
  }
  async start({apiKey,ephemeralToken,apiVersion,model=config.model,voice=config.voice}={}){
    if(this.closed||this.started)throw new Error('Conversation is closed or already started');this.started=true;
    try{
      this.onStatus('connecting');
      await this.audio.start();if(this.closed)return;
      const bodyInstruction=this.allowBody?
        '\n現在のセッションでは身体操作が許可されています。準備状況と実行結果に従って応答してください。':
        '\n現在のセッションでは身体操作は無効です。顔の表情と会話は使えますが、脚は操作できません。身体への指示の意味は理解したうえで、例えば前進の依頼には「前に歩くんだね。今は脚の操作が無効だから、まだ動けないよ」のように短く自然に答えてください。身体を動かしたとは説明しません。';
      await this.client.connect({apiKey,ephemeralToken,apiVersion,model,voice,instruction:config.instruction+bodyInstruction,tools:config.tools.filter(tool=>this.allowBody||tool.name!=='move_body')});
      if(this.closed)return;this.onStatus('ready');this.onStatus(this.muted?'muted':'listening');this.client.text(this.muted?'短く挨拶して、マイク送信は停止中と伝えてください。':'こんにちは。短く自己紹介して挨拶してください。');
    }catch(error){await this.close();throw error;}
  }
  setMuted(value){this.muted=Boolean(value);if(!this.started)return;if(this.muted)this.client.audioEnd();this.onStatus(this.muted?'muted':'listening');}
  fail(error){if(this.closed)return;this.close().then(()=>this.onFailure(error),()=>this.onFailure(error));}
  async close(){
    if(this.closed)return this.closing;this.closed=true;this.client.stop();for(const remove of this.listeners)remove();this.friend.face.setSpeaking(false);
    this.closing=Promise.allSettled([this.audio.close(),...(this.friend.servo?[this.friend.command('stop')]:[])]);await this.closing;
  }
}
module.exports={LiveSession};
