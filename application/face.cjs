'use strict';
const path=require('node:path');
const {performance}=require('node:perf_hooks');
const {FaceRuntime}=require('./face-runtime.cjs');
const {DisplayOutput}=require('./display-output.cjs');
const {RotaryInput}=require('./rotary-input.cjs');

// Runs independently of the panel/bridge server. On physical hardware only
// the GPIO and SPI device drivers are required, with the confirmed pin mapping.
if(process.platform!=='linux')throw new Error('The face application requires Linux GPIO/SPI devices');
const root=path.resolve(__dirname,'..'),face=new FaceRuntime();
let output,input,timer,closed=false;
function close(error){
  if(closed)return;closed=true;clearInterval(timer);input?.close();output?.close();
  if(error){console.error(error.message);process.exitCode=1;}
}
output=new DisplayOutput(root,close);
input=new RotaryInput(root,event=>face.input(event),close);
let previous=performance.now();
timer=setInterval(()=>{
  const now=performance.now();face.advance(Math.min(250,now-previous));previous=now;output.submit(face.frame());
},50);
for(const signal of ['SIGTERM','SIGINT'])process.on(signal,()=>close());
