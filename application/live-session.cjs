'use strict';
const {config,execute}=require('./friend-control.cjs');
const {reportedPose}=require('./body-pose.cjs');
const POSES=['stand','lie'];
const poseTool={name:'confirm_body_pose',description:'利用者が実物の現在の脚の姿勢を明示したときだけ記録する。脚は動かさない。「立って」「伏せて」という動作命令だけでは確認にならない。',
  parameters:{type:'object',properties:{pose:{type:'string',enum:POSES}},required:['pose']}};

/** Same semantic tools as the WebPanel; audio and provider are replaceable I/O. */
class LiveSession{
  constructor({friend,audio,createClient,allowBody=false,from=null,askPose=false,duplex=false,onStatus=()=>{},onFailure=()=>{}}){
    if(allowBody&&!POSES.includes(from)&&!askPose)throw new Error('Confirm the starting pose or enable voice pose confirmation');
    if(askPose&&from!==null)throw new Error('Voice pose confirmation must start without a saved pose');
    this.friend=friend;this.audio=audio;this.allowBody=allowBody;this.from=allowBody?from:null;this.duplex=duplex;this.onStatus=onStatus;this.onFailure=onFailure;
    this.poseSource=this.from?'user-confirmed':'unknown';this.poseRevision=0;this.bodyPending=false;
    this.userText='';this.userTurn=0;this.collectingUser=false;this.confirmationTurn=-1;
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
    listen(this.client,'transcript',({detail})=>{
      if(detail.role!=='user'){this.collectingUser=false;return;}
      if(!this.collectingUser){this.userText='';++this.userTurn;this.collectingUser=true;}
      this.userText=(this.userText+detail.text).slice(-4000);
    });
    listen(this.client,'interrupted',()=>{if(!this.closed)audio.stopPlayback().catch(error=>this.fail(error));});
    listen(this.client,'cancel',()=>{if(!this.closed&&friend.servo){this.forgetPose();friend.command('stop').catch(error=>this.fail(error));}});
    listen(this.client,'error',({detail})=>this.fail(new Error(detail)));
  }
  forgetPose(){this.from=null;this.poseSource='unknown';++this.poseRevision;}
  bodyState(){return {...this.friend.status().body,enabled:this.allowBody,running:this.bodyPending||this.friend.status().body.running,
    pose:this.from,poseSource:this.poseSource,poseConfirmationRequired:this.allowBody&&!this.from};}
  async tool(call,{signal}){
    if(this.closed||signal.aborted)throw new Error('Conversation ended');
    this.collectingUser=false;
    if(call.name==='confirm_body_pose'){
      if(!this.allowBody||!this.friend.servo)throw new Error('Body tools are disabled');
      const args=call.args;
      if(!args||Array.isArray(args)||Object.keys(args).join(',')!=='pose'||!POSES.includes(args.pose))throw new Error('Invalid confirmed body pose');
      if(this.bodyPending||this.friend.servo.current||this.friend.servo.stopping)throw new Error('Cannot confirm a pose during motion');
      if(reportedPose(this.userText)!==args.pose)return {status:'blocked',reason:'explicit_current_pose_required',body:this.bodyState()};
      this.from=args.pose;this.poseSource='user-confirmed';++this.poseRevision;
      this.confirmationTurn=this.userTurn;
      return {status:'confirmed',motionExecuted:false,nextAction:'wait_for_new_motion_request',body:this.bodyState()};
    }
    if(call.name!=='move_body'){
      const result=await execute(this.friend,{type:'tool',name:call.name,args:call.args});
      return call.name==='get_friend_state'?{...result,body:this.bodyState()}:result;
    }
    if(!this.allowBody)throw new Error('Body tools are disabled');
    if(call.args?.mode==='stop'){
      this.forgetPose();
      return execute(this.friend,{type:'tool',name:call.name,args:call.args});
    }
    if(this.bodyPending||this.friend.servo?.current||this.friend.servo?.stopping)throw new Error('Body motion is already running');
    if(!this.from)return {status:'blocked',reason:'pose_confirmation_required',body:this.bodyState()};
    if(this.userTurn<=this.confirmationTurn)return {status:'blocked',reason:'new_motion_request_required',body:this.bodyState()};
    const from=this.from;this.forgetPose();const revision=this.poseRevision;this.bodyPending=true;
    try{
      const result=await execute(this.friend,{type:'tool',name:call.name,args:call.args,from});
      if(!this.closed&&!signal.aborted&&revision===this.poseRevision){this.from=call.args.mode==='lie'?'lie':'stand';this.poseSource='command-result';}
      return result;
    }catch(error){this.forgetPose();throw error;}
    finally{this.bodyPending=false;}
  }
  async start({apiKey,ephemeralToken,apiVersion,model=config.model,voice=config.voice}={}){
    if(this.closed||this.started)throw new Error('Conversation is closed or already started');this.started=true;
    try{
      this.onStatus('connecting');
      await this.audio.start();if(this.closed)return;
      const bodyInstruction=this.allowBody?
        '\n現在のセッションでは身体操作が許可されています。開始姿勢は'+(this.from==='stand'?'利用者が確認した立ち姿勢':this.from==='lie'?'利用者が確認した伏せ姿勢':'未確認')+'です。'+
        'get_friend_stateのbody.poseは利用者の確認または動作結果に基づく状態で、実測値ではありません。body.poseConfirmationRequiredがtrueなら、脚を動かす前に「今は立ってる？ 伏せてる？」と実物の現在の姿勢を尋ねます。'+
        '利用者が「今は立っている」「伏せている」などと現在の状態を明示した場合だけconfirm_body_poseで記録します。確認の記録自体では脚は動きません。アプリも実際の返答を確認し、曖昧なら拒否します。その場合は「今は立っている」か「今は伏せている」と答えてもらってください。'+
        '「立って」「伏せて」「前進して」は動作の依頼で、現在姿勢の返答ではありません。「はい」だけ、曖昧な返事、以前の会話や動作履歴から姿勢を推測して確認済みにしません。分からない場合は会話を続け、姿勢を確認するまでは脚を動かしません。'+
        '確認できたら短く受け止め、その後の明示的な動作依頼を待ちます。確認前に断った動作を勝手に再開しません。停止・中断・実行失敗で姿勢が未確認に戻った場合も、次の動作前に再確認します。':
        '\n現在のセッションでは身体操作は無効です。顔の表情と会話は使えますが、脚は操作できません。身体への指示の意味は理解したうえで、例えば前進の依頼には「前に歩くんだね。今は脚の操作が無効だから、まだ動けないよ」のように短く自然に答えてください。身体を動かしたとは説明しません。';
      const tools=config.tools.filter(tool=>this.allowBody||tool.name!=='move_body');if(this.allowBody)tools.push(poseTool);
      await this.client.connect({apiKey,ephemeralToken,apiVersion,model,voice,instruction:config.instruction+bodyInstruction,tools});
      if(this.closed)return;this.onStatus('ready');this.onStatus(this.muted?'muted':'listening');
      this.client.text(this.muted?'短く挨拶して、マイク送信は停止中と伝えてください。':this.allowBody&&!this.from?
        'こんにちは。短く挨拶して、実物の脚が今は立ち姿勢か伏せ姿勢か尋ねてください。姿勢の返答を受けるまで脚を動かさないでください。':
        'こんにちは。短く自己紹介して挨拶してください。');
    }catch(error){await this.close();throw error;}
  }
  setMuted(value){this.muted=Boolean(value);if(!this.started)return;if(this.muted)this.client.audioEnd();this.onStatus(this.muted?'muted':'listening');}
  fail(error){if(this.closed)return;this.close().then(()=>this.onFailure(error),()=>this.onFailure(error));}
  async close(){
    if(this.closed)return this.closing;this.closed=true;this.forgetPose();this.userText='';this.client.stop();for(const remove of this.listeners)remove();this.friend.face.setSpeaking(false);
    this.closing=Promise.allSettled([this.audio.close(),...(this.friend.servo?[this.friend.command('stop')]:[])]);await this.closing;
  }
}
module.exports={LiveSession};
