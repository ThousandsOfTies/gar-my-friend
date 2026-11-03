'use strict';
const net=require('node:net');
const fs=require('node:fs/promises');
const path=require('node:path');
const {expressions}=require('../shared/expressions.json');
const MODES=['forward','backward','stop','lie','stand'];
const conversations=new WeakMap();
const config={model:'gemini-3.8-live',voice:'Puck',instruction:
  'あなたは小さな相棒GarMyFriendです。自分の身体は、表情を映す顔の画面、マイク、スピーカー、サーボで動く4本の脚を備えた小型ロボットです。'+
  '日本語で短く親しみやすく話してください。最初に短く挨拶します。会話に合う表情をchange_emotionで選びます。'+
  '「前進してください」「後ろに下がって」「伏せて」「立って」「止まって」は、別の対象が明示されていない限り自分の身体への指示として理解します。'+
  'これらの明確な身体命令に「何を進めればいいですか」などと対象を聞き返しません。別の対象についての話や意味が曖昧な依頼は、会話の文脈に従います。'+
  '身体を動かす明示的な依頼があり、身体操作が有効で実行できるときだけmove_bodyを使います。forwardは前進の脚振り、backwardは後進の脚振り、lieは伏せ、standは立ち上がり、stopは停止です。'+
  '身体操作の可否はセッションの設定、使えるツール、get_friend_stateの結果に従います。操作が無効、準備不足、または実行に失敗したときも、身体への指示として受け止め、分かっている理由だけを短く自然に伝えます。'+
  '「AIなので身体がない」とは答えず、故障・未接続など確認できていない理由を作りません。操作を有効にしたり実行したりしたふりもしません。'+
  'move_bodyは一度だけの有限動作で、完了結果を確認してから実行できた動作を説明します。移動距離や動作後の脚の姿勢は実測していないため、確認できたとは言いません。'+
  'ツール名や内部データは読み上げません。',
  tools:[{name:'change_emotion',description:'顔の表情を変える',parameters:{type:'object',properties:{emotion:{type:'string',enum:expressions.map(e=>e.id)}},required:['emotion']}},
    {name:'move_body',description:'依頼された身体の動作を一回実行する。停止は即時、その他は完了を待つ。',parameters:{type:'object',properties:{mode:{type:'string',enum:MODES}},required:['mode']}},
    {name:'get_friend_state',description:'現在の表情と身体の実行状態を取得する',parameters:{type:'object',properties:{}}}]};

function bodyInput(value){
  if(!MODES.includes(value.mode)||!['stand','lie'].includes(value.from)&&value.mode!=='stop')throw new Error('Invalid body mode or starting pose');
}
/** App-owned semantic commands; transports never select expressions or build motion. */
async function execute(friend,value){
  if(!value||Array.isArray(value)||typeof value!=='object')throw new Error('Invalid application command');
  if(value.type==='state')return friend.status();
  if(value.type==='config')return config;
  if(value.type==='conversation'){
    if(value.action==='open'){
      if(conversations.has(friend))throw new Error('Another conversation is active');
      const {FriendConversation}=require('./conversation.cjs');
      const conversation=new FriendConversation(friend,{allowBody:!!friend.servo,askPose:true});
      conversations.set(friend,conversation);
      return {config:conversation.configuration(),body:conversation.bodyState()};
    }
    const conversation=conversations.get(friend);
    if(!conversation)throw new Error('Conversation has ended');
    if(value.action==='input'){conversation.transcript(value.input);return {ok:true};}
    if(value.action==='tool')return conversation.tool({name:value.name,args:value.args});
    if(value.action==='state')return conversation.bodyState();
    if(value.action==='cancel'){await conversation.cancel();return conversation.bodyState();}
    if(value.action==='close'){await conversation.close();conversations.delete(friend);return {ok:true};}
    throw new Error('Unknown conversation action');
  }
  if(value.type==='speaking'){
    if(typeof value.value!=='boolean')throw new Error('Expected speaking boolean');
    friend.face.setSpeaking(value.value);return friend.status();
  }
  if(value.type==='body'){
    bodyInput(value);
    if(conversations.has(friend)){
      if(value.mode!=='stop')throw new Error('Use conversation controls while a conversation is active');
      conversations.get(friend).forgetPose();
    }
    if(value.mode!=='stop'&&(friend.servo?.current||friend.servo?.stopping))throw new Error('Body motion is already running');
    if(!friend.servo)throw new Error('Servo output is disabled');
    const work=friend.command(value.mode,value.mode==='stop'?undefined:{from:value.from});
    if(value.wait||value.mode==='stop')await work;
    else work.catch(()=>{});
    return friend.status();
  }
  if(value.type==='tool'){
    const args=value.args;
    if(!args||Array.isArray(args)||typeof args!=='object')throw new Error('Invalid tool arguments');
    if(value.name==='change_emotion'&&Object.keys(args).join(',')==='emotion'){
      friend.face.select(args.emotion);return {status:'ok',expression:friend.face.expressionId};
    }
    if(value.name==='get_friend_state'&&Object.keys(args).length===0)return friend.status();
    if(value.name==='move_body'&&Object.keys(args).join(',')==='mode'){
      bodyInput({mode:args.mode,from:value.from});
      const accepted=await friend.command(args.mode,args.mode==='stop'?undefined:{from:value.from});
      if(!accepted)throw new Error('Body command was not accepted');
      return {status:'completed',mode:args.mode,pwm:'off'};
    }
    throw new Error('Unknown tool or invalid arguments');
  }
  throw new Error('Unknown application command');
}

