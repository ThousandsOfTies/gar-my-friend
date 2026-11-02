'use strict';
const {processJob}=require('./process-job.cjs');

/** Reuses the pinned gar-servoctl guards, calibration, locking and fail-off. */
class ServoOutput {
  constructor(config,{binary,job=processJob}={}){this.config=config;this.binary=binary;this.job=job;this.current=null;this.closed=false;this.env={...process.env,GAR_SERVO_STOP_FILE:config.stopFile};}
  args(...command){return ['--i2c-config',this.config.i2c,'--servo-config',this.config.calibration,...command];}
  async neutral(){
    if(this.closed||this.current)return false;
    const current=this.job(this.binary,this.args('neutral','all','--hold-ms',String(this.config.holdMs),'--ack-all'),{timeoutMs:5000,env:this.env});
    this.current=current;
    try{await current.promise;return true;}finally{if(this.current===current)this.current=null;}
  }
  async close(){
    if(this.closed)return;this.closed=true;
    const active=this.current;
    active?.cancel();
    // The native motion owner handles SIGTERM through its existing FULL_OFF
    // path. Wait for it before issuing the final explicit off command.
    if(active)await active.promise.catch(()=>{});
    await this.job(this.binary,this.args('off','all'),{timeoutMs:5000,env:this.env}).promise;
  }
}
module.exports={ServoOutput};
