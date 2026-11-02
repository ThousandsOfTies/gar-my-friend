'use strict';
const net=require('node:net');
const fs=require('node:fs/promises');
const path=require('node:path');
const {expressions}=require('../shared/expressions.json');
const MODES=['forward','backward','stop','lie','stand'];
const config={model:'gemini-3.8-live',voice:'Puck',instruction:
  'あなたは小さな相棒GarMyFriendです。日本語で短く親しみやすく話してください。最初に短く挨拶します。'+
  '会話に合う表情をchange_emotionで選びます。身体を動かす明示的な依頼があるときだけmove_bodyを使います。'+
  'move_bodyは一度だけの有限動作で、完了結果を確認してから動いたと説明します。PWM OFFなので姿勢は実測していません。'+
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
  if(value.type==='speaking'){
    if(typeof value.value!=='boolean')throw new Error('Expected speaking boolean');
    friend.face.setSpeaking(value.value);return friend.status();
  }
  if(value.type==='body'){
    bodyInput(value);
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
    const connection=net.createConnection(socket);let text='',done=false;
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
  return {async close(){if(closed)return;closed=true;clearTimeout(speakingTimer);friend.face.setSpeaking(false);for(const peer of peers)peer.destroy();await new Promise(resolve=>server.close(resolve));}};
}
module.exports={startControl,requestControl,execute,config};