function requestControl(socket,value,{timeoutMs=38000}={}){
  return new Promise((resolve,reject)=>{
    const connection=net.createConnection(socket);connection.setEncoding('utf8');let text='',done=false;
    const finish=(error,result)=>{if(done)return;done=true;connection.destroy();error?reject(error):resolve(result);};
    connection.setTimeout(timeoutMs,()=>finish(new Error('Application command timed out')));
    connection.on('connect',()=>connection.write(JSON.stringify(value)+'\n'));
    connection.on('error',error=>finish(error));
    connection.on('data',chunk=>{text+=chunk;if(text.length>32768)return finish(new Error('Application reply too large'));if(!text.includes('\n'))return;
      try{const result=JSON.parse(text.split('\n')[0]);result.ok?finish(null,result.value):finish(new Error(result.error));}catch(error){finish(error);}});
    connection.on('end',()=>{if(!done)finish(new Error('Application closed the command'));});
  });
}

async function startControl(socket,friend){
  if(!path.isAbsolute(socket))throw new Error('Control socket must be absolute');
  await fs.mkdir(path.dirname(socket),{recursive:true,mode:0o700});
  try{
    const stat=await fs.lstat(socket);
    if(!stat.isSocket()||stat.uid!==process.getuid())throw new Error('Control path is not our socket');
    try{await requestControl(socket,{type:'state'},{timeoutMs:500});throw new Error('Control socket already active');}
    catch(error){if(error.code!=='ECONNREFUSED'&&error.code!=='ENOENT')throw error;await fs.unlink(socket);}
  }catch(error){if(error.code!=='ENOENT')throw error;}
  let speakingTimer;const peers=new Set();
  const server=net.createServer(peer=>{
    peer.setEncoding('utf8');
    peers.add(peer);peer.on('error',()=>{});peer.on('close',()=>peers.delete(peer));peer.setTimeout(40000,()=>peer.destroy());
    let text='',received=false;
    peer.on('data',chunk=>{
      if(received)return;text+=chunk;
      if(text.length>4096){peer.destroy();return;}if(!text.includes('\n'))return;received=true;
      (async()=>{
        const value=JSON.parse(text.split('\n')[0]);const result=await execute(friend,value);
        if(value.type==='speaking'){clearTimeout(speakingTimer);if(value.value)speakingTimer=setTimeout(()=>friend.face.setSpeaking(false),7000);}
        if(!peer.destroyed)peer.end(JSON.stringify({ok:true,value:result})+'\n');
      })().catch(error=>{if(!peer.destroyed)peer.end(JSON.stringify({ok:false,error:error.message})+'\n');});
    });
  });
  await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(socket,resolve);});
  await fs.chmod(socket,0o600);
  let closed=false;
  return {async close(){if(closed)return;closed=true;clearTimeout(speakingTimer);await conversations.get(friend)?.close();conversations.delete(friend);friend.face.setSpeaking(false);for(const peer of peers)peer.destroy();await new Promise(resolve=>server.close(resolve));}};
}
module.exports={startControl,requestControl,execute,config};
