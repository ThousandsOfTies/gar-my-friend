'use strict';
const path=require('node:path');
const {pathToFileURL}=require('node:url');
const {loadAudioConfig}=require('./audio-config.cjs');
const {LiveSession}=require('./live-session.cjs');
const {ManagedLive}=require('./managed-live.cjs');

async function startLive(friend,{apiKey,onFailure=console.error,signal}={}){
  if(!process.env.GAR_TOOLS_ROOT)throw new Error('Set GAR_TOOLS_ROOT for Live audio');
  const brokerFile=process.env.GAR_LIVE_BROKER_CONFIG;
  if(!brokerFile&&!apiKey?.trim())throw new Error('Configure a Live token broker or GEMINI_API_KEY');
  if(typeof WebSocket!=='function')throw new Error('Live audio requires Node.js 22 or later');
  const {AlsaDuplex}=require(path.join(process.env.GAR_TOOLS_ROOT,'targets/linux-device/runtime/alsa-audio/duplex.cjs'));
  const {GeminiLive}=await import(pathToFileURL(path.join(process.env.GAR_TOOLS_ROOT,'web-simulator/components/gemini-live.mjs')).href);
  const allowBody=process.env.GAR_FRIEND_LIVE_BODY==='1';
  const createSession=callbacks=>new LiveSession({friend,audio:new AlsaDuplex(loadAudioConfig(process.env.GAR_HARDWARE_DIR)),
    createClient:options=>new GeminiLive(options),allowBody,from:process.env.GAR_FRIEND_START_POSE,duplex:process.env.GAR_FRIEND_LIVE_DUPLEX==='1',...callbacks});
  const onStatus=state=>console.error(`Live audio: ${state}`);
  if(brokerFile){
    const {loadProfile,requestToken}=require(path.join(process.env.GAR_TOOLS_ROOT,'targets/linux-device/runtime/gemini-live/broker.cjs'));
    loadProfile(brokerFile); // Fail preflight for unreadable/insecure device credentials.
    const managed=new ManagedLive({credentials:signal=>requestToken(loadProfile(brokerFile),{signal}),createSession,onStatus,onFailure,
      initialMuted:process.env.GAR_LIVE_INITIAL_MUTED==='1',retry:!allowBody});
    const abort=()=>managed.close().catch(()=>{});signal?.addEventListener('abort',abort,{once:true});
    if(signal?.aborted){await managed.close();return managed;}
    return managed.start();
  }
  const session=createSession({onStatus,onFailure});
  const abort=()=>session.close().catch(()=>{});signal?.addEventListener('abort',abort,{once:true});
  if(signal?.aborted)abort();
  await session.start({apiKey,model:process.env.GAR_GEMINI_MODEL||undefined,voice:process.env.GAR_GEMINI_VOICE||undefined});return session;
}
module.exports={startLive};
