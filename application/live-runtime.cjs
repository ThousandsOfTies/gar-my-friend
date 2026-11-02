'use strict';
const path=require('node:path');
const {pathToFileURL}=require('node:url');
const {loadAudioConfig}=require('./audio-config.cjs');
const {LiveSession}=require('./live-session.cjs');

async function startLive(friend,{apiKey,onFailure=console.error,signal}={}){
  if(!process.env.GAR_TOOLS_ROOT)throw new Error('Set GAR_TOOLS_ROOT for Live audio');
  if(!apiKey?.trim())throw new Error('Set GEMINI_API_KEY before starting Live audio');
  if(typeof WebSocket!=='function')throw new Error('Live audio requires Node.js 22 or later');
  const {AlsaDuplex}=require(path.join(process.env.GAR_TOOLS_ROOT,'targets/linux-device/runtime/alsa-audio/duplex.cjs'));
  const {GeminiLive}=await import(pathToFileURL(path.join(process.env.GAR_TOOLS_ROOT,'web-simulator/components/gemini-live.mjs')).href);
  const audio=new AlsaDuplex(loadAudioConfig(process.env.GAR_HARDWARE_DIR));
  const session=new LiveSession({friend,audio,createClient:options=>new GeminiLive(options),allowBody:process.env.GAR_FRIEND_LIVE_BODY==='1',from:process.env.GAR_FRIEND_START_POSE,duplex:process.env.GAR_FRIEND_LIVE_DUPLEX==='1',
    onStatus:state=>console.error(`Live audio: ${state}`),onFailure});
  const abort=()=>session.close().catch(()=>{});signal?.addEventListener('abort',abort,{once:true});
  if(signal?.aborted)abort();
  await session.start({apiKey,model:process.env.GAR_GEMINI_MODEL||undefined,voice:process.env.GAR_GEMINI_VOICE||undefined});return session;
}
module.exports={startLive};
