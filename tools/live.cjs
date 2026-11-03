'use strict';
const path=require('node:path');
const fs=require('node:fs/promises');
const {constants}=require('node:fs');
const {loadAudioConfig}=require('../application/audio-config.cjs');
const {loadEffects}=require('../application/effect-config.cjs');

async function commandAvailable(command){
  for(const directory of (process.env.PATH||'').split(path.delimiter))try{if(directory){await fs.access(path.join(directory,command),constants.X_OK);return true;}}catch{}
  return false;
}
function options(args){
  const result={action:args[0],body:false,duplex:false,from:null};
  if(!['check','start'].includes(result.action))throw new Error('Usage: live check | start [--body --from stand|lie] [--duplex]');
  for(let i=1;i<args.length;i++){
    if(args[i]==='--body'&&!result.body)result.body=true;
    else if(args[i]==='--duplex'&&!result.duplex)result.duplex=true;
    else if(args[i]==='--from'&&!result.from&&['stand','lie'].includes(args[i+1]))result.from=args[++i];
    else throw new Error('Invalid Live audio option');
  }
  if(result.body&&!result.from||result.from&&!result.body)throw new Error('Body tools require both --body and --from stand|lie');
  if(result.action==='check'&&args.length!==1)throw new Error('live check takes no options');return result;
}
async function check(){
  if(!process.env.GAR_HARDWARE_DIR||!process.env.GAR_TOOLS_ROOT)throw new Error('Product must set GAR_HARDWARE_DIR and GAR_TOOLS_ROOT');
  const driver=require(path.join(process.env.GAR_TOOLS_ROOT,'targets/linux-device/runtime/alsa-audio/audio.cjs'));
  const audio=loadAudioConfig(process.env.GAR_HARDWARE_DIR),devices=await driver.devices();
  const commands={arecord:await commandAvailable('arecord'),aplay:await commandAvailable('aplay')};
  const found=direction=>Boolean(audio[direction]&&devices.some(card=>card.endpoints.some(endpoint=>endpoint.direction===direction&&endpoint.device===audio[direction])));
  let brokerConfigured=false;
  if(process.env.GAR_LIVE_BROKER_CONFIG){
    const {loadProfile}=require(path.join(process.env.GAR_TOOLS_ROOT,'targets/linux-device/runtime/gemini-live/broker.cjs'));
    loadProfile(process.env.GAR_LIVE_BROKER_CONFIG);brokerConfigured=true;
  }
  const report={platform:process.platform,node:process.versions.node,webSocket:typeof WebSocket==='function',audio,devices,commands,keyPresent:Boolean(process.env.GEMINI_API_KEY?.trim()),brokerConfigured,captureDetected:found('capture'),playbackDetected:found('playback')};
  report.ready=report.platform==='linux'&&report.webSocket&&commands.arecord&&commands.aplay&&report.captureDetected&&report.playbackDetected&&(report.keyPresent||brokerConfigured);
  return report;
}
async function main(args=process.argv.slice(2)){
  const selected=options(args),report=await check();
  if(selected.action==='check'){console.log(JSON.stringify(report,null,2));return;}
  if(!report.ready)throw new Error('Live audio is not ready. Run live check and configure audio.csv, ALSA, Node 22+ and GEMINI_API_KEY.');
  if(selected.body&&!loadEffects(process.env.GAR_HARDWARE_DIR).servo)throw new Error('Enable servo output in effects.csv before using --body');
  process.env.GAR_FRIEND_LIVE='1';process.env.GAR_FRIEND_LIVE_BODY=selected.body?'1':'0';process.env.GAR_FRIEND_LIVE_DUPLEX=selected.duplex?'1':'0';
  if(selected.from)process.env.GAR_FRIEND_START_POSE=selected.from;else delete process.env.GAR_FRIEND_START_POSE;
  console.error('Live audio starts the face app and streams microphone audio to Gemini. Ctrl+C stops audio and body outputs.');
  require('../application/face.cjs');
}
module.exports={main,options,check};
if(require.main===module)main().catch(error=>{console.error(error.message);process.exitCode=1;});
