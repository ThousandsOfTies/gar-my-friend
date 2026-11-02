'use strict';
const path=require('node:path');
const {performance}=require('node:perf_hooks');
const {FaceRuntime}=require('./face-runtime.cjs');
const {DisplayOutput}=require('./display-output.cjs');
const {RotaryInput}=require('./rotary-input.cjs');
const {loadHardware}=require('./hardware.cjs');
const {loadEffects}=require('./effect-config.cjs');
const {FriendRuntime}=require('./friend-runtime.cjs');
const {ServoOutput}=require('./servo-output.cjs');
const {SpeechOutput}=require('./speech-output.cjs');

// Runs independently of the panel/bridge server. On physical hardware only
// the GPIO and SPI device drivers are required, with the confirmed pin mapping.
if(process.platform!=='linux')throw new Error('The face application requires Linux GPIO/SPI devices');
const root=path.resolve(__dirname,'..'),face=new FaceRuntime();
const hardware=loadHardware(process.env.GAR_HARDWARE_DIR);
const config=loadEffects(process.env.GAR_HARDWARE_DIR);
const servo=config.servo?new ServoOutput(config.servo,{binary:path.join(process.env.GAR_BIN_DIR||path.join(root,'build'),'gar-servoctl')}):null;
const speech=config.speech?new SpeechOutput(config.speech,{onSpeaking:value=>face.setSpeaking(value)}):null;
const friend=new FriendRuntime({face,servo,speech,onError:error=>console.error(`Friend output: ${error.message}`)});
let output,input,timer,closed=false;
async function close(error){
  if(closed)return;closed=true;clearInterval(timer);input?.close();output?.close();
  await friend.close();
  if(error){console.error(error.message);process.exitCode=1;}
}
output=new DisplayOutput(root,hardware.display,close);
input=new RotaryInput(root,hardware.rotary,event=>friend.input(event),close);
let previous=performance.now();
timer=setInterval(()=>{
  const now=performance.now();friend.advance(Math.min(250,now-previous));previous=now;output.submit(friend.frame());
},50);
for(const signal of ['SIGTERM','SIGINT'])process.on(signal,()=>close());
