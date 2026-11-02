'use strict';
const {spawn}=require('node:child_process');

/** One bounded child; use argument arrays and pipe text, never a shell. */
function processJob(command,args,{input,timeoutMs=15000,spawnProcess=spawn,env=process.env}={}){
  const child=spawnProcess(command,args,{stdio:['pipe','ignore','pipe'],shell:false,env});
  let detail='',finished=false,timer,killTimer,stopped=null;
  const promise=new Promise((resolve,reject)=>{
    const finish=error=>{if(finished)return;finished=true;clearTimeout(timer);clearTimeout(killTimer);error?reject(error):resolve();};
    child.stderr?.on('data',data=>{detail=(detail+data).slice(-2048);});
    child.once('error',finish);
    child.once('close',(code,signal)=>finish(stopped||(code===0?null:new Error(detail.trim()||`${command} exited (${signal||code})`))));
    child.stdin?.on('error',error=>{if(error.code!=='EPIPE')finish(error);});
    timer=setTimeout(()=>{stopped=new Error(`${command} timed out`);child.kill('SIGTERM');killTimer=setTimeout(()=>child.kill('SIGKILL'),1000);},timeoutMs);
    child.stdin?.end(input);
  });
  return {promise,cancel(){if(!finished){stopped=new Error(`${command} cancelled`);clearTimeout(timer);child.kill('SIGTERM');clearTimeout(killTimer);killTimer=setTimeout(()=>child.kill('SIGKILL'),1000);}}};
}
module.exports={processJob};
