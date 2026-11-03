'use strict';
const {config}=require('./friend-control.cjs');
const {FriendConversation}=require('./conversation.cjs');

/** Same semantic tools as the WebPanel; audio and provider are replaceable I/O. */
class LiveSession{
  constructor({friend,audio,createClient,allowBody=false,from=null,askPose=false,duplex=false,onStatus=()=>{},onFailure=()=>{}}){
    this.conversation=new FriendConversation(friend,{allowBody,from,askPose});
    this.friend=friend;this.audio=audio;this.allowBody=allowBody;this.duplex=duplex;this.onStatus=onStatus;this.onFailure=onFailure;
    this.closed=false;this.started=false;this.muted=false;this.tailUntil=0;this.listeners=[];
    this.client=createClient({onTool:(call,context)=>this.tool(call,context)});
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
    listen(this.client,'transcript',({detail})=>this.conversation.transcript(detail));
    listen(this.client,'interrupted',()=>{if(!this.closed)audio.stopPlayback().catch(error=>this.fail(error));});
    listen(this.client,'cancel',()=>{if(!this.closed&&friend.servo){this.conversation.cancel().catch(error=>this.fail(error));}});
    listen(this.client,'error',({detail})=>this.fail(new Error(detail)));
  }
  get from(){return this.conversation.from;}
  bodyState(){return this.conversation.bodyState();}
  tool(call,context){return this.conversation.tool(call,context);}
  async start({apiKey,ephemeralToken,apiVersion,model=config.model,voice=config.voice}={}){
    if(this.closed||this.started)throw new Error('Conversation is closed or already started');this.started=true;
    try{
      this.onStatus('connecting');
      await this.audio.start();if(this.closed)return;
      const prepared=this.conversation.configuration({muted:this.muted});
      await this.client.connect({apiKey,ephemeralToken,apiVersion,model,voice,instruction:prepared.instruction,tools:prepared.tools});
      if(this.closed)return;this.onStatus('ready');this.onStatus(this.muted?'muted':'listening');this.client.text(prepared.greeting);
    }catch(error){await this.close();throw error;}
  }
  setMuted(value){this.muted=Boolean(value);if(!this.started)return;if(this.muted)this.client.audioEnd();this.onStatus(this.muted?'muted':'listening');}
  fail(error){if(this.closed)return;this.close().then(()=>this.onFailure(error),()=>this.onFailure(error));}
  async close(){
    if(this.closed)return this.closing;this.closed=true;this.client.stop();for(const remove of this.listeners)remove();this.friend.face.setSpeaking(false);
    this.closing=Promise.allSettled([this.audio.close(),this.conversation.close()]);await this.closing;
  }
}
module.exports={LiveSession};
